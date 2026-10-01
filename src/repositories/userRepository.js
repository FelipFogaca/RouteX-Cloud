const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../database/db');

async function findByEmail(email) {
  if (!email) return null;
  const { rows } = await db.query('SELECT * FROM users WHERE lower(email)=lower($1) LIMIT 1', [String(email).trim().toLowerCase()]);
  return rows[0] || null;
}
async function findById(id) { const { rows } = await db.query('SELECT * FROM users WHERE id=$1 LIMIT 1', [String(id)]); return rows[0] || null; }
async function listAll() { const { rows } = await db.query('SELECT id,name,email,role,must_change_password,active,created_at,updated_at FROM users ORDER BY name, email'); return rows; }
async function create({ name, email, password, role = 'user' }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (await findByEmail(normalizedEmail)) throw new Error('E-mail já cadastrado.');
  const user = { id: randomUUID(), name: String(name || '').trim(), email: normalizedEmail, password_hash: await bcrypt.hash(password, 10), role: role === 'admin' ? 'admin' : 'user' };
  try {
    await db.query('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)', [user.id,user.name,user.email,user.password_hash,user.role]);
  } catch (error) {
    if (error?.code === '23505') throw new Error('E-mail já cadastrado.');
    throw error;
  }
  return findById(user.id);
}
async function validatePassword(plain, hash) { return bcrypt.compare(plain, hash); }
async function setPassword(id, password, { provisional = false } = {}) {
  const hash = await bcrypt.hash(password, 10);
  await db.query('UPDATE users SET password_hash=$1,must_change_password=$2,updated_at=NOW() WHERE id=$3', [hash, !!provisional, id]);
  return findById(id);
}
async function setRole(id, role) { await db.query('UPDATE users SET role=$1,updated_at=NOW() WHERE id=$2', [role === 'admin' ? 'admin' : 'user', id]); return findById(id); }
module.exports = { findByEmail, findById, listAll, create, validatePassword, setPassword, setRole };
