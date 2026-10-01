function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineKm(pointA, pointB) {
  const earthRadiusKm = 6371;
  const latDistance = toRadians(Number(pointB.latitude) - Number(pointA.latitude));
  const lonDistance = toRadians(Number(pointB.longitude) - Number(pointA.longitude));
  const a = Math.sin(latDistance / 2) ** 2 +
    Math.cos(toRadians(Number(pointA.latitude))) *
    Math.cos(toRadians(Number(pointB.latitude))) *
    Math.sin(lonDistance / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

module.exports = { haversineKm };
