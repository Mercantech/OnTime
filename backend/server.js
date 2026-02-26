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
const spotifyRoutes = require('./routes/spotify');
const jokesRoutes = require('./routes/jokes');
const config = require('./config');
const { run: runMigrations } = require('./migrate');
const { run: ensureAdmin } = require('./ensureAdmin');
const { getVersion } = require('./version');
const { isCasinoClosed } = require('./casinoHours');

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
app.use('/api/casino', (req, res, next) => {
  if (isCasinoClosed()) {
    return res.status(404).json({ error: 'Casinoet har lukket, da manager er i skole!' });
  }
  next();
}, casinoRoutes);
app.use('/api/poker', pokerRoutes);
app.use('/api/song-requests', songRequestsRoutes);
app.use('/api/spotify', spotifyRoutes);
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
const CASINO_CLOSED_HTML = `<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Casino lukket – OnTime</title>
  <link rel="stylesheet" href="/css/style.css">
  <style>
    .casino-closed { max-width: 28rem; margin: 4rem auto; padding: 2rem; text-align: center; }
    .casino-closed h1 { font-size: 1.5rem; margin-bottom: 1rem; }
    .casino-closed p { color: var(--text-muted, #666); margin-bottom: 1.5rem; }
  </style>
</head>
<body>
  <main class="casino-closed">
    <h1>🎰 Casino lukket</h1>
    <p>Casinoet har lukket, da manager er i skole!</p>
    <p><a href="/app">← Tilbage til app</a></p>
  </main>
</body>
</html>`;

app.get('/casino', (req, res) => {
  noCacheHeaders(res);
  if (isCasinoClosed()) {
    return res.status(404).send(CASINO_CLOSED_HTML);
  }
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
require('./pirat/socketHandler').registerPirat(io);

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
