const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

const MAX_BODY_LENGTH = 500;

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

/** GET /api/jokes – liste for brugerens klasse (eller alle klasser hvis admin + ?all=1). ?date=YYYY-MM-DD (default: i dag Copenhagen). */
router.get('/', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const showAll = req.query.all === '1' || req.query.all === 'true';
      const admin = await isAdmin(client, req.userId);
      const classId = await getUserClassId(client, req.userId);

      let dateStr = req.query.date;
      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr).trim())) {
        const r = await client.query(`SELECT (NOW() AT TIME ZONE 'Europe/Copenhagen')::date AS d`);
        dateStr = r.rows[0]?.d?.toISOString?.()?.slice(0, 10) || new Date().toISOString().slice(0, 10);
      } else {
        dateStr = String(dateStr).trim();
      }

      if (showAll && admin) {
        const listRes = await client.query(
          `SELECT j.id, j.class_id, j.user_id, j.body, j.submitted_date, j.created_at,
                  u.name AS user_name,
                  c.name AS class_name,
                  COALESCE(vc.cnt, 0)::int AS vote_count,
                  (EXISTS (SELECT 1 FROM joke_votes v WHERE v.joke_id = j.id AND v.user_id = $1)) AS current_user_has_voted
           FROM jokes j
           LEFT JOIN users u ON u.id = j.user_id
           LEFT JOIN classes c ON c.id = j.class_id
           LEFT JOIN (SELECT joke_id, COUNT(*) AS cnt FROM joke_votes GROUP BY joke_id) vc ON vc.joke_id = j.id
           WHERE j.submitted_date = $2::date
           ORDER BY j.class_id, COALESCE(vc.cnt, 0) DESC, j.created_at DESC`,
          [req.userId, dateStr]
        );
        const jokes = listRes.rows.map((row) => ({
          id: row.id,
          classId: row.class_id,
          className: row.class_name,
          userId: row.user_id,
          userName: row.user_name,
          body: row.body,
          submittedDate: row.submitted_date,
          createdAt: row.created_at,
          voteCount: row.vote_count,
          currentUserHasVoted: row.current_user_has_voted,
          isOwn: row.user_id === req.userId,
        }));
        return res.json({ jokes });
      }

      if (!classId) return res.status(400).json({ error: 'Klasse ikke fundet' });

      const listRes = await client.query(
        `SELECT j.id, j.class_id, j.user_id, j.body, j.submitted_date, j.created_at,
                u.name AS user_name,
                COALESCE(vc.cnt, 0)::int AS vote_count,
                (EXISTS (SELECT 1 FROM joke_votes v WHERE v.joke_id = j.id AND v.user_id = $2)) AS current_user_has_voted
         FROM jokes j
         LEFT JOIN users u ON u.id = j.user_id
         LEFT JOIN (SELECT joke_id, COUNT(*) AS cnt FROM joke_votes GROUP BY joke_id) vc ON vc.joke_id = j.id
         WHERE j.class_id = $1 AND j.submitted_date = $3::date
         ORDER BY COALESCE(vc.cnt, 0) DESC, j.created_at DESC`,
        [classId, req.userId, dateStr]
      );

      const jokes = listRes.rows.map((row) => ({
        id: row.id,
        classId: row.class_id,
        userId: row.user_id,
        userName: row.user_name,
        body: row.body,
        submittedDate: row.submitted_date,
        createdAt: row.created_at,
        voteCount: row.vote_count,
        currentUserHasVoted: row.current_user_has_voted,
        isOwn: row.user_id === req.userId,
      }));

      res.json({ jokes });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** POST /api/jokes – opret joke (én per bruger per dag). */
router.post('/', async (req, res) => {
  const body = req.body && req.body.body != null ? String(req.body.body).trim() : '';
  if (!body) return res.status(400).json({ error: 'Joke-tekst kræves' });
  if (body.length > MAX_BODY_LENGTH) {
    return res.status(400).json({ error: 'Joke må højst være ' + MAX_BODY_LENGTH + ' tegn' });
  }

  try {
    const client = await pool.connect();
    try {
      const classId = await getUserClassId(client, req.userId);
      if (!classId) return res.status(400).json({ error: 'Klasse ikke fundet' });

      const dateRes = await client.query(
        `SELECT (NOW() AT TIME ZONE 'Europe/Copenhagen')::date AS d`
      );
      const submittedDate = dateRes.rows[0]?.d?.toISOString?.()?.slice(0, 10);
      if (!submittedDate) return res.status(500).json({ error: 'Kunne ikke bestemme dato' });

      const existing = await client.query(
        'SELECT 1 FROM jokes WHERE class_id = $1 AND user_id = $2 AND submitted_date = $3::date',
        [classId, req.userId, submittedDate]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'Du har allerede indsendt én joke i dag' });
      }

      const insertRes = await client.query(
        `INSERT INTO jokes (class_id, user_id, body, submitted_date)
         VALUES ($1, $2, $3, $4::date)
         RETURNING id, class_id, user_id, body, submitted_date, created_at`,
        [classId, req.userId, body, submittedDate]
      );

      const row = insertRes.rows[0];
      res.status(201).json({
        id: row.id,
        classId: row.class_id,
        userId: row.user_id,
        body: row.body,
        submittedDate: row.submitted_date,
        createdAt: row.created_at,
        voteCount: 0,
        currentUserHasVoted: false,
        isOwn: true,
      });
    } finally {
      client.release();
    }
  } catch (e) {
    if (e.code === '23505') {
      return res.status(400).json({ error: 'Du har allerede indsendt én joke i dag' });
    }
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** POST /api/jokes/:id/vote – stem på joke (ikke egen). */
router.post('/:id/vote', async (req, res) => {
  const jokeId = toInt(req.params.id);
  if (!jokeId) return res.status(400).json({ error: 'Ugyldigt id' });

  try {
    const client = await pool.connect();
    try {
      const classId = await getUserClassId(client, req.userId);
      if (!classId) return res.status(400).json({ error: 'Klasse ikke fundet' });

      const jokeRow = await client.query(
        'SELECT id, user_id, class_id FROM jokes WHERE id = $1',
        [jokeId]
      );
      if (!jokeRow.rows.length) return res.status(404).json({ error: 'Joke ikke fundet' });

      const joke = jokeRow.rows[0];
      if (joke.class_id !== classId) return res.status(404).json({ error: 'Joke ikke fundet' });
      if (joke.user_id === req.userId) {
        return res.status(400).json({ error: 'Du kan ikke stemme på din egen joke' });
      }

      await client.query(
        `INSERT INTO joke_votes (joke_id, user_id) VALUES ($1, $2)
         ON CONFLICT (joke_id, user_id) DO NOTHING`,
        [jokeId, req.userId]
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

/** DELETE /api/jokes/:id/vote – fjern stemme */
router.delete('/:id/vote', async (req, res) => {
  const jokeId = toInt(req.params.id);
  if (!jokeId) return res.status(400).json({ error: 'Ugyldigt id' });

  try {
    const client = await pool.connect();
    try {
      const classId = await getUserClassId(client, req.userId);
      if (!classId) return res.status(400).json({ error: 'Klasse ikke fundet' });

      const jokeRow = await client.query(
        'SELECT id, class_id FROM jokes WHERE id = $1',
        [jokeId]
      );
      if (!jokeRow.rows.length) return res.status(404).json({ error: 'Joke ikke fundet' });
      if (jokeRow.rows[0].class_id !== classId) return res.status(404).json({ error: 'Joke ikke fundet' });

      await client.query(
        'DELETE FROM joke_votes WHERE joke_id = $1 AND user_id = $2',
        [jokeId, req.userId]
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

/** DELETE /api/jokes/:id – slet joke (kun egen eller admin) */
router.delete('/:id', async (req, res) => {
  const jokeId = toInt(req.params.id);
  if (!jokeId) return res.status(400).json({ error: 'Ugyldigt id' });

  try {
    const client = await pool.connect();
    try {
      const row = await client.query(
        'SELECT id, user_id, class_id FROM jokes WHERE id = $1',
        [jokeId]
      );
      if (!row.rows.length) return res.status(404).json({ error: 'Joke ikke fundet' });

      const rec = row.rows[0];
      const canDelete = rec.user_id === req.userId || (await isAdmin(client, req.userId));
      if (!canDelete) return res.status(403).json({ error: 'Du kan kun slette din egen joke' });

      await client.query('DELETE FROM jokes WHERE id = $1', [jokeId]);
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
