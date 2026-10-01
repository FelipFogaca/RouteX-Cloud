const { randomUUID } = require('crypto');

class Address {
  constructor({
    id = randomUUID(),
    sourceType = 'manual',
    savedLocationId = null,
    savedLocationOccurrence = null,
    pv = '',
    nf = '',
    volumes = null,
    grossWeight = null,
    invoiceValue = null,
    recipient = '',
    locationName = '',
    street = '',
    number = '',
    complement = '',
    neighborhood = '',
    city = '',
    state = '',
    zipCode = '',
    phone = '',
    notes = '',
    latitude = null,
    longitude = null,
    geocodingProvider = ''
  } = {}) {
    this.id = String(id || randomUUID());
    this.sourceType = normalizeSourceType(sourceType);
    this.savedLocationId = savedLocationId === null || savedLocationId === undefined ? null : Number(savedLocationId);
    this.savedLocationOccurrence = savedLocationOccurrence === null || savedLocationOccurrence === undefined ? null : Number(savedLocationOccurrence);
    this.pv = cleanText(pv);
    this.nf = cleanText(nf);
    this.volumes = toNullableNumber(volumes);
    this.grossWeight = toNullableNumber(grossWeight);
    this.invoiceValue = toNullableNumber(invoiceValue);
    this.recipient = cleanText(recipient);
    this.locationName = cleanText(locationName);
    this.street = cleanText(street);
    this.number = cleanText(number);
    this.complement = cleanText(complement);
    this.neighborhood = cleanText(neighborhood);
    this.city = cleanText(city);
    this.state = cleanText(state).toUpperCase();
    this.zipCode = cleanText(zipCode);
    this.phone = cleanText(phone);
    this.notes = cleanText(notes);
    this.latitude = toNullableNumber(latitude);
    this.longitude = toNullableNumber(longitude);
    this.geocodingProvider = cleanText(geocodingProvider);
  }

  get geocoded() {
    return Number.isFinite(this.latitude) && Number.isFinite(this.longitude);
  }

  // Usado na geocodificacao e nos links de rota: propositalmente sem complemento.
  get routeAddress() {
    const line = [this.street, normalizeRouteNumber(this.number)].filter(Boolean).join(', ');
    const locality = [this.city, this.state].filter(Boolean).join(' - ');
    const parts = [line, this.neighborhood, locality, formatZipCode(this.zipCode), 'Brasil'];
    return parts.filter(Boolean).join(', ');
  }

  // Endereco operacional exibido/exportado: inclui complemento, mas nao inclui CEP.
  get tableAddress() {
    const line = [this.street, this.number].filter(Boolean).join(', ');
    const locality = [this.city, this.state].filter(Boolean).join('/');
    return [line, this.complement, this.neighborhood, locality].filter(Boolean).join(' - ');
  }

  // Remetente importado: exibicao enxuta, sem complemento e sem CEP.
  get originAddress() {
    const line = [this.street, this.number].filter(Boolean).join(', ');
    return [line, this.neighborhood, this.city].filter(Boolean).join(' - ');
  }

  get displayName() {
    if (this.nf) return `NF ${this.nf}`;
    return this.locationName || this.recipient || 'Parada sem identificacao';
  }

  get typeLabel() {
    const labels = {
      nfe: 'NF-e',
      store: 'Loja',
      manual: 'Manual',
      pickup: 'Coleta',
      saved: 'Local cadastrado',
      origin: 'Origem'
    };
    return labels[this.sourceType] || 'Parada';
  }

  toJSON() {
    return {
      id: this.id,
      sourceType: this.sourceType,
      savedLocationId: this.savedLocationId,
      savedLocationOccurrence: this.savedLocationOccurrence,
      pv: this.pv,
      nf: this.nf,
      volumes: this.volumes,
      grossWeight: this.grossWeight,
      invoiceValue: this.invoiceValue,
      recipient: this.recipient,
      locationName: this.locationName,
      street: this.street,
      number: this.number,
      complement: this.complement,
      neighborhood: this.neighborhood,
      city: this.city,
      state: this.state,
      zipCode: this.zipCode,
      phone: this.phone,
      notes: this.notes,
      latitude: this.latitude,
      longitude: this.longitude,
      geocodingProvider: this.geocodingProvider
    };
  }
}

function normalizeSourceType(value) {
  const allowed = new Set(['nfe', 'store', 'manual', 'pickup', 'saved', 'origin']);
  const normalized = cleanText(value).toLowerCase();
  return allowed.has(normalized) ? normalized : 'manual';
}

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function toNullableNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const normalized = typeof value === 'string' ? value.replace(/\s/g, '').replace(',', '.') : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRouteNumber(value) {
  const text = cleanText(value);
  if (/^\d+$/.test(text)) return String(Number(text));
  return text;
}

function formatZipCode(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length !== 8) return cleanText(value);
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

module.exports = Address;
