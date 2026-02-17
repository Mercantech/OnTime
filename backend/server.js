process.env.TZ = process.env.TZ || 'Europe/Copenhagen';
const path = require('path');
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const checkinRoutes = require('./routes/checkin');
const leaderboardRoutes = require('./routes/leaderboard');
const configRoutes = require('./routes/config');
const adminRoutes = require('./routes/admin');
const classDashboardRoutes = require('./routes/classDashboard');
const badgesRoutes = require('./routes/badges');
const config = require('./config');
const { run: runMigrations } = require('./migrate');
const { run: ensureAdmin } = require('./ensureAdmin');

const app = express();
app.set('trust proxy', 1); // Så klient-IP bruges ved WiFi-tjek bag proxy
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/checkin', checkinRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/config', configRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/public/class', classDashboardRoutes);
app.use('/api/badges', badgesRoutes);

const frontendDir = path.join(__dirname, process.env.NODE_ENV === 'production' ? 'frontend' : path.join('..', 'frontend'));
app.use(express.static(frontendDir, {
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  },
}));

function noCacheHeaders(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

app.get('/', (req, res) => {
  noCacheHeaders(res);
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.get('/app', (req, res) => {
  noCacheHeaders(res);
  res.sendFile(path.join(frontendDir, 'app.html'));
});

app.get('/admin', (req, res) => {
  noCacheHeaders(res);
  res.sendFile(path.join(frontendDir, 'admin.html'));
});

app.get('/klasse/:name', (req, res) => {
  noCacheHeaders(res);
  res.sendFile(path.join(frontendDir, 'class-dashboard.html'));
});

const PORT = config.port;
runMigrations()
  .then(() => ensureAdmin())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`OnTime server kører på http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error('Kunne ikke starte server:', e);
    process.exit(1);
  });
