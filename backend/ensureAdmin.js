const bcrypt = require('bcrypt');
const { pool } = require('./db');

const DEFAULT_ADMIN_EMAIL = 'mags@mercantec.dk';
const DEFAULT_ADMIN_PASSWORD = 'Cisco123!';

async function run() {
  const email = process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || 'MAGS Admin';

  const classRes = await pool.query("SELECT id FROM classes WHERE name = '1a' LIMIT 1");
  if (classRes.rows.length === 0) {
    await pool.query("INSERT INTO classes (name) VALUES ('1a') ON CONFLICT (name) DO NOTHING");
  }
  const classId = (await pool.query("SELECT id FROM classes WHERE name = '1a' LIMIT 1")).rows[0].id;

  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (class_id, email, password_hash, name, is_admin)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (email) DO UPDATE SET is_admin = true`,
    [classId, email.toLowerCase().trim(), hash, name]
  );
  console.log('Admin sikret:', email);
}

module.exports = { run };
