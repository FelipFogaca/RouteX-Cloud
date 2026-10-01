const express=require('express');const c=require('../controllers/dashboardController');const ah=require('../utils/asyncHandler');const r=express.Router();r.get('/',ah(c.index));module.exports=r;
