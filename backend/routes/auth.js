const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const config = require('../config');
const { auth } = require('../middleware/auth');

const router = express.Router();

/** Brugernavn eller email: "jensen", "jensen@mercantec.dk", "jensen@edu.mercantec.dk" → liste af emails at prøve */
function loginEmailCandidates(input) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return [];
  if (s.includes('@')) return [s];
  return [s + '@mercantec.dk', s + '@edu.mercantec.dk'];
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email og adgangskode kræves' });
  }
  const candidates = loginEmailCandidates(email);
  if (candidates.length === 0) {
    return res.status(400).json({ error: 'Email og adgangskode kræves' });
  }
  try {
    const r = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.name, u.class_id, u.is_admin, c.name AS class_name
       FROM users u
       JOIN classes c ON c.id = u.class_id
       WHERE u.email = ANY($1::text[])`,
      [candidates]
    );
    if (r.rows.length === 0) {
      return res.status(401).json({ error: 'Forkert email eller adgangskode' });
    }
    const user = r.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Forkert email eller adgangskode' });
    }
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.jwtSecret,
      { expiresIn: '7d' }
    );
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        classId: user.class_id,
        className: user.class_name,
        isAdmin: !!user.is_admin,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Skift egen adgangskode – kræver nuværende adgangskode. */
router.put('/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Nuværende og ny adgangskode kræves' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'Ny adgangskode skal være mindst 4 tegn' });
  }
  try {
    const r = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Bruger ikke fundet' });
    const ok = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Forkert nuværende adgangskode' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.userId]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.email, u.name, u.class_id, u.is_admin, c.name AS class_name
       FROM users u
       JOIN classes c ON c.id = u.class_id
       WHERE u.id = $1`,
      [req.userId]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Bruger ikke fundet' });
    }
    const user = r.rows[0];
    const payload = {
      id: user.id,
      email: user.email,
      name: user.name,
      classId: user.class_id,
      className: user.class_name,
      isAdmin: !!user.is_admin,
    };
    if (user.is_admin) {
      const classesRes = await pool.query('SELECT id, name FROM classes ORDER BY name');
      payload.classes = classesRes.rows || [];
    }
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

module.exports = router;
