const { lookupCep } = require('../services/cepService');

async function lookup(req, res) {
  try {
    const address = await lookupCep(req.params.cep);
    return res.json({ ok: true, address });
  } catch (error) {
    const status = error.code === 'INVALID_CEP' ? 400 : error.code === 'CEP_NOT_FOUND' ? 404 : 502;
    return res.status(status).json({ ok: false, message: error.message });
  }
}

module.exports = { lookup };
