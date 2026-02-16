const express = require('express');
const config = require('../config');
const { getDbIpRanges } = require('../ipRanges');

const router = express.Router();

router.get('/', async (req, res) => {
  const envRanges = config.getEnvIpRanges();
  const dbRanges = await getDbIpRanges();
  const useWiFiCheck = envRanges.length > 0 || dbRanges.length > 0;
  res.json({
    schoolLat: config.SCHOOL_LAT,
    schoolLng: config.SCHOOL_LNG,
    radiusMeters: config.ALLOWED_RADIUS_METERS,
    schoolAddress: 'H. C. Andersens Vej 9, 8800 Viborg',
    useWiFiCheck,
    wifiName: config.WIFI_NAME,
  });
});

module.exports = router;
