const { haversineKm } = require('../utils/distance');

async function buildDistanceMatrix(points) {
  const warnings = [];
  const preference = String(process.env.ROUTING_PROVIDER || 'auto').toLowerCase();
  const googleKey = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();

  if (!Array.isArray(points) || points.length === 0) {
    return emptyMatrix([], 'none', warnings);
  }

  if (points.some((point) => !point.geocoded)) {
    throw new Error('Todas as paradas e a origem precisam estar geocodificadas antes da roteirização.');
  }

  if ((preference === 'google' || preference === 'auto') && googleKey && points.length <= 25) {
    try {
      return await googleRouteMatrix(points, googleKey, warnings);
    } catch (error) {
      warnings.push(`Google Routes não pôde calcular a matriz: ${error.message}. Tentando alternativa por vias.`);
      if (preference === 'google') warnings.push('O RouteX continuará com o provedor alternativo para não interromper o planejamento.');
    }
  } else if ((preference === 'google' || preference === 'auto') && googleKey && points.length > 25) {
    warnings.push('Google Routes foi ignorado nesta rota porque a matriz completa ultrapassa 625 combinações; será usada a alternativa configurada.');
  }

  try {
    const maxOsrm = Number(process.env.OSRM_MAX_POINTS || 100);
    if (points.length <= maxOsrm) return await osrmMatrix(points, warnings);
    warnings.push(`A rota possui ${points.length} pontos e excede o limite configurado de ${maxOsrm} pontos para a matriz OSRM.`);
  } catch (error) {
    warnings.push(`Matriz rodoviária alternativa indisponível: ${error.message}.`);
  }

  warnings.push('Foi utilizado o fallback por distância geográfica estimada. Revise a sequência no Google Maps antes da saída.');
  return haversineMatrix(points, warnings);
}

async function googleRouteMatrix(points, apiKey, warnings) {
  const url = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
  const body = {
    origins: points.map((point) => ({ waypoint: googleWaypoint(point) })),
    destinations: points.map((point) => ({ waypoint: googleWaypoint(point) })),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_UNAWARE'
  };

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition,status'
    },
    body: JSON.stringify(body)
  }, 15000);

  if (!response.ok) {
    const bodyText = await safeText(response);
    throw new Error(`HTTP ${response.status}${bodyText ? ` - ${bodyText.slice(0, 180)}` : ''}`);
  }

  const entries = await response.json();
  if (!Array.isArray(entries)) throw new Error('resposta inesperada do Google Routes');

  const size = points.length;
  const distanceMeters = matrix(size, null);
  const durationSeconds = matrix(size, null);
  for (let i = 0; i < size; i++) {
    distanceMeters[i][i] = 0;
    durationSeconds[i][i] = 0;
  }

  for (const item of entries) {
    const i = Number(item.originIndex);
    const j = Number(item.destinationIndex);
    if (!Number.isInteger(i) || !Number.isInteger(j)) continue;
    if (item.condition && item.condition !== 'ROUTE_EXISTS') continue;
    if (item.status && Number(item.status.code || 0) !== 0) continue;
    distanceMeters[i][j] = nullableNumber(item.distanceMeters);
    durationSeconds[i][j] = parseDuration(item.duration);
  }

  assertMatrixUsable(distanceMeters, durationSeconds);
  return {
    pointIds: points.map((point) => point.id),
    distanceMeters,
    durationSeconds,
    provider: 'Google Routes API',
    isRoadBased: true,
    warnings
  };
}

async function osrmMatrix(points, warnings) {
  const baseUrl = String(process.env.OSRM_BASE_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
  const coordinates = points.map((point) => `${point.longitude},${point.latitude}`).join(';');
  const url = `${baseUrl}/table/v1/driving/${coordinates}?annotations=distance,duration`;

  const response = await fetchWithTimeout(url, { headers: { 'User-Agent': 'RouteX-BelaMetais/2.2' } }, 15000);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.code !== 'Ok' || !Array.isArray(data.distances) || !Array.isArray(data.durations)) {
    throw new Error(data.message || data.code || 'resposta OSRM inválida');
  }

  assertMatrixUsable(data.distances, data.durations);
  return {
    pointIds: points.map((point) => point.id),
    distanceMeters: data.distances,
    durationSeconds: data.durations,
    provider: 'OSRM (distância e tempo por vias)',
    isRoadBased: true,
    warnings
  };
}

function haversineMatrix(points, warnings) {
  const size = points.length;
  const distanceMeters = matrix(size, 0);
  const durationSeconds = matrix(size, 0);
  const roadFactor = Number(process.env.HAVERSINE_ROAD_FACTOR || 1.25);
  const averageSpeedKmh = Number(process.env.HAVERSINE_AVERAGE_SPEED_KMH || 45);

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (i === j) continue;
      const estimatedKm = haversineKm(points[i], points[j]) * roadFactor;
      distanceMeters[i][j] = Math.round(estimatedKm * 1000);
      durationSeconds[i][j] = Math.round((estimatedKm / averageSpeedKmh) * 3600);
    }
  }

  return {
    pointIds: points.map((point) => point.id),
    distanceMeters,
    durationSeconds,
    provider: 'Fallback geográfico (Haversine ajustado)',
    isRoadBased: false,
    warnings
  };
}

function emptyMatrix(points, provider, warnings) {
  return { pointIds: points, distanceMeters: [], durationSeconds: [], provider, isRoadBased: false, warnings };
}

function googleWaypoint(point) {
  return {
    location: {
      latLng: {
        latitude: Number(point.latitude),
        longitude: Number(point.longitude)
      }
    }
  };
}

function matrix(size, initial) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => initial));
}

function parseDuration(value) {
  if (typeof value === 'number') return value;
  const match = String(value || '').match(/^([\d.]+)s$/);
  return match ? Number(match[1]) : null;
}

function nullableNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function assertMatrixUsable(distances, durations) {
  if (!distances.length || !durations.length) throw new Error('matriz vazia');
  let usable = 0;
  for (let i = 0; i < distances.length; i++) {
    for (let j = 0; j < distances.length; j++) {
      if (i !== j && Number.isFinite(Number(distances[i]?.[j])) && Number.isFinite(Number(durations[i]?.[j]))) usable++;
    }
  }
  if (usable === 0 && distances.length > 1) throw new Error('nenhum trajeto válido foi retornado');
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(response) {
  try { return await response.text(); } catch { return ''; }
}

module.exports = { buildDistanceMatrix };
