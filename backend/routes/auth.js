const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const config = require('../config');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email og adgangskode kræves' });
  }
  try {
    const r = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.name, u.class_id, u.is_admin, c.name AS class_name
       FROM users u
       JOIN classes c ON c.id = u.class_id
       WHERE u.email = $1`,
      [email.trim().toLowerCase()]
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
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      classId: user.class_id,
      className: user.class_name,
      isAdmin: !!user.is_admin,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

module.exports = router;
