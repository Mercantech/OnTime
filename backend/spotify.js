const https = require('https');

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Hent et access token via Spotify Client Credentials flow.
 * Token caches i hukommelsen til expires_in (typisk 1 time).
 */
async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60000) {
    return cachedToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('SPOTIFY_CLIENT_ID og SPOTIFY_CLIENT_SECRET skal være sat');
  }

  const body = 'grant_type=client_credentials';
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const token = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'accounts.spotify.com',
        path: '/api/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Basic ${auth}`,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Spotify token: ${res.statusCode} ${data}`));
            return;
          }
          try {
            const json = JSON.parse(data);
            resolve(json.access_token);
            cachedToken = json.access_token;
            tokenExpiresAt = Date.now() + (Number(json.expires_in) || 3600) * 1000;
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  return token;
}

/**
 * Søg efter tracks i Spotify. Returnerer tracks med id, name, artists, album.images, preview_url.
 */
async function searchTracks(q, limit = 10) {
  const token = await getAccessToken();
  const path = `/v1/search?${new URLSearchParams({
    type: 'track',
    q: String(q).trim() || ' ',
    limit: Math.min(20, Math.max(1, limit)),
  })}`;

  const result = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.spotify.com',
        path,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Spotify search: ${res.statusCode} ${data}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });

  const tracks = result.tracks?.items ?? [];
  return tracks.map((t) => ({
    id: t.id,
    name: t.name,
    artists: (t.artists ?? []).map((a) => a.name).join(', '),
    albumArtUrl: t.album?.images?.[0]?.url ?? null,
    previewUrl: t.preview_url ?? null,
  }));
}

module.exports = { getAccessToken, searchTracks };
