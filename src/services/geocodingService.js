const { lookupCepCoordinates } = require('./cepService');
const geocodeRepository = require('../repositories/geocodeRepository');

const geocodeCache = new Map();
let lastNominatimRequestAt = 0;
const NOMINATIM_INTERVAL_MS = Math.max(1000, Number(process.env.NOMINATIM_INTERVAL_MS || 1100));

async function geocodeStops(addresses = []) {
  const warnings = [];
  const failures = [];
  const providerPreference = String(process.env.GEOCODING_PROVIDER || 'auto').toLowerCase();
  const googleKey = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();
  const strategy = String(process.env.GEOCODING_STRATEGY || 'balanced').toLowerCase();
  const canonical = addresses.map(snapshotAddress);

  // 1) Cache persistente: rotas repetidas deixam de consultar a internet.
  const unresolved = [];
  for (let index = 0; index < addresses.length; index++) {
    const address = addresses[index];
    if (address.geocoded) continue;
    if (!address.street || !address.city || !address.state) {
      failures.push(address);
      continue;
    }
    const normalized = canonical[index];
    const addressKey = buildAddressKey(normalized);
    const persisted = await geocodeRepository.find(addressKey);
    if (persisted && Number.isFinite(Number(persisted.latitude)) && Number.isFinite(Number(persisted.longitude))) {
      applyResult(address, {
        latitude: Number(persisted.latitude),
        longitude: Number(persisted.longitude),
        provider: `${persisted.provider} (cache)`
      });
      continue;
    }
    unresolved.push({ index, address, normalized, addressKey });
  }

  const preciseLimit = Math.max(0, Number(process.env.GEOCODING_PRECISE_LIMIT || 12));
  const preferPrecise = strategy === 'precise' || (strategy === 'balanced' && unresolved.length <= preciseLimit);

  // 2) Em rotas maiores, o modo balanceado usa CEP V2 em paralelo para ganhar velocidade.
  // Em rotas pequenas (ate GEOCODING_PRECISE_LIMIT), prioriza Nominatim estruturado
  // para obter melhor precisao de numero/logradouro sem repetir varias tentativas.
  if (providerPreference !== 'google' && !preferPrecise && unresolved.length) {
    const cepResults = await mapWithConcurrency(unresolved, Math.min(4, unresolved.length), async (entry) => {
      if (!entry.normalized.zipCode) return null;
      const found = await lookupCepCoordinates(entry.normalized.zipCode);
      if (!found || !isCepCoordinateMatch(found, entry.normalized)) return null;
      return {
        latitude: found.latitude,
        longitude: found.longitude,
        provider: found.provider,
        quality: 'cep'
      };
    });

    for (let i = 0; i < unresolved.length; i++) {
      const result = cepResults[i];
      if (!result) continue;
      const entry = unresolved[i];
      applyResult(entry.address, result);
      await geocodeRepository.upsert({
        addressKey: entry.addressKey,
        latitude: result.latitude,
        longitude: result.longitude,
        provider: result.provider,
        quality: result.quality
      });
    }
  }

  // 3) Somente os pontos ainda sem coordenadas usam geocodificacao textual.
  // Nominatim permanece sequencial para respeitar o limite do servico publico.
  for (const entry of unresolved) {
    if (entry.address.geocoded) continue;
    let result = null;
    let googleError = null;

    if ((providerPreference === 'google' || providerPreference === 'auto') && googleKey) {
      try {
        result = await geocodeWithGoogle(entry.normalized, googleKey);
      } catch (error) {
        googleError = error;
      }
    }

    if (!result && providerPreference !== 'google') {
      try {
        result = await geocodeWithNominatim(entry.normalized, { allowCepFallback: preferPrecise });
      } catch (error) {
        warnings.push(`Geocodificacao alternativa indisponivel para ${entry.address.displayName}: ${error.message}`);
      }
    }

    if (!result && providerPreference === 'google' && googleError) {
      warnings.push(`Google Geocoding falhou para ${entry.address.displayName}: ${googleError.message}`);
    }

    if (!result) {
      failures.push(entry.address);
      continue;
    }

    applyResult(entry.address, result);
    await geocodeRepository.upsert({
      addressKey: entry.addressKey,
      latitude: result.latitude,
      longitude: result.longitude,
      provider: result.provider,
      quality: result.quality || 'validated'
    });
  }

  const collisions = findSuspiciousCoordinateCollisions(addresses);
  for (const collision of collisions) {
    const suspect = collision.suspect;
    if (!failures.some((item) => item.id === suspect.id)) failures.push(suspect);
    warnings.push(`Localizacao suspeita: ${collision.a.displayName} e ${collision.b.displayName} receberam praticamente a mesma coordenada apesar de terem logradouros diferentes.`);
  }

  return { addresses, warnings, failures };
}

async function geocodeWithGoogle(address, apiKey) {
  const candidates = buildAddressCandidates(address);
  for (const query of candidates.slice(0, 2)) {
    const key = `google|${query.toLowerCase()}`;
    if (geocodeCache.has(key)) {
      const cached = geocodeCache.get(key);
      if (cached) return cached;
      continue;
    }

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', query);
    url.searchParams.set('region', 'br');
    url.searchParams.set('language', 'pt-BR');
    url.searchParams.set('key', apiKey);

    const response = await fetchWithTimeout(url, { method: 'GET' }, 8000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.status === 'ZERO_RESULTS') {
      geocodeCache.set(key, null);
      continue;
    }
    if (data.status !== 'OK') throw new Error(data.error_message || data.status || 'erro desconhecido');

    const resultItem = data.results?.[0];
    const location = resultItem?.geometry?.location;
    if (!location || !Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lng))) {
      geocodeCache.set(key, null);
      continue;
    }

    const result = {
      latitude: Number(location.lat),
      longitude: Number(location.lng),
      provider: 'Google Geocoding',
      quality: 'validated'
    };
    geocodeCache.set(key, result);
    return result;
  }
  return null;
}

async function geocodeWithNominatim(address, { allowCepFallback = true } = {}) {
  let structured = null;
  try {
    structured = await searchNominatimStructured(address);
  } catch {
    // O fallback por CEP abaixo ainda pode resolver sem prolongar a espera.
  }
  if (structured) return structured;

  // Fallback rapido: CEP V2 so e aceito quando logradouro/cidade/UF sao coerentes.
  if (allowCepFallback && address.zipCode) {
    const cepCoordinates = await lookupCepCoordinates(address.zipCode);
    if (cepCoordinates && isCepCoordinateMatch(cepCoordinates, address)) {
      return {
        latitude: cepCoordinates.latitude,
        longitude: cepCoordinates.longitude,
        provider: cepCoordinates.provider,
        quality: 'cep'
      };
    }
    return null;
  }

  // Sem CEP, faca apenas uma tentativa textual adicional.
  const query = buildAddressCandidates(address)[0];
  if (!query) return null;
  return searchNominatimText(query, address);
}

async function searchNominatimStructured(address) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  url.searchParams.set('countrycodes', 'br');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('country', 'Brasil');
  url.searchParams.set('street', [normalizeRouteNumber(address.number), clean(address.street)].filter(Boolean).join(' '));
  url.searchParams.set('city', clean(address.city));
  url.searchParams.set('state', clean(address.state));
  const zip = normalizeZip(address.zipCode);
  if (zip) url.searchParams.set('postalcode', zip);
  return executeNominatim(url, address, `structured|${buildAddressKey(address)}`);
}

async function searchNominatimText(query, address) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  url.searchParams.set('countrycodes', 'br');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('q', query);
  return executeNominatim(url, address, `text|${query.toLowerCase()}`);
}

async function executeNominatim(url, target, cacheKey) {
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);

  const elapsed = Date.now() - lastNominatimRequestAt;
  if (elapsed < NOMINATIM_INTERVAL_MS) await delay(NOMINATIM_INTERVAL_MS - elapsed);

  const response = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': process.env.NOMINATIM_USER_AGENT || 'RouteX-BelaMetais/2.5 (local route planner)',
      'Accept-Language': 'pt-BR,pt;q=0.9'
    }
  }, Number(process.env.NOMINATIM_TIMEOUT_MS || 4500));
  lastNominatimRequestAt = Date.now();

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const items = Array.isArray(data) ? data : [];
  const scored = items
    .map((item) => ({ item, score: matchScore(item, target) }))
    .filter((entry) => entry.score >= 65)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    geocodeCache.set(cacheKey, null);
    return null;
  }

  const first = scored[0].item;
  const result = {
    latitude: Number(first.lat),
    longitude: Number(first.lon),
    provider: 'OpenStreetMap/Nominatim',
    quality: scored[0].score >= 90 ? 'exact' : 'validated'
  };
  if (!Number.isFinite(result.latitude) || !Number.isFinite(result.longitude)) {
    geocodeCache.set(cacheKey, null);
    return null;
  }

  geocodeCache.set(cacheKey, result);
  return result;
}

function matchScore(item, target) {
  const details = item?.address || {};
  const expectedCity = normalizeForCompare(target.city);
  const expectedState = clean(target.state).toUpperCase();
  const returnedCities = [details.city, details.town, details.municipality, details.village, details.city_district, details.county]
    .map(normalizeForCompare).filter(Boolean);

  if (expectedCity && returnedCities.length && !returnedCities.some((value) => equivalentText(value, expectedCity))) return -1000;

  if (expectedState) {
    const isoValues = Object.entries(details)
      .filter(([key]) => key.startsWith('ISO3166-2'))
      .map(([, value]) => String(value || '').toUpperCase());
    const stateName = normalizeForCompare(details.state);
    const expectedStateName = normalizeForCompare(BRAZILIAN_STATES[expectedState] || '');
    const stateMatches = isoValues.some((value) => value === `BR-${expectedState}`)
      || (expectedStateName && stateName === expectedStateName)
      || (!isoValues.length && !stateName);
    if (!stateMatches) return -1000;
  }

  const returnedStreet = details.road || details.pedestrian || details.residential || details.footway || details.path || details.cycleway || '';
  const streetScore = streetSimilarity(target.street, returnedStreet || item.display_name || '');
  if (clean(target.street) && streetScore < 0.64) return -1000;

  let score = 65 + Math.round(streetScore * 20);
  const expectedZip = normalizeZip(target.zipCode);
  const returnedZip = normalizeZip(details.postcode);
  if (expectedZip && returnedZip && expectedZip === returnedZip) score += 8;

  const expectedNumber = normalizeRouteNumber(target.number);
  const returnedNumber = normalizeRouteNumber(details.house_number);
  if (expectedNumber && returnedNumber) {
    if (expectedNumber === returnedNumber) score += 10;
    else score -= 8;
  }
  return score;
}

function buildAddressCandidates(address) {
  const street = clean(address.street);
  const number = normalizeRouteNumber(address.number);
  const city = clean(address.city);
  const state = clean(address.state).toUpperCase();
  const zip = formatZipCode(address.zipCode);
  const streetNumber = [street, number].filter(Boolean).join(', ');
  const locality = [city, state].filter(Boolean).join(' - ');
  return unique([
    joinParts(streetNumber, locality, zip, 'Brasil'),
    joinParts(streetNumber, locality, 'Brasil')
  ]);
}

function findSuspiciousCoordinateCollisions(addresses) {
  const collisions = [];
  for (let i = 0; i < addresses.length; i++) {
    const a = addresses[i];
    if (!a.geocoded) continue;
    for (let j = i + 1; j < addresses.length; j++) {
      const b = addresses[j];
      if (!b.geocoded) continue;
      if (samePhysicalAddress(a, b)) continue;
      const latDiff = Math.abs(Number(a.latitude) - Number(b.latitude));
      const lonDiff = Math.abs(Number(a.longitude) - Number(b.longitude));
      if (latDiff <= 0.00001 && lonDiff <= 0.00001) {
        collisions.push({ a, b, suspect: b });
      }
    }
  }
  return collisions;
}

function samePhysicalAddress(a, b) {
  return normalizeStreet(a.street) === normalizeStreet(b.street)
    && normalizeRouteNumber(a.number) === normalizeRouteNumber(b.number)
    && normalizeForCompare(a.city) === normalizeForCompare(b.city);
}

function isCepCoordinateMatch(found, target) {
  if (clean(found.state).toUpperCase() !== clean(target.state).toUpperCase()) return false;
  if (!equivalentText(normalizeForCompare(found.city), normalizeForCompare(target.city))) return false;
  return streetSimilarity(found.street, target.street) >= 0.8;
}

function applyResult(address, result) {
  address.latitude = Number(result.latitude);
  address.longitude = Number(result.longitude);
  address.geocodingProvider = clean(result.provider);
}

function buildAddressKey(address) {
  return [normalizeStreet(address.street), normalizeRouteNumber(address.number), normalizeForCompare(address.city), clean(address.state).toUpperCase(), normalizeZip(address.zipCode)].join('|');
}

function snapshotAddress(address) {
  return {
    street: clean(address.street),
    number: clean(address.number),
    neighborhood: clean(address.neighborhood),
    city: clean(address.city),
    state: clean(address.state).toUpperCase(),
    zipCode: clean(address.zipCode)
  };
}

function streetSimilarity(a, b) {
  const aa = new Set(normalizeStreet(a).split(' ').filter(Boolean));
  const bb = new Set(normalizeStreet(b).split(' ').filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const token of aa) if (bb.has(token)) intersection++;
  return intersection / Math.max(aa.size, bb.size);
}

function normalizeStreet(value) {
  const stopWords = new Set(['rua', 'r', 'avenida', 'av', 'servidao', 'serv', 'rodovia', 'rod', 'estrada', 'travessa', 'tv']);
  return normalizeForCompare(value)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !stopWords.has(token))
    .join(' ');
}

function equivalentText(a, b) {
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function normalizeRouteNumber(value) {
  const text = clean(value);
  if (/^\d+$/.test(text)) return String(Number(text));
  return text;
}

function normalizeZip(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 8 ? digits : '';
}

function formatZipCode(value) {
  const digits = normalizeZip(value);
  return digits ? `${digits.slice(0, 5)}-${digits.slice(5)}` : clean(value);
}

function normalizeForCompare(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function joinParts(...values) { return values.filter(Boolean).join(', '); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }

async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('tempo limite excedido');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }


async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await worker(items[index], index);
      } catch {
        results[index] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, run));
  return results;
}

const BRAZILIAN_STATES = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapa', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceara', DF: 'Distrito Federal',
  ES: 'Espirito Santo', GO: 'Goias', MA: 'Maranhao', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Para', PB: 'Paraiba', PR: 'Parana', PE: 'Pernambuco', PI: 'Piaui', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul', RO: 'Rondonia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'Sao Paulo', SE: 'Sergipe', TO: 'Tocantins'
};

module.exports = { geocodeStops, buildAddressCandidates, normalizeRouteNumber, matchScore, streetSimilarity, buildAddressKey };
