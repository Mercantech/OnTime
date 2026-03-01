const path = require('path');
// Indlæs .env fra backend-mappen eller repo-rod (så det virker uanset cwd)
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// H. C. Andersens Vej 9, 8800 Viborg (ca. koordinater)
const SCHOOL_LAT = 56.4517;
const SCHOOL_LNG = 9.3983;
// Øg radius hvis skolens netværk giver forkert GPS (fx 2000 for WiFi-baseret lokation)
const ALLOWED_RADIUS_METERS = Number(process.env.ALLOWED_RADIUS_METERS) || 2000;

// WiFi/netværk-tjek: sæt ALLOWED_IP_RANGES for at kræve skolens net i stedet for GPS
// Eksempel: "10.0.0.0/8,192.168.0.0/16" (kommasepareret CIDR)
const ALLOWED_IP_RANGES = process.env.ALLOWED_IP_RANGES
  ? process.env.ALLOWED_IP_RANGES.split(',').map(s => s.trim()).filter(Boolean)
  : [];
const WIFI_NAME = process.env.WIFI_NAME || 'MAGS-OLC';

function ipV4ToNum(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const n = parts.map(p => parseInt(p, 10));
  if (n.some(x => isNaN(x) || x < 0 || x > 255)) return null;
  return (n[0] << 24) | (n[1] << 16) | (n[2] << 8) | n[3];
}

function isIpInCidr(ip, cidr) {
  const idx = cidr.indexOf('/');
  if (idx === -1) return false;
  const network = cidr.slice(0, idx).trim();
  const prefix = parseInt(cidr.slice(idx + 1), 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;
  const ipNum = ipV4ToNum(ip);
  const netNum = ipV4ToNum(network);
  if (ipNum == null || netNum == null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (netNum & mask);
}

function isIpInAllowedRanges(ip) {
  return isIpInRanges(ip, ALLOWED_IP_RANGES);
}

/** Tjek om en IP matcher en af CIDR-ranges (fx "192.168.1.0/24"). */
function isIpInRanges(ip, ranges) {
  if (!ranges || !ranges.length) return false;
  const cleanIp = extractIpV4(ip);
  if (!cleanIp) return false;
  return ranges.some(cidr => isIpInCidr(cleanIp, cidr));
}

function extractIpV4(ip) {
  const raw = String(ip).split('%')[0];
  const m = raw.match(/(\d+\.\d+\.\d+\.\d+)/);
  const clean = m ? m[1] : raw;
  return clean && /^\d+\.\d+\.\d+\.\d+$/.test(clean) ? clean : null;
}

function getEnvIpRanges() {
  return [...ALLOWED_IP_RANGES];
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Jordens radius i meter
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function isWithinSchoolArea(lat, lng) {
  return haversineDistance(SCHOOL_LAT, SCHOOL_LNG, lat, lng) <= ALLOWED_RADIUS_METERS;
}

function calculatePoints(checkedAt) {
  const d = new Date(checkedAt);
  const day = d.getDay();
  if (day === 0 || day === 6) return 0; // weekend
  const target = new Date(d);
  target.setHours(8, 0, 0, 0);
  if (d <= target) return 45;
  const minutesLate = Math.floor((d - target) / 60000);
  return Math.max(0, 45 - minutesLate);
}

function getWeekdaysInMonth(year, month) {
  let count = 0;
  const d = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  while (d <= last) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function getWeekdaysUpToToday(year, month) {
  let count = 0;
  const today = new Date();
  const d = new Date(year, month, 1);
  while (d <= today && d.getMonth() === month) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/** Hemmelig kode for /admin/secret (sessioner). Kun nødvendig hvis sat. */
const ADMIN_SECRET_CODE = process.env.ADMIN_SECRET_CODE ? String(process.env.ADMIN_SECRET_CODE).trim() : '';

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'ontime-dev-secret-skift-i-produktion',
  adminSecretCode: ADMIN_SECRET_CODE,
  isWithinSchoolArea,
  calculatePoints,
  getWeekdaysInMonth,
  getWeekdaysUpToToday,
  isIpInAllowedRanges,
  isIpInRanges,
  getEnvIpRanges,
  useWiFiCheck: ALLOWED_IP_RANGES.length > 0,
  WIFI_NAME,
  SCHOOL_LAT,
  SCHOOL_LNG,
  ALLOWED_RADIUS_METERS,
};
