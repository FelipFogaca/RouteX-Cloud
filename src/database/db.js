const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL (ou POSTGRES_URL) não configurada. O RouteX Cloud exige PostgreSQL persistente.');
}

const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'false' || isLocal ? false : { rejectUnauthorized: false },
  max: Number(process.env.DB_POOL_MAX || 5),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

let readyPromise;
function initializeDatabase() {
  if (!readyPromise) readyPromise = (async () => {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.postgres.sql'), 'utf8');
    await pool.query(schema);
    await ensureBootstrapAdmin();
  })();
  return readyPromise;
}

async function ensureBootstrapAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_INITIAL_PASSWORD || '');
  const name = String(process.env.ADMIN_NAME || 'Administrador RouteX').trim();
  if (!email) return;
  const existing = await pool.query('SELECT id, role FROM users WHERE lower(email)=lower($1) LIMIT 1', [email]);
  if (existing.rows[0]) {
    if (existing.rows[0].role !== 'admin') await pool.query("UPDATE users SET role='admin', updated_at=NOW() WHERE id=$1", [existing.rows[0].id]);
    return;
  }
  if (password.length < 8) {
    console.warn('ADMIN_EMAIL definido, mas ADMIN_INITIAL_PASSWORD deve ter pelo menos 8 caracteres para criar o admin inicial.');
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  const inserted = await pool.query(`INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,'admin') ON CONFLICT DO NOTHING RETURNING id`, [randomUUID(), name, email, hash]);
  await pool.query("UPDATE users SET role='admin', updated_at=NOW() WHERE lower(email)=lower($1)", [email]);
  if (inserted.rows[0]) console.log(`Administrador inicial criado: ${email}. Remova ADMIN_INITIAL_PASSWORD da Vercel após o primeiro deploy.`);
}

async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, query: (...args) => pool.query(...args), withTransaction, initializeDatabase };
