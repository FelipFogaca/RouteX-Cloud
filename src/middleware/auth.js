function ensureAuthenticated(req,res,next){ if(req.session?.user) return next(); req.flash('error_msg','Faça login para acessar o RouteX.'); return res.redirect('/auth/login'); }
function ensureGuest(req,res,next){ if(req.session?.user) return res.redirect('/dashboard'); return next(); }
function ensureAdmin(req,res,next){ if(req.session?.user?.role==='admin') return next(); req.flash('error_msg','Acesso restrito ao administrador.'); return res.redirect('/dashboard'); }
function enforcePasswordChange(req,res,next){ if(!req.session?.user?.mustChangePassword) return next(); if(req.path.startsWith('/auth/change-password')||req.path==='/auth/logout') return next(); req.flash('warning_msg','Defina uma nova senha antes de continuar.'); return res.redirect('/auth/change-password'); }
module.exports={ensureAuthenticated,ensureGuest,ensureAdmin,enforcePasswordChange};
