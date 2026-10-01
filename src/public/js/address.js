document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-cep-form]').forEach(initCepForm);
});

function initCepForm(form) {
  const cepInput = form.querySelector('[data-cep]');
  const status = form.querySelector('[data-cep-status]');
  const street = form.querySelector('[data-address-street]');
  const neighborhood = form.querySelector('[data-address-neighborhood]');
  const city = form.querySelector('[data-address-city]');
  const state = form.querySelector('[data-address-state]');
  const number = form.querySelector('[data-address-number]');
  if (!cepInput || !street || !neighborhood || !city || !state) return;

  let lastLookup = '';
  let lookupTimer = null;

  cepInput.addEventListener('input', () => {
    cepInput.value = formatCep(cepInput.value);
    clearTimeout(lookupTimer);
    const digits = onlyDigits(cepInput.value);
    if (digits.length < 8) {
      setStatus(status, 'Informe os 8 dígitos do CEP para buscar o endereço.', 'idle');
      return;
    }
    lookupTimer = setTimeout(() => runLookup(digits), 180);
  });

  cepInput.addEventListener('blur', () => {
    const digits = onlyDigits(cepInput.value);
    if (digits.length === 8 && digits !== lastLookup) runLookup(digits);
  });

  async function runLookup(cep) {
    if (cep === lastLookup && street.value && city.value && state.value) return;
    lastLookup = cep;
    setStatus(status, 'Consultando CEP...', 'loading');
    cepInput.classList.add('field-loading');

    try {
      const response = await fetch(`/RouteX/api/cep/${cep}`, { headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || 'CEP não localizado.');

      const data = payload.address || {};
      street.value = data.street || '';
      neighborhood.value = data.neighborhood || '';
      city.value = data.city || '';
      state.value = data.state || '';
      cepInput.value = data.cep || formatCep(cep);
      const complete = Boolean(data.street && data.neighborhood && data.city && data.state);
      setStatus(status, complete
        ? `Endereço localizado${data.provider ? ` via ${data.provider}` : ''}. Confira e informe o número.`
        : `CEP localizado${data.provider ? ` via ${data.provider}` : ''}, mas alguns campos precisam ser preenchidos manualmente.`, 'success');
      if (complete && number) number.focus();
      else if (!data.street) street.focus();
      else if (!data.neighborhood) neighborhood.focus();
      else if (!data.city) city.focus();
      else if (!data.state) state.focus();
    } catch (error) {
      lastLookup = '';
      setStatus(status, `${error.message} Você pode preencher os campos manualmente.`, 'error');
      street.focus();
    } finally {
      cepInput.classList.remove('field-loading');
    }
  }
}

function setStatus(element, message, kind) {
  if (!element) return;
  element.textContent = message;
  element.dataset.kind = kind;
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 8);
}

function formatCep(value) {
  const digits = onlyDigits(value);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}
