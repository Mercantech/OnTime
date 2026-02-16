const express = require('express');
const config = require('../config');

const router = express.Router();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) return first;
  }
  return req.ip || req.socket?.remoteAddress || '';
}

router.get('/', (req, res) => {
  res.json({
    schoolLat: config.SCHOOL_LAT,
    schoolLng: config.SCHOOL_LNG,
    radiusMeters: config.ALLOWED_RADIUS_METERS,
    schoolAddress: 'H. C. Andersens Vej 9, 8800 Viborg',
    useWiFiCheck: config.useWiFiCheck,
    wifiName: config.WIFI_NAME,
  });
});

// Hjælper til at finde den IP serveren ser – tilføj den til ALLOWED_IP_RANGES hvis du er på skolen
router.get('/client-ip', (req, res) => {
  res.json({ clientIp: getClientIp(req) });
});

module.exports = router;
