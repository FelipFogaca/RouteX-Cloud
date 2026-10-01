const {randomUUID}=require('crypto'); const db=require('../database/db');
async function create({appointmentId,blobPath,originalName,contentType,sizeBytes}){const id=randomUUID();await db.query(`INSERT INTO appointment_attachments(id,appointment_id,blob_path,original_name,content_type,size_bytes) VALUES($1,$2,$3,$4,$5,$6)`,[id,appointmentId,blobPath,originalName,contentType,sizeBytes||0]);return findById(id);}
async function findById(id){const {rows}=await db.query('SELECT * FROM appointment_attachments WHERE id=$1',[id]);return rows[0]||null;}
async function listByAppointment(appointmentId){const {rows}=await db.query('SELECT * FROM appointment_attachments WHERE appointment_id=$1 ORDER BY created_at',[appointmentId]);return rows;}
module.exports={create,findById,listByAppointment};
