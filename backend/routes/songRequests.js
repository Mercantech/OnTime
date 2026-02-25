const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');
const { searchTracks } = require('../spotify');

const router = express.Router();

function toInt(x) {
  const n = parseInt(x, 10);
  return Number.isNaN(n) ? null : n;
}

async function getUserClassId(client, userId) {
  const r = await client.query('SELECT class_id FROM users WHERE id = $1', [userId]);
  return r.rows[0]?.class_id ?? null;
}

async function isAdmin(client, userId) {
  const r = await client.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
  return !!r.rows[0]?.is_admin;
}

router.use(auth);

/** GET /api/song-requests – liste for brugerens klasse (eller alle klasser hvis admin + ?all=1) */
router.get('/', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const showAll = req.query.all === '1' || req.query.all === 'true';
      const admin = await isAdmin(client, req.userId);
      const classId = await getUserClassId(client, req.userId);

      if (showAll && admin) {
        const listRes = await client.query(
          `SELECT sr.id, sr.class_id, sr.requested_by, sr.spotify_track_id, sr.track_name, sr.artist_name, sr.album_art_url, sr.preview_url, sr.created_at,
                  u.name AS requested_by_name,
                  c.name AS class_name,
                  COALESCE(vc.cnt, 0)::int AS vote_count,
                  (EXISTS (SELECT 1 FROM song_request_votes v WHERE v.request_id = sr.id AND v.user_id = $1)) AS current_user_has_voted
           FROM song_requests sr
           LEFT JOIN users u ON u.id = sr.requested_by
           LEFT JOIN classes c ON c.id = sr.class_id
           LEFT JOIN (SELECT request_id, COUNT(*) AS cnt FROM song_request_votes GROUP BY request_id) vc ON vc.request_id = sr.id
           ORDER BY sr.class_id, COALESCE(vc.cnt, 0) DESC, sr.created_at DESC`,
          [req.userId]
        );
        const list = listRes.rows.map((row) => ({
          id: row.id,
          classId: row.class_id,
          className: row.class_name,
          requestedBy: row.requested_by,
          requestedByName: row.requested_by_name,
          spotifyTrackId: row.spotify_track_id,
          trackName: row.track_name,
          artistName: row.artist_name,
          albumArtUrl: row.album_art_url,
          previewUrl: row.preview_url,
          createdAt: row.created_at,
          voteCount: row.vote_count,
          currentUserHasVoted: row.current_user_has_voted,
        }));
        return res.json({ requests: list });
      }

      if (!classId) return res.status(400).json({ error: 'Klasse ikke fundet' });

      const listRes = await client.query(
        `SELECT sr.id, sr.class_id, sr.requested_by, sr.spotify_track_id, sr.track_name, sr.artist_name, sr.album_art_url, sr.preview_url, sr.created_at,
                u.name AS requested_by_name,
                COALESCE(vc.cnt, 0)::int AS vote_count,
                (EXISTS (SELECT 1 FROM song_request_votes v WHERE v.request_id = sr.id AND v.user_id = $2)) AS current_user_has_voted
         FROM song_requests sr
         LEFT JOIN users u ON u.id = sr.requested_by
         LEFT JOIN (SELECT request_id, COUNT(*) AS cnt FROM song_request_votes GROUP BY request_id) vc ON vc.request_id = sr.id
         WHERE sr.class_id = $1
         ORDER BY COALESCE(vc.cnt, 0) DESC, sr.created_at DESC`,
        [classId, req.userId]
      );

      const list = listRes.rows.map((row) => ({
        id: row.id,
        classId: row.class_id,
        requestedBy: row.requested_by,
        requestedByName: row.requested_by_name,
        spotifyTrackId: row.spotify_track_id,
        trackName: row.track_name,
        artistName: row.artist_name,
        albumArtUrl: row.album_art_url,
        previewUrl: row.preview_url,
        createdAt: row.created_at,
        voteCount: row.vote_count,
        currentUserHasVoted: row.current_user_has_voted,
      }));

      res.json({ requests: list });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** GET /api/song-requests/search?q=... – proxy til Spotify søgning */
router.get('/search', async (req, res) => {
  const q = req.query.q;
  if (q == null || String(q).trim() === '') {
    return res.status(400).json({ error: 'Søgeord (q) mangler' });
  }
  try {
    const tracks = await searchTracks(String(q), 10);
    res.json({ tracks });
  } catch (e) {
    if (e.message && e.message.includes('SPOTIFY_CLIENT')) {
      console.warn('Sangønsker søgning: Spotify er ikke konfigureret (sæt SPOTIFY_CLIENT_ID og SPOTIFY_CLIENT_SECRET i .env)');
      return res.status(503).json({
        error: 'Spotify er ikke konfigureret. Sæt SPOTIFY_CLIENT_ID og SPOTIFY_CLIENT_SECRET i .env (se README).',
      });
    }
    console.error(e);
    res.status(502).json({ error: 'Kunne ikke søge i Spotify' });
  }
});

/** POST /api/song-requests – opret forespørgsel */
router.post('/', async (req, res) => {
  const { spotify_track_id, track_name, artist_name, album_art_url, preview_url } = req.body;
  if (!spotify_track_id || !track_name || !artist_name) {
    return res.status(400).json({ error: 'spotify_track_id, track_name og artist_name er påkrævet' });
  }

  try {
    const client = await pool.connect();
    try {
      const classId = await getUserClassId(client, req.userId);
      if (!classId) return res.status(400).json({ error: 'Klasse ikke fundet' });

      const insertRes = await client.query(
        `INSERT INTO song_requests (class_id, requested_by, spotify_track_id, track_name, artist_name, album_art_url, preview_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, class_id, requested_by, spotify_track_id, track_name, artist_name, album_art_url, preview_url, created_at`,
        [
          classId,
          req.userId,
          String(spotify_track_id).trim(),
          String(track_name).trim(),
          String(artist_name).trim(),
          album_art_url ? String(album_art_url).trim() : null,
          preview_url ? String(preview_url).trim() : null,
        ]
      );

      const row = insertRes.rows[0];
      res.status(201).json({
        id: row.id,
        classId: row.class_id,
        requestedBy: row.requested_by,
        spotifyTrackId: row.spotify_track_id,
        trackName: row.track_name,
        artistName: row.artist_name,
        albumArtUrl: row.album_art_url,
        previewUrl: row.preview_url,
        createdAt: row.created_at,
        voteCount: 0,
        currentUserHasVoted: false,
      });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** POST /api/song-requests/:id/vote – stem op */
router.post('/:id/vote', async (req, res) => {
  const requestId = toInt(req.params.id);
  if (!requestId) return res.status(400).json({ error: 'Ugyldigt id' });

  try {
    const client = await pool.connect();
    try {
      const classId = await getUserClassId(client, req.userId);
      if (!classId) return res.status(400).json({ error: 'Klasse ikke fundet' });

      const reqRow = await client.query(
        'SELECT id FROM song_requests WHERE id = $1 AND class_id = $2',
        [requestId, classId]
      );
      if (!reqRow.rows.length) return res.status(404).json({ error: 'Forespørgsel ikke fundet' });

      await client.query(
        `INSERT INTO song_request_votes (request_id, user_id) VALUES ($1, $2)
         ON CONFLICT (request_id, user_id) DO NOTHING`,
        [requestId, req.userId]
      );

      res.json({ ok: true });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** DELETE /api/song-requests/:id/vote – fjern stemme */
router.delete('/:id/vote', async (req, res) => {
  const requestId = toInt(req.params.id);
  if (!requestId) return res.status(400).json({ error: 'Ugyldigt id' });

  try {
    const client = await pool.connect();
    try {
      const classId = await getUserClassId(client, req.userId);
      if (!classId) return res.status(400).json({ error: 'Klasse ikke fundet' });

      const reqRow = await client.query(
        'SELECT id FROM song_requests WHERE id = $1 AND class_id = $2',
        [requestId, classId]
      );
      if (!reqRow.rows.length) return res.status(404).json({ error: 'Forespørgsel ikke fundet' });

      await client.query(
        'DELETE FROM song_request_votes WHERE request_id = $1 AND user_id = $2',
        [requestId, req.userId]
      );

      res.json({ ok: true });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** DELETE /api/song-requests/:id – slet forespørgsel (egen eller admin sletter alle) */
router.delete('/:id', async (req, res) => {
  const requestId = toInt(req.params.id);
  if (!requestId) return res.status(400).json({ error: 'Ugyldigt id' });

  try {
    const client = await pool.connect();
    try {
      const row = await client.query(
        'SELECT id, requested_by, class_id FROM song_requests WHERE id = $1',
        [requestId]
      );
      if (!row.rows.length) return res.status(404).json({ error: 'Forespørgsel ikke fundet' });

      const rec = row.rows[0];
      const canDelete = rec.requested_by === req.userId || (await isAdmin(client, req.userId));
      if (!canDelete) return res.status(403).json({ error: 'Du kan kun slette egne ønsker' });

      await client.query('DELETE FROM song_requests WHERE id = $1', [requestId]);
      res.json({ ok: true });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

module.exports = router;
