const express = require('express');
const { pool } = require('../db');
const config = require('../config');
const { auth } = require('../middleware/auth');

const router = express.Router();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) return first;
  }
  return req.ip || req.socket?.remoteAddress || '';
}

router.post('/', auth, async (req, res) => {
  let lat, lng;

  if (config.useWiFiCheck) {
    const clientIp = getClientIp(req);
    if (!config.isIpInAllowedRanges(clientIp)) {
      return res.status(403).json({
        error: `Du skal være forbundet til skolens WiFi (${config.WIFI_NAME}) for at stemple ind.`,
        clientIp: clientIp || undefined,
      });
    }
    lat = config.SCHOOL_LAT;
    lng = config.SCHOOL_LNG;
  } else {
    const body = req.body || {};
    lat = body.lat;
    lng = body.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'Geolokation (lat, lng) kræves' });
    }
    if (!config.isWithinSchoolArea(lat, lng)) {
      return res.status(403).json({
        error: 'Du skal være på skolen (H. C. Andersens Vej 9, Viborg) for at stemple ind.',
      });
    }
  }

  const now = new Date();
  const points = config.calculatePoints(now);
  const day = now.getDay();
  if (day === 0 || day === 6) {
    return res.status(400).json({ error: 'Indstempling er kun mulig på hverdage.' });
  }
  const today = now.toISOString().slice(0, 10);
  try {
    await pool.query(
      `INSERT INTO check_ins (user_id, check_date, checked_at, points, lat, lng)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, check_date) DO UPDATE SET
         checked_at = EXCLUDED.checked_at,
         points = EXCLUDED.points,
         lat = EXCLUDED.lat,
         lng = EXCLUDED.lng`,
      [req.userId, today, now, points, lat, lng]
    );
  } catch (e) {
    if (e.code === '42701') {
      return res.status(500).json({ error: 'Database: unik indeks mangler. Kør init.sql.' });
    }
    if (e.constraint === 'check_ins_points_check') {
      return res.status(400).json({ error: 'Ugyldig pointberegning' });
    }
    console.error(e);
    return res.status(500).json({ error: 'Kunne ikke gemme indstempling' });
  }
  res.json({
    success: true,
    checkedAt: now.toISOString(),
    points,
    message: points === 45 ? 'Perfekt! 45 point.' : `Stemplet ind. ${points} point (forsinket).`,
  });
});

router.get('/today', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT checked_at, points FROM check_ins
       WHERE user_id = $1 AND checked_at::date = CURRENT_DATE`,
      [req.userId]
    );
    if (r.rows.length === 0) {
      return res.json({ checkedIn: false });
    }
    res.json({
      checkedIn: true,
      checkedAt: r.rows[0].checked_at,
      points: r.rows[0].points,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

module.exports = router;
