const db = require('../database/db');
async function list() { const { rows } = await db.query("SELECT * FROM saved_locations ORDER BY CASE WHEN location_type='store' THEN 0 ELSE 1 END,name"); return rows; }
async function findById(id) { const { rows } = await db.query('SELECT * FROM saved_locations WHERE id=$1 LIMIT 1',[Number(id)]); return rows[0]||null; }
async function create(d) { const { rows } = await db.query(`INSERT INTO saved_locations(name,location_type,street,number,complement,neighborhood,city,state,zip_code,phone,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[d.name,d.location_type,d.street,d.number,d.complement,d.neighborhood,d.city,d.state,d.zip_code,d.phone,d.notes]); return rows[0]; }
async function update(id,d) { const { rows } = await db.query(`UPDATE saved_locations SET name=$1,location_type=$2,street=$3,number=$4,complement=$5,neighborhood=$6,city=$7,state=$8,zip_code=$9,phone=$10,notes=$11,updated_at=NOW() WHERE id=$12 RETURNING *`,[d.name,d.location_type,d.street,d.number,d.complement,d.neighborhood,d.city,d.state,d.zip_code,d.phone,d.notes,Number(id)]); return rows[0]||null; }
async function remove(id) { return db.query('DELETE FROM saved_locations WHERE id=$1',[Number(id)]); }
module.exports={list,findById,create,update,remove};
