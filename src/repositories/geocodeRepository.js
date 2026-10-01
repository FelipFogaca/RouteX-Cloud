const db = require('../database/db');
async function find(addressKey){ const {rows}=await db.query('SELECT address_key,latitude,longitude,provider,quality,updated_at FROM geocode_cache WHERE address_key=$1',[addressKey]); return rows[0]||null; }
async function upsert({addressKey,latitude,longitude,provider,quality='validated'}){ await db.query(`INSERT INTO geocode_cache(address_key,latitude,longitude,provider,quality) VALUES($1,$2,$3,$4,$5) ON CONFLICT(address_key) DO UPDATE SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,provider=EXCLUDED.provider,quality=EXCLUDED.quality,updated_at=NOW()`,[addressKey,Number(latitude),Number(longitude),String(provider||''),String(quality||'validated')]); }
async function remove(addressKey){ await db.query('DELETE FROM geocode_cache WHERE address_key=$1',[addressKey]); }
module.exports={find,upsert,remove};
