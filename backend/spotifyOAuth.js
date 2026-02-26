const https = require('https');
const jwt = require('jsonwebtoken');
const config = require('./config');
const { pool } = require('./db');

const SPOTIFY_SCOPES = [
  'streaming',
  'user-modify-playback-state',
  'user-read-playback-state',
  'user-read-currently-playing',
].join(' ');

function getClientConfig() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('SPOTIFY_CLIENT_ID og SPOTIFY_CLIENT_SECRET skal være sat');
  }
  return { clientId, clientSecret };
}

/**
 * Generer Spotify auth URL. state er signeret JWT med userId.
 */
function getAuthUrl(redirectUri, userId) {
  const { clientId } = getClientConfig();
  const state = jwt.sign(
    { userId, purpose: 'spotify-connect' },
    config.jwtSecret,
    { expiresIn: '10m' }
  );
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SPOTIFY_SCOPES,
    state,
    show_dialog: 'false',
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

/**
 * Byt auth code til tokens og gem i DB.
 */
async function exchangeCodeForTokens(redirectUri, code, stateToken) {
  let payload;
  try {
    payload = jwt.verify(stateToken, config.jwtSecret);
    if (payload.purpose !== 'spotify-connect' || !payload.userId) {
      throw new Error('Ugyldig state');
    }
  } catch (e) {
    throw new Error('Ugyldig eller udløbet state. Prøv at forbinde Spotify igen.');
  }

  const { clientId, clientSecret } = getClientConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code).trim(),
    redirect_uri: redirectUri,
  }).toString();

  const tokenResponse = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'accounts.spotify.com',
        path: '/api/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
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
            resolve(JSON.parse(data));
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

  const expiresAt = new Date(Date.now() + (tokenResponse.expires_in || 3600) * 1000);
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO spotify_user_tokens (user_id, access_token, refresh_token, expires_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         updated_at = NOW()`,
      [
        payload.userId,
        tokenResponse.access_token,
        tokenResponse.refresh_token,
        expiresAt,
      ]
    );
  } finally {
    client.release();
  }

  return payload.userId;
}

/**
 * Hent brugerens access token; opdater med refresh_token hvis udløbet.
 */
async function getAccessTokenForUser(userId) {
  const client = await pool.connect();
  try {
    const row = await client.query(
      'SELECT access_token, refresh_token, expires_at FROM spotify_user_tokens WHERE user_id = $1',
      [userId]
    );
    if (!row.rows.length) return null;

    const rec = row.rows[0];
    const expiresAt = new Date(rec.expires_at).getTime();
    if (expiresAt > Date.now() + 60000) {
      return rec.access_token;
    }

    const { clientId, clientSecret } = getClientConfig();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: rec.refresh_token,
    }).toString();

    const tokenResponse = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'accounts.spotify.com',
          path: '/api/token',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body),
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(new Error(`Spotify refresh: ${res.statusCode} ${data}`));
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
      req.write(body);
      req.end();
    });

    const newExpiresAt = new Date(Date.now() + (tokenResponse.expires_in || 3600) * 1000);
    const newRefresh = tokenResponse.refresh_token || rec.refresh_token;

    await client.query(
      `UPDATE spotify_user_tokens SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = NOW() WHERE user_id = $4`,
      [tokenResponse.access_token, newRefresh, newExpiresAt, userId]
    );

    return tokenResponse.access_token;
  } finally {
    client.release();
  }
}

/**
 * Fjern brugerens Spotify-forbindelse.
 */
async function disconnectUser(userId) {
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM spotify_user_tokens WHERE user_id = $1', [userId]);
  } finally {
    client.release();
  }
}

module.exports = {
  getAuthUrl,
  exchangeCodeForTokens,
  getAccessTokenForUser,
  disconnectUser,
  getClientConfig,
};
