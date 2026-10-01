const routes=require('../repositories/routeRepository'); const appointments=require('../repositories/appointmentRepository');
async function index(req,res){const [myRoutes,myAppointments]=await Promise.all([routes.listByUser(req.session.user.id,5),appointments.listByUser(req.session.user.id)]);res.render('dashboard',{pageTitle:'Central logística',recentRoutes:myRoutes,recentAppointments:myAppointments.filter(a=>a.status==='active').slice(0,5)});}
module.exports={index};
