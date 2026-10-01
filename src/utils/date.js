const { DateTime } = require('luxon');
const ZONE='America/Sao_Paulo';
function formatDateTime(value){ if(!value) return '—'; return DateTime.fromJSDate(value instanceof Date?value:new Date(value),{zone:'utc'}).setZone(ZONE).toFormat('dd/LL/yyyy HH:mm'); }
function formatDate(value){ if(!value) return '—'; return DateTime.fromJSDate(value instanceof Date?value:new Date(value),{zone:'utc'}).setZone(ZONE).toFormat('dd/LL/yyyy'); }
function localInputParts(value){ const d=DateTime.fromJSDate(value instanceof Date?value:new Date(value),{zone:'utc'}).setZone(ZONE); return {date:d.toFormat('yyyy-MM-dd'),time:d.toFormat('HH:mm')}; }
module.exports={ZONE,formatDateTime,formatDate,localInputParts};
