const express=require('express');const c=require('../controllers/cepController');const ah=require('../utils/asyncHandler');const r=express.Router();r.get('/:cep',ah(c.lookup));module.exports=r;
