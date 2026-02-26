const express = require('express');
const { auth } = require('../middleware/auth');
const {
  getAuthUrl,
  exchangeCodeForTokens,
  getAccessTokenForUser,
  disconnectUser,
  getClientConfig,
} = require('../spotifyOAuth');

const router = express.Router();

/**
 * GET /api/spotify/auth-url
 * Returnerer URL til Spotify OAuth (brugeren skal være logget ind).
 */
router.get('/auth-url', auth, (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${baseUrl.replace(/\/$/, '')}/api/spotify/callback`;
    const url = getAuthUrl(redirectUri, req.userId);
    res.json({ url });
  } catch (e) {
    if (e.message && e.message.includes('SPOTIFY_CLIENT')) {
      return res.status(503).json({
        error: 'Spotify er ikke konfigureret. Sæt SPOTIFY_CLIENT_ID og SPOTIFY_CLIENT_SECRET.',
      });
    }
    throw e;
  }
});

/**
 * GET /api/spotify/callback?code=...&state=...
 * Spotify redirecter her efter login. Ingen OnTime-auth; state indeholder signeret userId.
 */
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) {
    return res.redirect('/spotify?error=missing_params');
  }
  try {
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${baseUrl.replace(/\/$/, '')}/api/spotify/callback`;
    await exchangeCodeForTokens(redirectUri, code, state);
    res.redirect('/spotify?connected=1');
  } catch (e) {
    console.error('Spotify callback error:', e.message);
    res.redirect(`/spotify?error=${encodeURIComponent(e.message || 'forbindelse_fejlede')}`);
  }
});

/**
 * GET /api/spotify/token
 * Returnerer gyldig access token til Web Playback SDK (opdaterer med refresh hvis nødvendigt).
 */
router.get('/token', auth, async (req, res) => {
  try {
    const token = await getAccessTokenForUser(req.userId);
    if (!token) {
      return res.status(404).json({ error: 'Spotify er ikke forbundet. Klik på "Forbind Spotify".' });
    }
    res.json({ access_token: token });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'Kunne ikke hente Spotify-token' });
  }
});

/**
 * DELETE /api/spotify/disconnect
 * Fjern Spotify-forbindelsen for den aktuelle bruger.
 */
router.delete('/disconnect', auth, async (req, res) => {
  try {
    await disconnectUser(req.userId);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Kunne ikke fjerne forbindelsen' });
  }
});

/**
 * GET /api/spotify/connected
 * Tjek om brugeren har forbundet Spotify (uden at returnere token).
 */
router.get('/connected', auth, async (req, res) => {
  try {
    const token = await getAccessTokenForUser(req.userId);
    res.json({ connected: !!token });
  } catch {
    res.json({ connected: false });
  }
});

module.exports = router;
