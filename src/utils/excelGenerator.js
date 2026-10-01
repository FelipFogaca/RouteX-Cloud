const ExcelJS = require('exceljs');
async function generateRouteXlsxBuffer({stops}){
  const workbook=new ExcelJS.Workbook(); workbook.creator='RouteX'; workbook.created=new Date();
  const sheet=workbook.addWorksheet('Rota Otimizada',{pageSetup:{paperSize:9,orientation:'landscape'}});
  sheet.columns=[{header:'PV',key:'pv',width:16},{header:'NF',key:'nf',width:14},{header:'Volumes',key:'volumes',width:11},{header:'Destinatário',key:'recipient',width:34},{header:'Endereço',key:'address',width:66},{header:'Contato',key:'phone',width:20},{header:'Peso',key:'weight',width:14}];
  const header=sheet.getRow(1); header.height=26; header.eachCell(cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF008F83'}};cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};});
  stops.forEach(stop=>{const row=sheet.addRow({pv:stop.pv||'',nf:stop.nf||'',volumes:stop.volumes,recipient:stop.recipient||stop.locationName,address:stop.tableAddress||tableAddress(stop),phone:formatPhone(stop.phone),weight:stop.grossWeight});row.alignment={vertical:'top',wrapText:true};if(stop.grossWeight!==null&&stop.grossWeight!==undefined)row.getCell('weight').numFmt='0.000 "kg"';});
  sheet.views=[{state:'frozen',ySplit:1}]; sheet.autoFilter={from:'A1',to:'G1'}; sheet.getColumn('volumes').alignment={horizontal:'center'}; sheet.getColumn('weight').alignment={horizontal:'right'};
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
function tableAddress(s){ return [[s.street,s.number].filter(Boolean).join(', '),s.complement,s.neighborhood,[s.city,s.state].filter(Boolean).join('/'),].filter(Boolean).join(' - '); }
function formatPhone(v){const d=String(v||'').replace(/\D/g,'');if(!d)return'';if(d.length===11)return`(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;if(d.length===10)return`(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;return String(v||'');}
module.exports={generateRouteXlsxBuffer};
