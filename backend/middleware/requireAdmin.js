const { pool } = require('../db');

async function requireAdmin(req, res, next) {
  try {
    const r = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
    if (r.rows.length === 0 || !r.rows[0].is_admin) {
      return res.status(403).json({ error: 'Kun administratorer har adgang' });
    }
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
}

module.exports = { requireAdmin };
