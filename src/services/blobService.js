const { put, get, del } = require('@vercel/blob');
async function uploadSpreadsheet({appointmentId,file}){
  if(!file?.buffer) return null;
  const safe=String(file.originalname||'planilha.xlsx').replace(/[^a-zA-Z0-9._-]/g,'_');
  const pathname=`routex/appointments/${appointmentId}/${Date.now()}-${safe}`;
  try { const blob=await put(pathname,file.buffer,{access:'private',contentType:file.mimetype||'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',addRandomSuffix:false}); return {pathname:blob.pathname||pathname,url:blob.url}; }
  catch(error){ throw new Error(`Não foi possível armazenar o anexo. Configure o Vercel Private Blob. Detalhe: ${error.message}`); }
}
async function download(pathname){ const result=await get(pathname,{access:'private',useCache:false}); if(!result) throw new Error('Anexo não encontrado no armazenamento.'); return result; }
async function remove(pathname){ if(pathname) await del(pathname); }
module.exports={uploadSpreadsheet,download,remove};
