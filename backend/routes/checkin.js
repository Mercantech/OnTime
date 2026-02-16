const express = require('express');
const { pool } = require('../db');
const config = require('../config');
const { auth } = require('../middleware/auth');
const { getDbIpRanges } = require('../ipRanges');

const router = express.Router();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) return first;
  }
  return req.ip || req.socket?.remoteAddress || '';
}

/** Besked til eleven efter indstempling. Forventet: inden kl. 8. Efter 8 er for sent – list/sarkasme pr. kvarter. */
function getCheckinMessage(now, points) {
  const h = now.getHours();
  const m = now.getMinutes();
  const mins = h * 60 + m;
  const t = (hh, mm) => (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  if (mins < 360) {
    return pick([
      'Kl. ' + t(h, m) + ' – du er en ægte early bird! 🌅 ' + points + ' point.',
      'Så tidligt? Vi er imponeret. ' + points + ' point.',
      'Wow, du er vågen før de fleste. God start! ' + points + ' point.',
    ]);
  }
  if (mins < 480) {
    return pick([
      'Perfekt tid! Du kom inden kl. 8. ' + points + ' point.',
      'Inden klokken 8 – lige som vi elsker det. ' + points + ' point.',
      'Sådan! Tidlig fugl fanger point. ' + points + ' point.',
      'Fantastisk – du er der inden 8. ' + points + ' point.',
      'Godt klaret! Lige i skabet. ' + points + ' point.',
      'Flot. Velkommen til tiden. ' + points + ' point.',
    ]);
  }

  /* 08:00–08:15 – første kvarter for sent */
  if (mins < 495) {
    return pick([
      'Kl. 8. Du nåede lige... at overskride tiden ' + points + ' point.',
      'Så. Klokken er 8. Vi forventer inden 8. Du kan selv regne resten. ' + points + ' point.',
      '08:00. Grænsen. Du er på den forkerte side. Men point får du. ' + points + ' point.',
      'Lige for sent. Vi forventer inden kl. 8. Ikke 8:01. ' + points + ' point.',
      'Tak for at du lige viste, at uret findes. Det er 8. ' + points + ' point.',
      'Før 8 = godt. Efter 8 = det her. ' + points + ' point.',
      'Du kom. Bare … efter tiden. Noteret. ' + points + ' point.',
      'Point uddelt. Du skulle have været her inden 8. ' + points + ' point.',
    ]);
  }
  /* 08:15–08:30 – andet kvarter */
  if (mins < 510) {
    return pick([
      'Kl. 8:15. Morgensove eller bare ligeglad? ' + points + ' point.',
      'Vi forventer inden kl. 8. Du valgte 8:15. Ok. ' + points + ' point.',
      'Et kvarter over. Det bliver ikke bedre af at vi skriver det. ' + points + ' point.',
      'Sååå … alarmen virkede ikke, eller hvad? ' + points + ' point.',
      '15 minutter for sent. Vi tæller. Du får point. Bare så du ved det. ' + points + ' point.',
      '8:15. Du er her. Vi er ikke forbavset, men vi er heller ikke imponeret. ' + points + ' point.',
      'Point for at du dukkede op. Minus for timing. ' + points + ' point.',
      'Godt du kom. Næste gang: inden kl. 8. Tak. ' + points + ' point.',
      'Vi har set uret. Du har set det også. I hvert fald nu. ' + points + ' point.',
      'List og sarkasme: Du er for sent. Her er dine point alligevel. ' + points + ' point.',
    ]);
  }
  /* 08:30–08:45 – tredje kvarter */
  if (mins < 525) {
    return pick([
      'Kl. 8:30. Halvanden time for sent. Flot. ' + points + ' point.',
      'Vi forventer inden kl. 8. Du gav os 8:30. Tak for indsatsen. ' + points + ' point.',
      '30 minutter over. Ja, vi kan tælle. ' + points + ' point.',
      'Morgensove? Trafik? Uanset: du er for sent. ' + points + ' point.',
      'Du stemplede ind. Vi noterer hvornår. Det er ikke inden 8. ' + points + ' point.',
      '8:30. Vi elsker at du kom. Vi forventer bare inden 8. ' + points + ' point.',
      'Point uddelt. En lille skælden ud: inden kl. 8. Ikke 8:30. ' + points + ' point.',
      'Godt med dig – bare for sent til at få applaus. ' + points + ' point.',
      'Sååå … 8 var for tidligt, 8:15 for tidligt, 8:30 lige pas? ' + points + ' point.',
      'Du er her. Sent. Men her. ' + points + ' point.',
      'Vi forventer dig inden kl. 8. Det her er ikke det. ' + points + ' point.',
      'Tak. Næste gang må det gerne være inden kl. 8. ' + points + ' point.',
    ]);
  }

  /* Efter 08:45 – rigtig for sent */
  return pick([
    'Kl. ' + t(h, m) + '. Ja, vi kan også se uret. ' + points + ' point.',
    'Forsinket. Hvad skal vi sige … inden kl. 8 næste gang. ' + points + ' point.',
    'Wow, du kom. Bare meget sent. ' + points + ' point.',
    'Vi forventer inden kl. 8. Det her er ikke inden 8. ' + points + ' point.',
    'Point for at du kom. Minus for timing. ' + points + ' point.',
    'Sååå … kl. 8 var for tidligt? Noteret. ' + points + ' point.',
    'Du stemplede ind. Vi noterer også hvornår. ' + points + ' point.',
    'Senere end forventet. Meget senere. ' + points + ' point.',
    'Morgensove eller trafik? Uanset: inden kl. 8 næste gang, tak. ' + points + ' point.',
    'Vi elsker at du kom. Vi forventer bare inden kl. 8. ' + points + ' point.',
    'Point uddelt. Du skulle have været her inden 8. ' + points + ' point.',
    'Godt med dig – for sent til applaus. ' + points + ' point.',
    'Du er her. Sent. Men du får point. Bare så du ved det. ' + points + ' point.',
    'Tak for at vise, at du kan. Næste gang inden kl. 8. ' + points + ' point.',
    'Klokken ringer ikke for sent hos dig, eller hvad? ' + points + ' point.',
    'Inden kl. 8. Det er ikke et forslag. ' + points + ' point.',
  ]);
}

router.post('/', auth, async (req, res) => {
  let lat, lng;
  const envRanges = config.getEnvIpRanges();
  const dbRanges = await getDbIpRanges();
  const allRanges = [...envRanges, ...dbRanges];
  const useWiFiCheck = allRanges.length > 0;

  if (useWiFiCheck) {
    const clientIp = getClientIp(req);
    if (!config.isIpInRanges(clientIp, allRanges)) {
      return res.status(403).json({
        error: `Du skal være forbundet til WiFi-netværket ${config.WIFI_NAME} (MAGS-OLC) for at stemple ind.`,
      });
    }
    lat = null;
    lng = null;
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
  const latVal = lat == null ? null : Math.round(lat * 100) / 100;
  const lngVal = lng == null ? null : Math.round(lng * 100) / 100;
  try {
    await pool.query(
      `INSERT INTO check_ins (user_id, check_date, checked_at, points, lat, lng)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, check_date) DO UPDATE SET
         checked_at = EXCLUDED.checked_at,
         points = EXCLUDED.points,
         lat = EXCLUDED.lat,
         lng = EXCLUDED.lng`,
      [req.userId, today, now, points, latVal, lngVal]
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
    message: getCheckinMessage(now, points),
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
