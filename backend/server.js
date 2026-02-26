process.env.TZ = process.env.TZ || 'Europe/Copenhagen';
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { attachSocket } = require('./socket');
const authRoutes = require('./routes/auth');
const checkinRoutes = require('./routes/checkin');
const leaderboardRoutes = require('./routes/leaderboard');
const configRoutes = require('./routes/config');
const adminRoutes = require('./routes/admin');
const classDashboardRoutes = require('./routes/classDashboard');
const badgesRoutes = require('./routes/badges');
const gamesRoutes = require('./routes/games');
const betsRoutes = require('./routes/bets');
const casinoRoutes = require('./routes/casino');
const pokerRoutes = require('./routes/poker');
const songRequestsRoutes = require('./routes/songRequests');
const jokesRoutes = require('./routes/jokes');
const config = require('./config');
const { run: runMigrations } = require('./migrate');
const { run: ensureAdmin } = require('./ensureAdmin');
const { getVersion } = require('./version');

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
app.use('/api/games', gamesRoutes);
app.use('/api/bets', betsRoutes);
app.use('/api/casino', casinoRoutes);
app.use('/api/poker', pokerRoutes);
app.use('/api/song-requests', songRequestsRoutes);
app.use('/api/jokes', jokesRoutes);

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

app.get('/api/version', (req, res) => {
  res.json({ version: getVersion() });
});

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

app.get('/spil/wordle', (req, res) => {
  noCacheHeaders(res);
  res.sendFile(path.join(frontendDir, 'wordle.html'));
});
app.get('/spil/flag', (req, res) => {
  noCacheHeaders(res);
  res.sendFile(path.join(frontendDir, 'flag.html'));
});
app.get('/spil/sudoku', (req, res) => {
  noCacheHeaders(res);
  res.sendFile(path.join(frontendDir, 'sudoku.html'));
});
app.get('/spil/coinflip', (req, res) => {
  res.redirect(302, '/casino');
});
app.get('/spil', (req, res) => {
  noCacheHeaders(res);
  res.sendFile(path.join(frontendDir, 'games.html'));
});
app.get('/casino', (req, res) => {
  noCacheHeaders(res);
  res.sendFile(path.join(frontendDir, 'casino.html'));
});
app.get('/dart', (req, res) => {
  noCacheHeaders(res);
  res.sendFile(path.join(frontendDir, 'dart.html'));
});

app.get('/profil/:id', (req, res) => {
  noCacheHeaders(res);
  res.sendFile(path.join(frontendDir, 'profil.html'));
});

app.get('/spotify', (req, res) => {
  noCacheHeaders(res);
  res.sendFile(path.join(frontendDir, 'sangønsker.html'));
});

app.get('/jokes', (req, res) => {
  noCacheHeaders(res);
  res.sendFile(path.join(frontendDir, 'jokes.html'));
});

app.get('/pirat', (req, res) => {
  noCacheHeaders(res);
  res.sendFile(path.join(frontendDir, 'pirat', 'index.html'));
});

app.get('/pirat/', (req, res) => {
  noCacheHeaders(res);
  res.sendFile(path.join(frontendDir, 'pirat', 'index.html'));
});

const PORT = config.port;
const server = http.createServer(app);
const io = attachSocket(server);
app.set('io', io);
require('./poker/socketHandler').registerPoker(io);

runMigrations()
  .then(() => ensureAdmin())
  .then(() => {
    server.listen(PORT, () => {
      console.log(`OnTime server kører på http://localhost:${PORT} (${getVersion()})`);
      const envKeys = Object.keys(process.env).sort().filter((k) => !/^(PATH|PWD|HOME|NODE_|npm_)/i.test(k));
      console.log('Env-variabler (kun navne, ingen værdier):', envKeys.join(', ') || '(ingen)');
      const spotifyOk = !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
      console.log(spotifyOk ? 'Spotify: konfigureret (sangønsker-søgning aktiv)' : 'Spotify: ikke konfigureret – sæt SPOTIFY_CLIENT_ID og SPOTIFY_CLIENT_SECRET for sangønsker-søgning');
    });
  })
  .catch((e) => {
    console.error('Kunne ikke starte server:', e);
    process.exit(1);
  });
