const express = require('express');
const config = require('../config');

const router = express.Router();

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

module.exports = router;
