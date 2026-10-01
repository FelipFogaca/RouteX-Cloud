const cepCache = new Map();
const cepLocationCache = new Map();

async function lookupCep(input) {
  const cep = normalizeCep(input);
  if (!/^\d{8}$/.test(cep)) {
    const error = new Error('Informe um CEP válido com 8 dígitos.');
    error.code = 'INVALID_CEP';
    throw error;
  }

  if (cepCache.has(cep)) return cepCache.get(cep);

  let viaCepError = null;
  try {
    const data = await fetchViaCep(cep);
    if (data) {
      cepCache.set(cep, data);
      return data;
    }
  } catch (error) {
    viaCepError = error;
  }

  try {
    const data = await fetchBrasilApi(cep);
    if (data) {
      cepCache.set(cep, data);
      return data;
    }
  } catch (error) {
    if (viaCepError) {
      error.message = `ViaCEP: ${viaCepError.message}. BrasilAPI: ${error.message}`;
    }
    throw error;
  }

  const error = new Error('CEP não encontrado. Confira os números ou preencha o endereço manualmente.');
  error.code = 'CEP_NOT_FOUND';
  throw error;
}


async function lookupCepCoordinates(input) {
  const cep = normalizeCep(input);
  if (!/^\d{8}$/.test(cep)) return null;
  if (cepLocationCache.has(cep)) return cepLocationCache.get(cep);

  try {
    const response = await fetchWithTimeout(`https://brasilapi.com.br/api/cep/v2/${cep}`, {
      headers: { Accept: 'application/json' }
    }, Number(process.env.CEP_COORDINATES_TIMEOUT_MS || 4500));
    if (!response.ok) {
      cepLocationCache.set(cep, null);
      return null;
    }
    const data = await response.json();
    const coords = data?.location?.coordinates || {};
    const latitude = Number(coords.latitude);
    const longitude = Number(coords.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      cepLocationCache.set(cep, null);
      return null;
    }
    const result = {
      cep: formatCep(data.cep || cep),
      street: cleanText(data.street),
      neighborhood: cleanText(data.neighborhood),
      city: cleanText(data.city),
      state: cleanText(data.state).toUpperCase(),
      latitude,
      longitude,
      provider: 'BrasilAPI CEP V2'
    };
    cepLocationCache.set(cep, result);
    return result;
  } catch {
    cepLocationCache.set(cep, null);
    return null;
  }
}

async function fetchViaCep(cep) {
  const response = await fetchWithTimeout(`https://viacep.com.br/ws/${cep}/json/`, {
    headers: { Accept: 'application/json' }
  }, 7000);

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data?.erro) return null;

  return normalizeResult({
    cep: data.cep || cep,
    street: data.logradouro,
    neighborhood: data.bairro,
    city: data.localidade,
    state: data.uf,
    provider: 'ViaCEP'
  });
}

async function fetchBrasilApi(cep) {
  const response = await fetchWithTimeout(`https://brasilapi.com.br/api/cep/v1/${cep}`, {
    headers: { Accept: 'application/json' }
  }, 7000);

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();

  return normalizeResult({
    cep: data.cep || cep,
    street: data.street,
    neighborhood: data.neighborhood,
    city: data.city,
    state: data.state,
    provider: 'BrasilAPI'
  });
}

function normalizeResult(data) {
  return {
    cep: formatCep(data.cep),
    street: cleanText(data.street),
    neighborhood: cleanText(data.neighborhood),
    city: cleanText(data.city),
    state: cleanText(data.state).toUpperCase(),
    provider: cleanText(data.provider)
  };
}

function normalizeCep(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 8);
}

function formatCep(value) {
  const digits = normalizeCep(value);
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

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

module.exports = { lookupCep, lookupCepCoordinates, normalizeCep, formatCep };
