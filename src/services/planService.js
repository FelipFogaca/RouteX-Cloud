const Address = require('../models/Address');

function emptyPlan() {
  return {
    origin: null,
    xmlOrigin: null,
    stops: [],
    rules: [],
    finalStopId: null,
    result: null,
    matrix: null,
    updatedAt: new Date().toISOString()
  };
}

function getPlan(req) {
  if (!req.session.routePlan) req.session.routePlan = emptyPlan();
  if (!Object.prototype.hasOwnProperty.call(req.session.routePlan, 'xmlOrigin')) req.session.routePlan.xmlOrigin = null;
  if (!Object.prototype.hasOwnProperty.call(req.session.routePlan, 'finalStopId')) req.session.routePlan.finalStopId = null;
  return req.session.routePlan;
}

function resetPlan(req) {
  req.session.routePlan = emptyPlan();
  return req.session.routePlan;
}

function invalidateResult(plan) {
  plan.result = null;
  plan.matrix = null;
  plan.updatedAt = new Date().toISOString();
}

function addressesFromPlan(plan) {
  return {
    origin: plan.origin ? new Address(plan.origin) : null,
    xmlOrigin: plan.xmlOrigin ? new Address(plan.xmlOrigin) : null,
    stops: (plan.stops || []).map((stop) => new Address(stop))
  };
}

function saveAddressesToPlan(plan, origin, stops) {
  plan.origin = origin ? origin.toJSON() : null;
  plan.stops = stops.map((stop) => stop.toJSON());
  plan.updatedAt = new Date().toISOString();
}

module.exports = { getPlan, resetPlan, invalidateResult, addressesFromPlan, saveAddressesToPlan };
