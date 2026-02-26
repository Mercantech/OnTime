const jwt = require('jsonwebtoken');
const config = require('../config');
const { pool } = require('../db');

async function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Manglende eller ugyldig token' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.userId = payload.userId;
    req.userEmail = payload.email;
    const banRow = await pool.query(
      'SELECT banned_until FROM user_bans WHERE user_id = $1 AND banned_until > NOW() LIMIT 1',
      [req.userId]
    );
    if (banRow.rows.length > 0) {
      const until = banRow.rows[0].banned_until;
      const untilStr = until instanceof Date ? until.toISOString() : String(until);
      return res.status(403).json({
        error: 'Din konto er midlertidigt spærret. Kontakt en administrator.',
        bannedUntil: untilStr,
      });
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Ugyldig eller udløbet token' });
  }
}

module.exports = { auth };
