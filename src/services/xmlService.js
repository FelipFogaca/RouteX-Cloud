const xml2js = require('xml2js');
const Address = require('../models/Address');

const parser = new xml2js.Parser({
  explicitArray: false,
  trim: true,
  tagNameProcessors: [xml2js.processors.stripPrefix]
});

async function readInvoiceXml(input, filename = 'arquivo.xml') {
  const xml = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  const parsed = await parser.parseStringPromise(xml);
  const nfe = parsed?.nfeProc?.NFe || parsed?.NFe;
  const infNFe = nfe?.infNFe;

  if (!infNFe) {
    throw new Error(`${filename}: estrutura NF-e invalida ou infNFe nao encontrado.`);
  }

  const ide = infNFe.ide || {};
  const emit = infNFe.emit || {};
  const dest = infNFe.dest || {};
  const enderEmit = emit.enderEmit || {};
  const enderDest = dest.enderDest || {};
  const total = infNFe.total?.ICMSTot || infNFe.total || {};
  const volumeData = summarizeVolumes(infNFe.transp?.vol);
  const pv = extractOrderNumber(infNFe);

  if (!dest.xNome || !enderDest.xLgr || !enderDest.xMun) {
    throw new Error(`${filename}: destinatario ou endereco da NF-e esta incompleto.`);
  }

  const delivery = new Address({
    sourceType: 'nfe',
    pv,
    nf: value(ide.nNF),
    volumes: volumeData.volumes,
    grossWeight: volumeData.grossWeight,
    invoiceValue: numberValue(total.vNF),
    recipient: value(dest.xNome) || 'Destinatario nao informado',
    street: value(enderDest.xLgr),
    number: value(enderDest.nro),
    complement: value(enderDest.xCpl),
    neighborhood: value(enderDest.xBairro),
    city: value(enderDest.xMun),
    state: value(enderDest.UF),
    zipCode: value(enderDest.CEP),
    phone: value(enderDest.fone || dest.fone)
  });

  // O remetente e preservado como opcao de origem, mas sem complemento.
  const origin = new Address({
    sourceType: 'origin',
    recipient: value(emit.xNome) || 'Remetente da NF-e',
    locationName: value(emit.xNome) || 'Origem do remetente',
    street: value(enderEmit.xLgr),
    number: value(enderEmit.nro),
    complement: '',
    neighborhood: value(enderEmit.xBairro),
    city: value(enderEmit.xMun),
    state: value(enderEmit.UF),
    zipCode: value(enderEmit.CEP),
    phone: value(enderEmit.fone)
  });

  return { delivery, origin };
}

async function readInvoiceXmlFiles(files = []) {
  const deliveries = [];
  const errors = [];
  let origin = null;
  for (const file of files) {
    try {
      const parsed = await readInvoiceXml(file.buffer ?? file, file.originalname || file.filename || 'arquivo.xml');
      deliveries.push(parsed.delivery);
      if (!origin) origin = parsed.origin;
    } catch (error) { errors.push(error.message); }
  }
  return { deliveries, origin, errors };
}

function extractOrderNumber(infNFe) {
  const details = infNFe?.det ? (Array.isArray(infNFe.det) ? infNFe.det : [infNFe.det]) : [];
  const values = [];

  for (const detail of details) {
    const xPed = value(detail?.prod?.xPed);
    if (xPed && !values.includes(xPed)) values.push(xPed);
  }

  if (values.length) return values.join(' / ');

  const additional = value(infNFe?.infAdic?.infCpl);
  if (!additional) return '';

  const patterns = [
    /\bPV\s*[:#-]?\s*([A-Z0-9./_-]+)/i,
    /\bPEDIDO(?:\s+DE\s+VENDA)?\s*[:#-]?\s*([A-Z0-9./_-]+)/i,
    /\bN(?:[Oº°]|RO)?\.?\s*PEDIDO\s*[:#-]?\s*([A-Z0-9./_-]+)/i
  ];

  for (const pattern of patterns) {
    const match = additional.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function summarizeVolumes(volumeInput) {
  const volumes = !volumeInput ? [] : (Array.isArray(volumeInput) ? volumeInput : [volumeInput]);
  let volumeTotal = 0;
  let grossWeightTotal = 0;
  let hasVolume = false;
  let hasWeight = false;

  for (const volume of volumes) {
    const quantity = numberValue(volume?.qVol);
    const weight = numberValue(volume?.pesoB);
    if (quantity !== null) { volumeTotal += quantity; hasVolume = true; }
    if (weight !== null) { grossWeightTotal += weight; hasWeight = true; }
  }

  return {
    volumes: hasVolume ? volumeTotal : null,
    grossWeight: hasWeight ? grossWeightTotal : null
  };
}

function value(input) {
  if (input === null || input === undefined) return '';
  if (typeof input === 'object' && '_' in input) return String(input._).trim();
  return String(input).trim();
}

function numberValue(input) {
  const text = value(input);
  if (!text) return null;
  const parsed = Number(text.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

module.exports = { readInvoiceXml, readInvoiceXmlFiles };
