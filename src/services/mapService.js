function buildGoogleMapsLinks(origin, orderedStops = []) {
  if (!origin || orderedStops.length === 0) return [];
  const maxPoints = Math.max(2, Number(process.env.MAPS_MAX_POINTS_PER_LINK || 10));
  const allPoints = [origin, ...orderedStops];
  const links = [];
  let startIndex = 0;
  let part = 1;

  while (startIndex < allPoints.length - 1) {
    const segment = allPoints.slice(startIndex, startIndex + maxPoints);
    if (segment.length < 2) break;
    links.push({
      part,
      fromLabel: startIndex === 0 ? 'Origem' : labelFor(allPoints[startIndex]),
      toLabel: labelFor(segment[segment.length - 1]),
      // Para o Maps, prefira o endereco completo sem complemento. O proprio Google
      // geocodifica o numero/CEP e nao fica preso a uma coordenada aproximada usada
      // internamente pelo OSRM. Coordenadas ficam apenas como fallback.
      url: buildDirectionsUrl(segment.map(mapPoint))
    });
    startIndex += segment.length - 1;
    part++;
  }
  return links;
}

function mapPoint(item) {
  if (item?.routeAddress) return item.routeAddress;
  const latitude = Number(item?.latitude);
  const longitude = Number(item?.longitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) return `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  return '';
}

function buildDirectionsUrl(addresses) {
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('origin', addresses[0]);
  url.searchParams.set('destination', addresses[addresses.length - 1]);
  url.searchParams.set('travelmode', 'driving');
  const waypoints = addresses.slice(1, -1);
  if (waypoints.length) url.searchParams.set('waypoints', waypoints.join('|'));
  return url.toString();
}

function labelFor(stop) {
  return stop.nf ? `NF ${stop.nf}` : stop.displayName;
}

module.exports = { buildGoogleMapsLinks, mapPoint };
