const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');

const router = express.Router();

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

module.exports = router;
