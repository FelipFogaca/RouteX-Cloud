const Address = require('../models/Address');
const locationRepository = require('../repositories/locationRepository');
const { readInvoiceXmlFiles } = require('../services/xmlService');
const { geocodeStops } = require('../services/geocodingService');
const { buildDistanceMatrix } = require('../services/distanceMatrixService');
const { createRule, findCycle, isOrderValid, orderViolations, rulesWithFinalStop } = require('../services/precedenceService');
const { optimizeRoute, calculateSequenceMetrics } = require('../services/routeOptimizerService');
const { buildGoogleMapsLinks } = require('../services/mapService');
const { getPlan, resetPlan, invalidateResult, addressesFromPlan, saveAddressesToPlan } = require('../services/planService');
const { generateRouteXlsxBuffer } = require('../utils/excelGenerator');
const routeRepository = require('../repositories/routeRepository');
const { normalizeCep, formatCep } = require('../services/cepService');

async function showPlanner(req, res) {
  const plan = getPlan(req);
  const { origin, xmlOrigin, stops } = addressesFromPlan(plan);
  const stopById = new Map(stops.map((stop) => [stop.id, stop]));
  const result = buildResultView(plan, origin, stopById);
  res.render('planner', {
    pageTitle: 'Planejador de rotas', origin, xmlOrigin, stops,
    rules: (plan.rules || []).map((rule) => ({ ...rule, before: stopById.get(rule.beforeId), after: stopById.get(rule.afterId) })),
    finalStop: plan.finalStopId ? stopById.get(plan.finalStopId) || null : null,
    savedLocations: await locationRepository.list(), result
  });
}

async function importXmls(req, res) {
  const plan = getPlan(req);
  const uploadedFiles = Array.isArray(req.files) ? req.files : [];
  if (!uploadedFiles.length) { req.flash('error_msg', 'Selecione pelo menos um arquivo XML de NF-e.'); return res.redirect('/RouteX'); }
  const totalBytes = uploadedFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
  if (totalBytes > 4 * 1024 * 1024) { req.flash('error_msg', 'O lote ultrapassa 4 MB. Na Vercel, divida os XMLs em dois ou mais lotes; o planejamento atual será preservado entre as importações.'); return res.redirect('/RouteX'); }
  try {
    const parsed = await readInvoiceXmlFiles(uploadedFiles);
    const { stops } = addressesFromPlan(plan);
    const existingKeys = new Set(stops.filter((stop) => stop.sourceType === 'nfe').map(invoiceKey));
    let added = 0;
    for (const delivery of parsed.deliveries) { const key = invoiceKey(delivery); if (existingKeys.has(key)) continue; stops.push(delivery); existingKeys.add(key); added++; }
    const normalizedXmlOrigin = parsed.origin ? await normalizeXmlOriginWithSavedLocation(parsed.origin) : null;
    if (normalizedXmlOrigin && !plan.xmlOrigin) plan.xmlOrigin = normalizedXmlOrigin.toJSON();
    if (!plan.origin && normalizedXmlOrigin) plan.origin = normalizedXmlOrigin.toJSON();
    plan.stops = stops.map((stop) => stop.toJSON()); invalidateResult(plan);
    if (parsed.errors.length) req.flash('warning_msg', parsed.errors.join(' | '));
    if (added) req.flash('success_msg', `${added} entrega${added > 1 ? 's' : ''} adicionada${added > 1 ? 's' : ''} à preparação da rota.`);
    else req.flash('warning_msg', 'Nenhuma nova NF-e foi adicionada; as notas selecionadas já estavam na preparação ou não eram válidas.');
  } catch (error) { req.flash('error_msg', `Não foi possível importar os XMLs: ${error.message}`); }
  return res.redirect('/RouteX');
}

async function setSavedOrigin(req, res) {
  const plan = getPlan(req); const location = await locationRepository.findById(req.body.locationId);
  if (!location) { req.flash('error_msg', 'Selecione um local cadastrado válido para a partida.'); return res.redirect('/RouteX#origem'); }
  plan.origin = originFromLocation(location).toJSON(); invalidateResult(plan); req.flash('success_msg', `${location.name} definido como endereço de partida.`); return res.redirect('/RouteX#origem');
}

function setManualOrigin(req, res) {
  const plan = getPlan(req);
  try {
    const origin = new Address({
      sourceType: 'origin',
      locationName: String(req.body.name || 'Origem manual').trim(),
      recipient: String(req.body.name || 'Origem manual').trim(),
      street: req.body.street,
      number: req.body.number,
      complement: req.body.complement,
      neighborhood: req.body.neighborhood,
      city: req.body.city,
      state: req.body.state,
      zipCode: formatCep(req.body.zipCode),
      phone: req.body.phone
    });
    validateOrigin(origin);
    plan.origin = origin.toJSON();
    invalidateResult(plan);
    req.flash('success_msg', 'Endereco manual definido como partida da rota.');
  } catch (error) {
    req.flash('error_msg', error.message);
  }
  return res.redirect('/RouteX#origem');
}

async function useXmlOrigin(req, res) {
  const plan = getPlan(req); if (!plan.xmlOrigin) { req.flash('error_msg', 'Nenhum remetente de NF-e está disponível. Importe um XML primeiro.'); return res.redirect('/RouteX#origem'); }
  plan.origin = (await normalizeXmlOriginWithSavedLocation(new Address(plan.xmlOrigin))).toJSON(); invalidateResult(plan); req.flash('success_msg', 'Remetente da NF-e definido como partida da rota.'); return res.redirect('/RouteX#origem');
}

function addManualStop(req, res) {
  const plan = getPlan(req);
  try {
    const stop = new Address({
      sourceType: req.body.sourceType === 'pickup' ? 'pickup' : 'manual',
      locationName: String(req.body.name || '').trim(),
      recipient: String(req.body.name || '').trim(),
      street: req.body.street,
      number: req.body.number,
      complement: req.body.complement,
      neighborhood: req.body.neighborhood,
      city: req.body.city,
      state: req.body.state,
      zipCode: formatCep(req.body.zipCode),
      phone: req.body.phone,
      notes: req.body.notes
    });
    validateStop(stop);
    plan.stops.push(stop.toJSON());
    invalidateResult(plan);
    req.flash('success_msg', 'Parada manual adicionada.');
  } catch (error) {
    req.flash('error_msg', error.message);
  }
  return res.redirect('/RouteX#preparacao');
}

async function addSavedLocation(req, res) {
  const plan = getPlan(req); const location = await locationRepository.findById(req.body.locationId);
  if (!location) { req.flash('error_msg', 'Selecione um local cadastrado válido.'); return res.redirect('/RouteX#preparacao'); }
  const occurrences = plan.stops.filter((stop) => Number(stop.savedLocationId) === Number(location.id)).map((stop) => Number(stop.savedLocationOccurrence || 1)).filter(Number.isFinite);
  const occurrence = occurrences.length ? Math.max(...occurrences) + 1 : 1; const stop = addressFromLocation(location, occurrence); plan.stops.push(stop.toJSON());
  await normalizeSavedLocationLabels(plan.stops, location.id); invalidateResult(plan); req.flash('success_msg', `${location.name} adicionado à rota${occurrence > 1 ? ` como passagem ${occurrence}` : ''}.`); return res.redirect('/RouteX#preparacao');
}

async function removeStop(req, res) {
  const plan=getPlan(req); const index=plan.stops.findIndex((stop)=>stop.id===req.params.stopId); if(index<0){req.flash('error_msg','Parada não encontrada.');return res.redirect('/RouteX#preparacao');}
  const [removed]=plan.stops.splice(index,1); plan.rules=(plan.rules||[]).filter((rule)=>rule.beforeId!==removed.id&&rule.afterId!==removed.id); if(plan.finalStopId===removed.id) plan.finalStopId=null; if(removed.savedLocationId) await normalizeSavedLocationLabels(plan.stops,removed.savedLocationId); invalidateResult(plan); req.flash('success_msg','Parada removida da preparação.'); return res.redirect('/RouteX#preparacao');
}

function addRule(req, res) {
  const plan = getPlan(req);
  const { stops } = addressesFromPlan(plan);
  try {
    const rule = createRule({
      firstId: String(req.body.firstId || ''),
      relation: req.body.relation === 'after' ? 'after' : 'before',
      secondId: String(req.body.secondId || ''),
      stops,
      existingRules: plan.rules || []
    });
    const candidateRules = [...(plan.rules || []), rule];
    const effectiveRules = rulesWithFinalStop(stops, candidateRules, plan.finalStopId || null);
    const cycle = findCycle(stops.map((stop) => stop.id), effectiveRules);
    if (cycle.length && plan.finalStopId) throw new Error('Esta regra conflita com o destino final definido. Remova o destino final ou altere a regra.');
    plan.rules.push(rule);
    invalidateResult(plan);
    req.flash('success_msg', 'Regra de precedencia adicionada.');
  } catch (error) {
    req.flash('error_msg', error.message);
  }
  return res.redirect('/RouteX#regras');
}

function setFinalDestination(req, res) {
  const plan = getPlan(req);
  const { stops } = addressesFromPlan(plan);
  const finalStopId = String(req.body.finalStopId || '');
  const selected = stops.find((stop) => stop.id === finalStopId);
  if (!selected) {
    req.flash('error_msg', 'Selecione uma parada válida para ser o destino final.');
    return res.redirect('/RouteX#regras');
  }

  try {
    const effectiveRules = rulesWithFinalStop(stops, plan.rules || [], finalStopId);
    const cycle = findCycle(stops.map((stop) => stop.id), effectiveRules);
    if (cycle.length) throw new Error('O destino final selecionado conflita com uma regra de precedência existente.');
    plan.finalStopId = finalStopId;
    invalidateResult(plan);
    req.flash('success_msg', `${selected.displayName} definido como destino final da rota.`);
  } catch (error) {
    req.flash('error_msg', error.message);
  }
  return res.redirect('/RouteX#regras');
}

function clearFinalDestination(req, res) {
  const plan = getPlan(req);
  plan.finalStopId = null;
  invalidateResult(plan);
  req.flash('success_msg', 'Destino final removido. A última parada voltará a ser definida pela otimização.');
  return res.redirect('/RouteX#regras');
}

function removeRule(req, res) {
  const plan = getPlan(req);
  plan.rules = (plan.rules || []).filter((rule) => rule.id !== req.params.ruleId);
  invalidateResult(plan);
  req.flash('success_msg', 'Regra removida.');
  return res.redirect('/RouteX#regras');
}

async function optimize(req, res) {
  const plan = getPlan(req); let { origin, stops } = addressesFromPlan(plan);
  if (!origin) { req.flash('error_msg', 'Defina o endereço de partida antes de otimizar a rota.'); return res.redirect('/RouteX#origem'); }
  if (!stops.length) { req.flash('error_msg', 'Adicione pelo menos uma parada antes de otimizar.'); return res.redirect('/RouteX#otimizacao'); }
  try {
    const geo=await geocodeStops([origin,...stops]); origin=geo.addresses[0]; stops=geo.addresses.slice(1); saveAddressesToPlan(plan,origin,stops); if(geo.warnings.length) req.flash('warning_msg',geo.warnings.join(' | '));
    if(geo.failures.length){const failedNames=geo.failures.map((stop)=>`${stop.displayName} (${stop.tableAddress||stop.routeAddress})`).join('; ');req.flash('error_msg',`A rota não foi gerada porque não foi possível localizar com segurança: ${failedNames}. Corrija o endereço e tente novamente.`);return res.redirect('/RouteX#preparacao');}
    const matrix=await buildDistanceMatrix([origin,...stops]); const optimized=optimizeRoute({origin,stops,rules:plan.rules||[],finalStopId:plan.finalStopId||null,matrix}); const orderedStops=optimized.sequenceIds.map((id)=>stops.find((stop)=>stop.id===id)).filter(Boolean);
    plan.matrix={pointIds:matrix.pointIds,distanceMeters:matrix.distanceMeters,durationSeconds:matrix.durationSeconds,provider:matrix.provider,isRoadBased:matrix.isRoadBased};
    plan.result={sequenceIds:optimized.sequenceIds,totalDistanceMeters:optimized.totalDistanceMeters,totalDurationSeconds:optimized.totalDurationSeconds,metricsComplete:optimized.metricsComplete,legs:optimized.legs,provider:matrix.provider,isRoadBased:matrix.isRoadBased,warnings:matrix.warnings||[],algorithm:optimized.algorithm,finalStopId:plan.finalStopId||null,mapLinks:buildGoogleMapsLinks(origin,orderedStops),generatedAt:new Date().toISOString()};
    const saved=await routeRepository.create({userId:req.session.user.id,title:String(req.body.routeTitle||'').trim(),origin:origin.toJSON(),stops:stops.map(s=>s.toJSON()),rules:plan.rules||[],finalStopId:plan.finalStopId||null,result:plan.result}); plan.result.savedRouteId=saved.id;
    if(matrix.warnings?.length) req.flash('warning_msg',matrix.warnings.join(' | ')); req.flash('success_msg','Rota otimizada e salva no seu histórico.'); return res.redirect('/RouteX#resultado');
  } catch(error){req.flash('error_msg',`Não foi possível otimizar a rota: ${error.message}`);return res.redirect('/RouteX#otimizacao');}
}

async function reorder(req, res) {
  const plan=getPlan(req); if(!plan.result||!plan.matrix){req.flash('error_msg','Gere a rota antes de ajustar manualmente a ordem.');return res.redirect('/RouteX');}
  const sequence=[...plan.result.sequenceIds],index=sequence.indexOf(req.body.stopId),direction=req.body.direction==='up'?-1:1,target=index+direction; if(index<0||target<0||target>=sequence.length)return res.redirect('/RouteX#resultado'); [sequence[index],sequence[target]]=[sequence[target],sequence[index]];
  if(plan.finalStopId&&sequence[sequence.length-1]!==plan.finalStopId){req.flash('error_msg','O ajuste foi bloqueado porque a parada definida como destino final deve permanecer na última posição.');return res.redirect('/RouteX#resultado');}
  if(!isOrderValid(sequence,plan.rules||[])){const {stops}=addressesFromPlan(plan),byId=new Map(stops.map(s=>[s.id,s]));const violations=orderViolations(sequence,plan.rules||[]).map(rule=>`${byId.get(rule.beforeId)?.displayName} antes de ${byId.get(rule.afterId)?.displayName}`);req.flash('error_msg',`O ajuste foi bloqueado porque violaria: ${violations.join('; ')}.`);return res.redirect('/RouteX#resultado');}
  const {origin,stops}=addressesFromPlan(plan),metrics=calculateSequenceMetrics(origin.id,sequence,plan.matrix),orderedStops=sequence.map(id=>stops.find(s=>s.id===id)).filter(Boolean); plan.result={...plan.result,sequenceIds:sequence,...metrics,mapLinks:buildGoogleMapsLinks(origin,orderedStops),generatedAt:new Date().toISOString()};
  if(plan.result.savedRouteId) await routeRepository.updateResult(plan.result.savedRouteId,req.session.user.id,{stops:stops.map(s=>s.toJSON()),result:plan.result}); req.flash('success_msg','Sequência ajustada e histórico atualizado.'); return res.redirect('/RouteX#resultado');
}

async function exportXlsx(req, res) {
  const plan=getPlan(req); if(!plan.result){req.flash('error_msg','Gere a rota antes de exportar a planilha.');return res.redirect('/RouteX');}
  const {stops}=addressesFromPlan(plan),orderedStops=plan.result.sequenceIds.map(id=>stops.find(stop=>stop.id===id)).filter(Boolean); try{const buffer=await generateRouteXlsxBuffer({stops:orderedStops});const filename=`RouteX-rota-${plan.result.savedRouteId||Date.now()}.xlsx`;res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);return res.send(buffer);}catch(error){req.flash('error_msg',`Não foi possível gerar o XLSX: ${error.message}`);return res.redirect('/RouteX#resultado');}
}

function clearPlan(req, res) {
  resetPlan(req);
  req.flash('success_msg', 'Planejamento atual limpo.');
  return res.redirect('/RouteX');
}

function buildResultView(plan, origin, stopById) {
  if (!plan.result) return null;
  const legByStop = new Map((plan.result.legs || []).map((leg) => [leg.toId, leg]));
  const orderedStops = (plan.result.sequenceIds || []).map((id) => stopById.get(id)).filter(Boolean);
  return {
    ...plan.result,
    orderedStops: orderedStops.map((stop) => ({ stop, leg: legByStop.get(stop.id) || null })),
    mapLinks: buildGoogleMapsLinks(origin, orderedStops)
  };
}

function validateStop(stop) {
  if (!stop.locationName) throw new Error('Informe o nome da parada.');
  if (!stop.zipCode || !stop.street || !stop.number || !stop.neighborhood || !stop.city || !stop.state) {
    throw new Error('Preencha CEP, logradouro, numero, bairro, cidade e UF da parada.');
  }
  if (normalizeCep(stop.zipCode).length !== 8) throw new Error('Informe um CEP valido com 8 digitos para a parada.');
  if (stop.state.length !== 2) throw new Error('Informe a UF com 2 letras.');
}

function validateOrigin(origin) {
  if (!origin.locationName) throw new Error('Informe um nome para a origem.');
  if (!origin.zipCode || !origin.street || !origin.number || !origin.neighborhood || !origin.city || !origin.state) {
    throw new Error('Preencha CEP, logradouro, numero, bairro, cidade e UF da origem.');
  }
  if (normalizeCep(origin.zipCode).length !== 8) throw new Error('Informe um CEP valido com 8 digitos para a origem.');
  if (origin.state.length !== 2) throw new Error('Informe a UF com 2 letras.');
}

function addressFromLocation(location, occurrence = 1) {
  return new Address({
    sourceType: location.location_type === 'store' ? 'store' : 'saved',
    savedLocationId: location.id,
    savedLocationOccurrence: occurrence,
    locationName: location.name,
    recipient: location.name,
    street: location.street,
    number: location.number,
    complement: location.complement,
    neighborhood: location.neighborhood,
    city: location.city,
    state: location.state,
    zipCode: location.zip_code,
    phone: location.phone,
    notes: location.notes
  });
}

async function normalizeSavedLocationLabels(stops, savedLocationId) {
  const location=await locationRepository.findById(savedLocationId); if(!location)return; const matching=stops.filter(stop=>Number(stop.savedLocationId)===Number(savedLocationId)); if(matching.length<=1){if(matching[0])matching[0].locationName=location.name;return;} matching.sort((a,b)=>Number(a.savedLocationOccurrence||1)-Number(b.savedLocationOccurrence||1)).forEach((stop,index)=>{stop.savedLocationOccurrence=index+1;stop.locationName=`${location.name} - passagem ${index+1}`;stop.recipient=location.name;});
}

function originFromLocation(location) {
  return new Address({
    sourceType: 'origin',
    savedLocationId: location.id,
    locationName: location.name,
    recipient: location.name,
    street: location.street,
    number: location.number,
    complement: location.complement,
    neighborhood: location.neighborhood,
    city: location.city,
    state: location.state,
    zipCode: location.zip_code,
    phone: location.phone,
    notes: location.notes
  });
}

async function normalizeXmlOriginWithSavedLocation(originInput) {
  const origin=originInput instanceof Address?originInput:new Address(originInput),originZip=normalizeCep(origin.zipCode),originStreet=normalizeTextForMatch(origin.street),originCity=normalizeTextForMatch(origin.city),originNumber=normalizeNumberForMatch(origin.number); if(!originZip||!originStreet||!originCity)return origin;
  const saved=(await locationRepository.list()).find(location=>{if(normalizeCep(location.zip_code)!==originZip)return false;if(normalizeTextForMatch(location.city)!==originCity)return false;if(normalizeTextForMatch(location.street)!==originStreet)return false;const savedNumber=normalizeNumberForMatch(location.number);return !originNumber||!savedNumber||savedNumber===originNumber;}); if(!saved)return origin;
  return new Address({...origin.toJSON(),street:saved.street,number:saved.number||origin.number,complement:'',neighborhood:saved.neighborhood||origin.neighborhood,city:saved.city||origin.city,state:saved.state||origin.state,zipCode:saved.zip_code||origin.zipCode});
}

function normalizeTextForMatch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeNumberForMatch(value) {
  const text = String(value || '').trim();
  return /^\d+$/.test(text) ? String(Number(text)) : normalizeTextForMatch(text);
}

function invoiceKey(stop) {
  return `${stop.nf}|${stop.recipient}|${stop.routeAddress}`.toLowerCase();
}

module.exports = {
  showPlanner,
  importXmls,
  setSavedOrigin,
  setManualOrigin,
  useXmlOrigin,
  addManualStop,
  addSavedLocation,
  removeStop,
  addRule,
  removeRule,
  setFinalDestination,
  clearFinalDestination,
  optimize,
  reorder,
  exportXlsx,
  clearPlan
};
