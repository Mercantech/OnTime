const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const { pool } = require('../db');
const config = require('../config');
const { auth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }); // 2 MB

router.use(auth);
router.use(requireAdmin);

/** Valider CIDR (fx 192.168.1.0/24 eller 185.22.75.2/32) */
function isValidCidr(s) {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(String(s).trim()) &&
    parseInt(String(s).split('/')[1], 10) >= 0 && parseInt(String(s).split('/')[1], 10) <= 32;
}

router.get('/ip-ranges', async (req, res) => {
  try {
    const envRanges = config.getEnvIpRanges();
    const fromEnv = envRanges.map(range => ({ range, fromEnv: true }));
    const r = await pool.query('SELECT id, range FROM allowed_ip_ranges ORDER BY id');
    const fromDb = (r.rows || []).map(row => ({ id: row.id, range: row.range, fromEnv: false }));
    res.json({ ranges: [...fromEnv.map(r => ({ ...r, id: null })), ...fromDb] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

router.post('/ip-ranges', async (req, res) => {
  const range = req.body && req.body.range ? String(req.body.range).trim() : '';
  if (!range) return res.status(400).json({ error: 'Angiv en adresse (fx 192.168.1.0/24)' });
  if (!isValidCidr(range)) return res.status(400).json({ error: 'Ugyldigt format. Brug CIDR, fx 192.168.1.0/24 eller 185.22.75.2/32' });
  try {
    const r = await pool.query('INSERT INTO allowed_ip_ranges (range) VALUES ($1) RETURNING id, range', [range]);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Den adresse findes allerede' });
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

router.delete('/ip-ranges/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Ugyldigt id' });
  try {
    const r = await pool.query('DELETE FROM allowed_ip_ranges WHERE id = $1 RETURNING id', [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Ikke fundet' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

router.get('/classes', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, name FROM classes ORDER BY name');
    const list = Array.isArray(r.rows) ? r.rows : [];
    res.set('Content-Type', 'application/json').json(list);
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
  const { email, password, name, classId, isAdmin } = req.body;
  if (!email || !password || !name || !classId) {
    return res.status(400).json({ error: 'Email, adgangskode, navn og klasse kræves' });
  }
  const emailTrim = String(email).trim().toLowerCase();
  const nameTrim = String(name).trim();
  const admin = !!isAdmin;
  if (password.length < 4) {
    return res.status(400).json({ error: 'Adgangskode skal være mindst 4 tegn' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users (class_id, email, password_hash, name, is_admin)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email, name, class_id, is_admin`,
      [classId, emailTrim, hash, nameTrim, admin]
    );
    const row = r.rows[0];
    const classRes = await pool.query('SELECT name FROM classes WHERE id = $1', [row.class_id]);
    res.status(201).json({
      id: row.id,
      email: row.email,
      name: row.name,
      classId: row.class_id,
      className: classRes.rows[0]?.name || '',
      isAdmin: !!row.is_admin,
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

router.patch('/users/:id/admin', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const isAdmin = req.body.isAdmin === true || req.body.isAdmin === 'true';
  if (Number.isNaN(userId)) return res.status(400).json({ error: 'Ugyldigt bruger-id' });
  if (userId === req.userId && !isAdmin) {
    return res.status(400).json({ error: 'Du kan ikke fjerne din egen admin-rettighed' });
  }
  try {
    const r = await pool.query(
      'UPDATE users SET is_admin = $1 WHERE id = $2 RETURNING id, is_admin',
      [isAdmin, userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Bruger ikke fundet' });
    res.json({ ok: true, isAdmin: !!r.rows[0].is_admin });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

router.delete('/users/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (Number.isNaN(userId)) return res.status(400).json({ error: 'Ugyldigt bruger-id' });
  if (userId === req.userId) {
    return res.status(400).json({ error: 'Du kan ikke slette din egen bruger' });
  }
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM check_ins WHERE user_id = $1', [userId]);
      const r = await client.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
      await client.query('COMMIT');
      if (r.rows.length === 0) return res.status(404).json({ error: 'Bruger ikke fundet' });
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Giv eller træk point fra en elev. Negativt tal = træk fra nuværende (min 0). */
router.post('/give-points', async (req, res) => {
  const { userId, date, points } = req.body || {};
  const uid = parseInt(userId, 10);
  if (Number.isNaN(uid)) return res.status(400).json({ error: 'Vælg en elev' });
  const pts = parseInt(points, 10);
  if (Number.isNaN(pts) || pts < -45 || pts > 45) {
    return res.status(400).json({ error: 'Point skal være mellem -45 og 45 (negativ trækker fra)' });
  }
  let checkDate;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date).trim())) {
    checkDate = String(date).trim();
  } else {
    const now = new Date();
    checkDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }
  try {
    const userRow = await pool.query('SELECT id, class_id FROM users WHERE id = $1', [uid]);
    if (!userRow.rows.length) return res.status(404).json({ error: 'Bruger ikke fundet' });
    let pointsToSet = pts;
    if (pts < 0) {
      const cur = await pool.query(
        'SELECT points FROM check_ins WHERE user_id = $1 AND check_date = $2',
        [uid, checkDate]
      );
      const current = cur.rows[0] ? cur.rows[0].points : 0;
      pointsToSet = Math.max(0, current + pts);
    }
    const checkedAt = new Date(checkDate + 'T08:00:00');
    await pool.query(
      `INSERT INTO check_ins (user_id, check_date, checked_at, points)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, check_date) DO UPDATE SET points = EXCLUDED.points, checked_at = EXCLUDED.checked_at`,
      [uid, checkDate, checkedAt, pointsToSet]
    );
    res.json({ ok: true, date: checkDate, points: pointsToSet, delta: pts });
  } catch (e) {
    if (e.constraint === 'check_ins_points_check') {
      return res.status(400).json({ error: 'Point skal være mellem 0 og 45 (resultatet efter træk)' });
    }
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

// GDPR: kort navn ved import – fornavn + forbogstav (ved duplikater flere bogstaver)
function toUniqueShortName(fullName, usedSet) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1] || '';
  let d = parts.length <= 1 ? (parts[0] || '') : parts[0] + ' ' + (last[0] || '').toUpperCase();
  let n = 1;
  while (usedSet.has(d) && n <= last.length) {
    d = parts[0] + ' ' + last.slice(0, n).toUpperCase();
    n++;
  }
  usedSet.add(d);
  return d;
}

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
  const forceClassId = req.body && req.body.classId ? parseInt(String(req.body.classId), 10) : null;
  if (!forceClassId) {
    return res.status(400).json({ error: 'Vælg en klasse til import' });
  }
  const c = await pool.query('SELECT id, name FROM classes WHERE id = $1', [forceClassId]);
  if (c.rows.length === 0) return res.status(400).json({ error: 'Ugyldig klasse' });
  const forceClassName = c.rows[0].name;
  const { headers, rows } = parseCsv(req.file.buffer);
  const get = (row, ...keys) => {
    for (const k of keys) {
      const v = row[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return '';
  };

  // Saml gyldige rækker (fulde navne bruges kun til at udlede kort navn – gemmes ikke)
  const validRows = [];
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const emailRaw = get(row, 'Email');
    const username = get(row, 'Username');
    const email = emailRaw ? emailRaw.toLowerCase() : (username ? `${username}@mercantec.dk` : '');
    const password = get(row, 'Initial password');
    const fullName = get(row, 'Fullname') || [get(row, 'Given name'), get(row, 'Surname')].filter(Boolean).join(' ');
    if (!email) {
      errors.push({ row: i + 2, message: 'Manglende Email og Username' });
      continue;
    }
    if (!password) {
      errors.push({ row: i + 2, email, message: 'Manglende Initial password' });
      continue;
    }
    if (!fullName) {
      errors.push({ row: i + 2, email, message: 'Manglende Fullname/Given name/Surname' });
      continue;
    }
    validRows.push({ rowIndex: i + 2, email, password, fullName });
  }

  // Navne der allerede findes i klassen (brugere vi ikke opdaterer i denne import)
  const existingInClass = await pool.query(
    'SELECT email, name FROM users WHERE class_id = $1',
    [forceClassId]
  );
  const csvEmails = new Set(validRows.map(r => r.email));
  const usedNames = new Set();
  for (const u of existingInClass.rows) {
    if (!csvEmails.has(u.email)) usedNames.add(u.name);
  }

  const created = [];
  const updated = [];
  for (const r of validRows) {
    const displayName = toUniqueShortName(r.fullName, usedNames);
    try {
      const hash = await bcrypt.hash(r.password, 10);
      const existed = (await pool.query('SELECT 1 FROM users WHERE email = $1', [r.email])).rows.length > 0;
      await pool.query(
        `INSERT INTO users (class_id, email, password_hash, name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET class_id = EXCLUDED.class_id, password_hash = EXCLUDED.password_hash, name = EXCLUDED.name`,
        [forceClassId, r.email, hash, displayName]
      );
      if (existed) updated.push({ email: r.email, name: displayName, className: forceClassName });
      else created.push({ email: r.email, name: displayName, className: forceClassName });
    } catch (e) {
      if (e.code === '23505') errors.push({ row: r.rowIndex, email: r.email, message: 'Email bruges allerede af anden række' });
      else errors.push({ row: r.rowIndex, email: r.email, message: e.message || 'Fejl' });
    }
  }
  res.json({ created: created.length, updated: updated.length, errors, createdList: created, updatedList: updated });
});

/** Nulstil alle point for en klasse (nuværende måned) – alle i klassen får vist 0 point. */
function monthWindowSql(field) {
  return `${field} >= date_trunc('month', CURRENT_DATE) AND ${field} < date_trunc('month', CURRENT_DATE) + interval '1 month'`;
}

router.post('/classes/:classId/reset-points', async (req, res) => {
  const classId = parseInt(req.params.classId, 10);
  if (Number.isNaN(classId)) return res.status(400).json({ error: 'Ugyldigt klasse-id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const users = await client.query(
      'SELECT id FROM users WHERE class_id = $1',
      [classId]
    );
    if (!users.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ingen brugere i denne klasse' });
    }
    let resetCount = 0;
    for (const row of users.rows) {
      const userId = row.id;
      const r = await client.query(
        `SELECT (
          COALESCE((SELECT SUM(points)::int FROM check_ins WHERE user_id = $1 AND ${monthWindowSql('checked_at')}), 0)
          + COALESCE((SELECT SUM(points)::int FROM game_completions WHERE user_id = $1
              AND play_date >= date_trunc('month', CURRENT_DATE)::date
              AND play_date < (date_trunc('month', CURRENT_DATE)::date + interval '1 month')::date), 0)
          + COALESCE((SELECT SUM(delta)::int FROM point_transactions WHERE user_id = $1 AND ${monthWindowSql('created_at')}), 0)
        )::int AS total`,
        [userId]
      );
      const total = r.rows[0]?.total ?? 0;
      if (total !== 0) {
        await client.query(
          `INSERT INTO point_transactions (user_id, delta, reason) VALUES ($1, $2, $3)`,
          [userId, -total, 'Admin nulstilling (klasse)']
        );
        resetCount++;
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true, usersAffected: users.rows.length, resetCount });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  } finally {
    client.release();
  }
});

module.exports = router;
