const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }); // 2 MB

router.use(auth);
router.use(requireAdmin);

router.get('/classes', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, name FROM classes ORDER BY name');
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

router.post('/classes', async (req, res) => {
  const { name } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Klassenavn kræves' });
  }
  try {
    const r = await pool.query(
      'INSERT INTO classes (name) VALUES ($1) RETURNING id, name',
      [String(name).trim()]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Klassen findes allerede' });
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

router.get('/users', async (req, res) => {
  const classId = req.query.classId;
  try {
    let r;
    if (classId) {
      r = await pool.query(
        `SELECT u.id, u.email, u.name, u.class_id, u.is_admin, c.name AS class_name
         FROM users u JOIN classes c ON c.id = u.class_id
         WHERE u.class_id = $1 ORDER BY u.name`,
        [classId]
      );
    } else {
      r = await pool.query(
        `SELECT u.id, u.email, u.name, u.class_id, u.is_admin, c.name AS class_name
         FROM users u JOIN classes c ON c.id = u.class_id
         ORDER BY c.name, u.name`
      );
    }
    res.json(r.rows.map(row => ({
      id: row.id,
      email: row.email,
      name: row.name,
      classId: row.class_id,
      className: row.class_name,
      isAdmin: !!row.is_admin,
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

router.post('/users', async (req, res) => {
  const { email, password, name, classId } = req.body;
  if (!email || !password || !name || !classId) {
    return res.status(400).json({ error: 'Email, adgangskode, navn og klasse kræves' });
  }
  const emailTrim = String(email).trim().toLowerCase();
  const nameTrim = String(name).trim();
  if (password.length < 4) {
    return res.status(400).json({ error: 'Adgangskode skal være mindst 4 tegn' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users (class_id, email, password_hash, name)
       VALUES ($1, $2, $3, $4) RETURNING id, email, name, class_id`,
      [classId, emailTrim, hash, nameTrim]
    );
    const row = r.rows[0];
    const classRes = await pool.query('SELECT name FROM classes WHERE id = $1', [row.class_id]);
    res.status(201).json({
      id: row.id,
      email: row.email,
      name: row.name,
      classId: row.class_id,
      className: classRes.rows[0]?.name || '',
    });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Email bruges allerede' });
    if (e.code === '23503') return res.status(400).json({ error: 'Ugyldig klasse' });
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

router.patch('/users/:id/password', async (req, res) => {
  const userId = req.params.id;
  const { password } = req.body;
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Adgangskode skal være mindst 4 tegn' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id',
      [hash, userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Bruger ikke fundet' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

// CSV-import: semicolon-separeret, header med Activity;Activity Short description;Username;...;Initial password;...;Email
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if ((c === ';' && !inQuotes) || c === '\r') {
      out.push(cur.trim());
      cur = '';
    } else if (c !== '\r') {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseCsv(buffer) {
  const text = (buffer.toString('utf8') || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map(h => h.replace(/^\uFEFF/, '')); // BOM
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, j) => { row[h] = values[j] ?? ''; });
    rows.push(row);
  }
  return { headers, rows };
}

router.post('/import-csv', upload.single('csv'), async (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: 'Vælg en CSV-fil' });
  }
  const { headers, rows } = parseCsv(req.file.buffer);
  const get = (row, ...keys) => {
    for (const k of keys) {
      const v = row[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return '';
  };
  const created = [];
  const updated = [];
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const className = get(row, 'Activity Short description', 'Activity');
    const emailRaw = get(row, 'Email');
    const username = get(row, 'Username');
    const email = emailRaw ? emailRaw.toLowerCase() : (username ? `${username}@mercantec.dk` : '');
    const password = get(row, 'Initial password');
    const name = get(row, 'Fullname') || [get(row, 'Given name'), get(row, 'Surname')].filter(Boolean).join(' ');

    if (!email) {
      errors.push({ row: i + 2, message: 'Manglende Email og Username' });
      continue;
    }
    if (!password) {
      errors.push({ row: i + 2, email, message: 'Manglende Initial password' });
      continue;
    }
    if (!name) {
      errors.push({ row: i + 2, email, message: 'Manglende Fullname/Given name/Surname' });
      continue;
    }
    if (!className) {
      errors.push({ row: i + 2, email, message: 'Manglende Activity Short description/Activity' });
      continue;
    }

    try {
      await pool.query('INSERT INTO classes (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [className]);
      const classRes = await pool.query('SELECT id FROM classes WHERE name = $1', [className]);
      const classId = classRes.rows[0].id;
      const existed = (await pool.query('SELECT 1 FROM users WHERE email = $1', [email])).rows.length > 0;
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        `INSERT INTO users (class_id, email, password_hash, name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET class_id = EXCLUDED.class_id, password_hash = EXCLUDED.password_hash, name = EXCLUDED.name`,
        [classId, email, hash, name]
      );
      if (existed) updated.push({ email, name, className });
      else created.push({ email, name, className });
    } catch (e) {
      if (e.code === '23505') errors.push({ row: i + 2, email, message: 'Email bruges allerede af anden række' });
      else errors.push({ row: i + 2, email, message: e.message || 'Fejl' });
    }
  }
  res.json({ created: created.length, updated: updated.length, errors, createdList: created, updatedList: updated });
});

module.exports = router;
