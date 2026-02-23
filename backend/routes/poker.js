const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

const POKER_BUY_IN = 5;
const INVITE_CODE_LENGTH = 6;
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function monthWindowSql(field) {
  return `${field} >= date_trunc('month', CURRENT_DATE) AND ${field} < date_trunc('month', CURRENT_DATE) + interval '1 month'`;
}

async function getUserMonthPointsTotal(client, userId) {
  const r = await client.query(
    `SELECT (
      COALESCE((SELECT SUM(points)::int FROM check_ins WHERE user_id = $1 AND ${monthWindowSql('checked_at')}), 0)
      + COALESCE((SELECT SUM(points)::int FROM game_completions WHERE user_id = $1
          AND play_date >= date_trunc('month', CURRENT_DATE)::date
          AND play_date < (date_trunc('month', CURRENT_DATE)::date + interval '1 month')::date), 0)
      + COALESCE((SELECT SUM(delta)::int FROM point_transactions WHERE user_id = $1 AND ${monthWindowSql('created_at')}), 0)
    )::int AS total_points`,
    [userId]
  );
  return r.rows[0]?.total_points ?? 0;
}

function generateInviteCode() {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

router.use(auth);

/** Hent brugerens aktive pokerbord (til genoprettelse ved refresh). */
router.get('/my-table', async (req, res) => {
  const userId = req.userId;
  try {
    const r = await pool.query(
      `SELECT t.id AS "tableId", t.invite_code AS "inviteCode"
       FROM poker_tables t
       JOIN poker_table_players p ON p.table_id = t.id AND p.left_at IS NULL
       WHERE p.user_id = $1
       LIMIT 1`,
      [userId]
    );
    if (r.rows.length === 0) {
      return res.json({ tableId: null, inviteCode: null });
    }
    res.json({ tableId: r.rows[0].tableId, inviteCode: r.rows[0].inviteCode });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Opret nyt pokerbord. Returnerer tableId og inviteCode. */
router.post('/tables', async (req, res) => {
  const userId = req.userId;
  const client = await pool.connect();
  try {
    const balance = await getUserMonthPointsTotal(client, userId);
    if (balance < POKER_BUY_IN) {
      return res.status(400).json({ error: 'Du har ikke nok point (min. ' + POKER_BUY_IN + ' pt til buy-in).' });
    }
    let code;
    for (let attempt = 0; attempt < 10; attempt++) {
      code = generateInviteCode();
      const existing = await client.query('SELECT 1 FROM poker_tables WHERE invite_code = $1', [code]);
      if (existing.rows.length === 0) break;
    }
    if (!code) {
      return res.status(500).json({ error: 'Kunne ikke generere unik kode' });
    }
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO point_transactions (user_id, delta, reason) VALUES ($1, $2, $3)`,
      [userId, -POKER_BUY_IN, 'Poker buy-in']
    );
    const insert = await client.query(
      `INSERT INTO poker_tables (invite_code, created_by_user_id, status) VALUES ($1, $2, 'waiting') RETURNING id, invite_code, created_at`,
      [code, userId]
    );
    const tableId = insert.rows[0].id;
    await client.query(
      `INSERT INTO poker_table_players (table_id, user_id, seat_index, chips_in_hand) VALUES ($1, $2, 0, $3)`,
      [tableId, userId, POKER_BUY_IN]
    );
    await client.query('COMMIT');
    res.status(201).json({
      tableId,
      inviteCode: code,
      message: 'Bord oprettet. Del koden med andre for at de kan joine.',
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  } finally {
    client.release();
  }
});

/** Hent bord-info via invite-kode (antal spillere, status). */
router.get('/tables/by-code/:code', async (req, res) => {
  const code = (req.params.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) {
    return res.status(400).json({ error: 'Ugyldig kode' });
  }
  try {
    const r = await pool.query(
      `SELECT t.id, t.invite_code, t.status, t.created_by_user_id, t.small_blind, t.big_blind,
              (SELECT COUNT(*)::int FROM poker_table_players WHERE table_id = t.id AND left_at IS NULL) AS player_count
       FROM poker_tables t WHERE t.invite_code = $1`,
      [code]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Bord ikke fundet' });
    }
    const row = r.rows[0];
    res.json({
      tableId: row.id,
      inviteCode: row.invite_code,
      status: row.status,
      playerCount: row.player_count,
      smallBlind: row.small_blind,
      bigBlind: row.big_blind,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Hent bord-info via id. */
router.get('/tables/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) {
    return res.status(400).json({ error: 'Ugyldigt bord-id' });
  }
  try {
    const r = await pool.query(
      `SELECT t.id, t.invite_code, t.status, t.created_by_user_id, t.small_blind, t.big_blind,
              (SELECT COUNT(*)::int FROM poker_table_players WHERE table_id = t.id AND left_at IS NULL) AS player_count
       FROM poker_tables t WHERE t.id = $1`,
      [id]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Bord ikke fundet' });
    }
    const row = r.rows[0];
    const players = await pool.query(
      `SELECT p.user_id, p.seat_index, p.chips_in_hand, u.name
       FROM poker_table_players p
       JOIN users u ON u.id = p.user_id
       WHERE p.table_id = $1 AND p.left_at IS NULL
       ORDER BY p.seat_index`,
      [id]
    );
    res.json({
      tableId: row.id,
      inviteCode: row.invite_code,
      status: row.status,
      playerCount: row.player_count,
      smallBlind: row.small_blind,
      bigBlind: row.big_blind,
      players: players.rows.map((p) => ({ userId: p.user_id, seatIndex: p.seat_index, chipsInHand: p.chips_in_hand, name: p.name })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Join et bord (buy-in, tildel ledig plads). */
router.post('/tables/:id/join', async (req, res) => {
  const userId = req.userId;
  const tableId = parseInt(req.params.id, 10);
  if (isNaN(tableId) || tableId < 1) {
    return res.status(400).json({ error: 'Ugyldigt bord-id' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tableRes = await client.query(
      'SELECT id, status FROM poker_tables WHERE id = $1',
      [tableId]
    );
    if (tableRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Bord ikke fundet' });
    }
    if (tableRes.rows[0].status !== 'waiting') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Spillet er i gang. Du kan ikke joine nu.' });
    }
    const already = await client.query(
      'SELECT 1 FROM poker_table_players WHERE table_id = $1 AND user_id = $2 AND left_at IS NULL',
      [tableId, userId]
    );
    if (already.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.json({ alreadyJoined: true, tableId });
    }
    const occupied = await client.query(
      'SELECT seat_index FROM poker_table_players WHERE table_id = $1 AND left_at IS NULL',
      [tableId]
    );
    const usedSeats = new Set(occupied.rows.map((r) => r.seat_index));
    if (usedSeats.size >= 4) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Bordet er fuldt' });
    }
    let seatIndex = 0;
    for (; seatIndex < 4; seatIndex++) {
      if (!usedSeats.has(seatIndex)) break;
    }
    const balance = await getUserMonthPointsTotal(client, userId);
    if (balance < POKER_BUY_IN) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Du har ikke nok point (min. ' + POKER_BUY_IN + ' pt).' });
    }
    await client.query(
      `INSERT INTO point_transactions (user_id, delta, reason) VALUES ($1, $2, $3)`,
      [userId, -POKER_BUY_IN, 'Poker buy-in']
    );
    await client.query(
      `INSERT INTO poker_table_players (table_id, user_id, seat_index, chips_in_hand) VALUES ($1, $2, $3, $4)`,
      [tableId, userId, seatIndex, POKER_BUY_IN]
    );
    await client.query('COMMIT');
    res.json({ joined: true, tableId, seatIndex });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  } finally {
    client.release();
  }
});

module.exports = router;
