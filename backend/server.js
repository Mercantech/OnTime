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
const { isCasinoClosed, getNextOpenLabel } = require('./casinoHours');

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
function getCasinoClosedHtml(openLabel) {
  const openText = openLabel ? `Åbner igen ${openLabel}` : 'Vi åbner snart igen.';
  return `<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Casino lukket – OnTime</title>
  <link rel="stylesheet" href="/css/style.css">
  <style>
    .casino-closed-page { min-height: 100vh; background: linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%); color: #c9c9c9; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; box-sizing: border-box; }
    .casino-closed-page a { color: #7eb8da; }
    .casino-closed-page a:hover { text-decoration: underline; }
    .casino-closed-machine { font-size: 5rem; line-height: 1.2; margin-bottom: 0.5rem; filter: grayscale(0.6) brightness(0.5); opacity: 0.85; }
    .casino-closed-title { font-size: 1.75rem; font-weight: 700; margin: 0 0 0.75rem; color: #e0e0e0; text-shadow: 0 0 20px rgba(0,0,0,0.5); }
    .casino-closed-reason { font-size: 1.1rem; margin: 0 0 1.5rem; color: #999; max-width: 22rem; line-height: 1.5; }
    .casino-closed-open { font-size: 1rem; margin: 0 0 1.5rem; padding: 0.75rem 1.25rem; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; color: #b0b0b0; }
    .casino-closed-open strong { color: #8fbc8f; }
    .casino-closed-back { font-size: 0.95rem; }
    .casino-closed-flicker { animation: casino-dim 4s ease-in-out infinite; }
    @keyframes casino-dim { 0%, 100% { opacity: 0.85; } 50% { opacity: 0.55; } }
    .casino-closed-sign { font-size: 0.75rem; letter-spacing: 0.35em; color: #555; margin-bottom: 1.5rem; }
  </style>
</head>
<body>
  <main class="casino-closed-page">
    <div class="casino-closed-machine casino-closed-flicker" aria-hidden="true">🎰</div>
    <p class="casino-closed-sign">LUKKET</p>
    <h1 class="casino-closed-title">Casino lukket</h1>
    <p class="casino-closed-reason">Casinoet har lukket, da manager er i skole!</p>
    <p class="casino-closed-open"><strong>${openText}</strong></p>
    <a href="/app" class="casino-closed-back">← Tilbage til app</a>
  </main>
</body>
</html>`;
}

app.get('/casino', (req, res) => {
  noCacheHeaders(res);
  if (isCasinoClosed()) {
    return res.status(404).send(getCasinoClosedHtml(getNextOpenLabel()));
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
