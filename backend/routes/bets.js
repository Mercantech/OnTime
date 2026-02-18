const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');

const router = express.Router();

function toInt(x) {
  const n = parseInt(x, 10);
  return Number.isNaN(n) ? null : n;
}

function normalizeOptionLabel(s) {
  return String(s || '').trim();
}

async function getUserClassId(client, userId) {
  const r = await client.query('SELECT class_id FROM users WHERE id = $1', [userId]);
  return r.rows[0]?.class_id ?? null;
}

function monthWindowSql(field) {
  return `${field} >= date_trunc('month', CURRENT_DATE) AND ${field} < date_trunc('month', CURRENT_DATE) + interval '1 month'`;
}

async function getUserMonthPointsTotal(client, userId) {
  const r = await client.query(
    `
      SELECT
        (
          COALESCE((
            SELECT SUM(points)::int
            FROM check_ins
            WHERE user_id = $1 AND ${monthWindowSql('checked_at')}
          ), 0)
          +
          COALESCE((
            SELECT SUM(points)::int
            FROM game_completions
            WHERE user_id = $1
              AND play_date >= date_trunc('month', CURRENT_DATE)::date
              AND play_date < (date_trunc('month', CURRENT_DATE)::date + interval '1 month')::date
          ), 0)
          +
          COALESCE((
            SELECT SUM(delta)::int
            FROM point_transactions
            WHERE user_id = $1 AND ${monthWindowSql('created_at')}
          ), 0)
        )::int AS total_points
    `,
    [userId]
  );
  return r.rows[0]?.total_points ?? 0;
}

async function hydrateBet(client, betId, userId) {
  const betRes = await client.query(
    `SELECT b.id, b.class_id, b.title, b.description, b.status, b.created_by, b.created_at, b.locked_at, b.resolved_at, b.refunded_at, b.winner_option_id
     FROM bets b
     WHERE b.id = $1`,
    [betId]
  );
  if (!betRes.rows.length) return null;
  const bet = betRes.rows[0];

  const [optRes, sumsRes, myRes] = await Promise.all([
    client.query(
      `SELECT id, label, sort_order
       FROM bet_options
       WHERE bet_id = $1
       ORDER BY sort_order, id`,
      [betId]
    ),
    client.query(
      `SELECT option_id, COALESCE(SUM(points), 0)::int AS pot
       FROM bet_wagers
       WHERE bet_id = $1
       GROUP BY option_id`,
      [betId]
    ),
    userId
      ? client.query(
          `SELECT id, option_id, points
           FROM bet_wagers
           WHERE bet_id = $1 AND user_id = $2`,
          [betId, userId]
        )
      : Promise.resolve({ rows: [] }),
  ]);

  const potByOption = {};
  sumsRes.rows.forEach((r) => {
    potByOption[r.option_id] = r.pot;
  });

  const my = myRes.rows[0] || null;

  const options = optRes.rows.map((o) => ({
    id: o.id,
    label: o.label,
    pot: potByOption[o.id] || 0,
  }));
  const totalPot = options.reduce((sum, o) => sum + (o.pot || 0), 0);

  return {
    id: bet.id,
    classId: bet.class_id,
    title: bet.title,
    description: bet.description,
    status: bet.status,
    createdBy: bet.created_by,
    createdAt: bet.created_at,
    lockedAt: bet.locked_at,
    resolvedAt: bet.resolved_at,
    refundedAt: bet.refunded_at,
    winnerOptionId: bet.winner_option_id,
    totalPot,
    options,
    myWager: my
      ? { id: my.id, optionId: my.option_id, points: my.points }
      : null,
  };
}

router.use(auth);

/** Elev/Admin: list bets (default: egen klasse) */
router.get('/', async (req, res) => {
  try {
    const classIdParam = req.query.classId != null ? toInt(req.query.classId) : null;
    const status = req.query.status ? String(req.query.status) : null;

    const client = await pool.connect();
    try {
      const myClassId = await getUserClassId(client, req.userId);
      const classId = classIdParam ?? myClassId;
      if (!classId) return res.status(400).json({ error: 'Klasse ikke fundet' });

      // Hvis man prøver at se en anden klasse: kræv admin
      if (classIdParam != null && classIdParam !== myClassId) {
        const r = await client.query('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
        if (!r.rows[0]?.is_admin) return res.status(403).json({ error: 'Kun administratorer kan se andre klasser' });
      }

      const where = ['class_id = $1'];
      const params = [classId];
      if (status) {
        where.push('status = $2');
        params.push(status);
      }
      const betsRes = await client.query(
        `SELECT id FROM bets
         WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT 50`,
        params
      );
      const list = [];
      for (const row of betsRes.rows) {
        const b = await hydrateBet(client, row.id, req.userId);
        if (b) list.push(b);
      }
      res.json({ bets: list });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Elev/Admin: bet-detaljer */
router.get('/:id', async (req, res) => {
  const betId = toInt(req.params.id);
  if (!betId) return res.status(400).json({ error: 'Ugyldigt bet-id' });
  try {
    const client = await pool.connect();
    try {
      const bet = await hydrateBet(client, betId, req.userId);
      if (!bet) return res.status(404).json({ error: 'Bet ikke fundet' });

      // Adgangskontrol: kun egen klasse medmindre admin
      const myClassId = await getUserClassId(client, req.userId);
      if (bet.classId !== myClassId) {
        const r = await client.query('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
        if (!r.rows[0]?.is_admin) return res.status(403).json({ error: 'Ingen adgang' });
      }
      res.json(bet);
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Elev: placer/justér indsats */
router.post('/:id/wager', async (req, res) => {
  const betId = toInt(req.params.id);
  const optionId = toInt(req.body?.optionId);
  const points = toInt(req.body?.points);
  if (!betId) return res.status(400).json({ error: 'Ugyldigt bet-id' });
  if (!optionId) return res.status(400).json({ error: 'Vælg en mulighed' });
  if (!points || points <= 0) return res.status(400).json({ error: 'Point skal være et positivt tal' });
  if (points > 10000) return res.status(400).json({ error: 'Point er for højt' });

  const userId = req.userId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Serialisér per bruger
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

    const betRow = await client.query(
      'SELECT id, class_id, title, status FROM bets WHERE id = $1 FOR UPDATE',
      [betId]
    );
    if (!betRow.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Bet ikke fundet' });
    }
    const bet = betRow.rows[0];
    if (bet.status !== 'open') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Dette bet er ikke åbent for indsatser' });
    }

    const myClassId = await getUserClassId(client, userId);
    if (bet.class_id !== myClassId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Du kan kun satse på bets i din egen klasse' });
    }

    const opt = await client.query('SELECT id FROM bet_options WHERE id = $1 AND bet_id = $2', [optionId, betId]);
    if (!opt.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ugyldig mulighed' });
    }

    const existing = await client.query(
      'SELECT id, option_id, points FROM bet_wagers WHERE bet_id = $1 AND user_id = $2 FOR UPDATE',
      [betId, userId]
    );

    if (!existing.rows.length) {
      const balance = await getUserMonthPointsTotal(client, userId);
      if (balance < points) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Du har kun ${balance} point denne måned.` });
      }
      const ins = await client.query(
        `INSERT INTO bet_wagers (bet_id, user_id, option_id, points)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [betId, userId, optionId, points]
      );
      const wagerId = ins.rows[0].id;
      await client.query(
        `INSERT INTO point_transactions (user_id, delta, reason, bet_id, wager_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, -points, `Bet indsats: ${bet.title}`, betId, wagerId]
      );
    } else {
      const w = existing.rows[0];
      const delta = (w.points || 0) - points; // positiv = refund, negativ = ekstra indsats
      if (delta < 0) {
        const balance = await getUserMonthPointsTotal(client, userId);
        if (balance < Math.abs(delta)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Du mangler ${Math.abs(delta) - balance} point for at øge indsatsen.` });
        }
      }
      await client.query(
        `UPDATE bet_wagers
         SET option_id = $1, points = $2, updated_at = NOW()
         WHERE id = $3`,
        [optionId, points, w.id]
      );
      if (delta !== 0) {
        await client.query(
          `INSERT INTO point_transactions (user_id, delta, reason, bet_id, wager_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, delta, `Bet justering: ${bet.title}`, betId, w.id]
        );
      }
    }

    await client.query('COMMIT');
    const out = await hydrateBet(client, betId, userId);
    res.json(out);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  } finally {
    client.release();
  }
});

/** Admin: opret bet */
router.post('/', requireAdmin, async (req, res) => {
  const classId = toInt(req.body?.classId);
  const title = String(req.body?.title || '').trim();
  const description = (req.body?.description != null) ? String(req.body.description).trim() : null;
  const optionsIn = Array.isArray(req.body?.options) ? req.body.options : [];

  if (!classId) return res.status(400).json({ error: 'Vælg en klasse' });
  if (!title) return res.status(400).json({ error: 'Titel kræves' });
  if (title.length > 120) return res.status(400).json({ error: 'Titel er for lang (max 120)' });

  const labels = optionsIn.map(normalizeOptionLabel).filter(Boolean);
  const unique = [...new Set(labels.map((x) => x.toLowerCase()))];
  if (labels.length < 2) return res.status(400).json({ error: 'Angiv mindst 2 valgmuligheder' });
  if (unique.length !== labels.length) return res.status(400).json({ error: 'Valgmuligheder skal være unikke' });
  if (labels.some((x) => x.length > 80)) return res.status(400).json({ error: 'En valgmulighed er for lang (max 80)' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cls = await client.query('SELECT id FROM classes WHERE id = $1', [classId]);
    if (!cls.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ugyldig klasse' });
    }

    const betIns = await client.query(
      `INSERT INTO bets (class_id, title, description, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [classId, title, description, req.userId]
    );
    const betId = betIns.rows[0].id;
    for (let i = 0; i < labels.length; i++) {
      await client.query(
        `INSERT INTO bet_options (bet_id, label, sort_order)
         VALUES ($1, $2, $3)`,
        [betId, labels[i], i]
      );
    }
    await client.query('COMMIT');
    const out = await hydrateBet(client, betId, req.userId);
    res.status(201).json(out);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  } finally {
    client.release();
  }
});

/** Admin: lock/unlock */
router.post('/:id/lock', requireAdmin, async (req, res) => {
  const betId = toInt(req.params.id);
  const locked = req.body?.locked === false ? false : true;
  if (!betId) return res.status(400).json({ error: 'Ugyldigt bet-id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT id, status FROM bets WHERE id = $1 FOR UPDATE', [betId]);
    if (!r.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Bet ikke fundet' });
    }
    const status = r.rows[0].status;
    if (locked) {
      if (status !== 'open') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Bet kan kun låses fra status "open"' });
      }
      await client.query(`UPDATE bets SET status = 'locked', locked_at = NOW() WHERE id = $1`, [betId]);
    } else {
      if (status !== 'locked') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Bet kan kun åbnes fra status "locked"' });
      }
      await client.query(`UPDATE bets SET status = 'open', locked_at = NULL WHERE id = $1`, [betId]);
    }
    await client.query('COMMIT');
    res.json(await hydrateBet(client, betId, req.userId));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  } finally {
    client.release();
  }
});

function computePayouts(winnerWagers, totalPot, totalWinnerStake) {
  // Returnér map userId->payout (int) + map wagerId->payout. Fordeler rest-point deterministisk.
  const base = [];
  let sum = 0;
  for (const w of winnerWagers) {
    const numer = w.points * totalPot;
    const payout = Math.floor(numer / totalWinnerStake);
    const rem = numer % totalWinnerStake;
    base.push({ ...w, payout, rem });
    sum += payout;
  }
  let leftover = totalPot - sum;
  base.sort((a, b) => {
    if (b.rem !== a.rem) return b.rem - a.rem;
    if (b.points !== a.points) return b.points - a.points;
    return a.user_id - b.user_id;
  });
  for (let i = 0; i < base.length && leftover > 0; i++) {
    base[i].payout += 1;
    leftover -= 1;
  }
  const byUser = {};
  const byWager = {};
  for (const x of base) {
    byUser[x.user_id] = (byUser[x.user_id] || 0) + x.payout;
    byWager[x.id] = x.payout;
  }
  return { byUser, byWager };
}

/** Admin: afgør (vælg vinder) */
router.post('/:id/resolve', requireAdmin, async (req, res) => {
  const betId = toInt(req.params.id);
  const winnerOptionId = toInt(req.body?.winnerOptionId);
  if (!betId) return res.status(400).json({ error: 'Ugyldigt bet-id' });
  if (!winnerOptionId) return res.status(400).json({ error: 'Vælg en vinder' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const betRes = await client.query('SELECT id, title, status FROM bets WHERE id = $1 FOR UPDATE', [betId]);
    if (!betRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Bet ikke fundet' });
    }
    const bet = betRes.rows[0];
    if (bet.status === 'resolved' || bet.status === 'refunded') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Bet er allerede afsluttet' });
    }

    const opt = await client.query('SELECT id FROM bet_options WHERE id = $1 AND bet_id = $2', [winnerOptionId, betId]);
    if (!opt.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ugyldig vinder-mulighed' });
    }

    const wagersRes = await client.query(
      `SELECT id, user_id, option_id, points
       FROM bet_wagers
       WHERE bet_id = $1`,
      [betId]
    );
    const wagers = wagersRes.rows || [];
    const totalPot = wagers.reduce((s, w) => s + (w.points || 0), 0);
    const winners = wagers.filter((w) => w.option_id === winnerOptionId);
    const totalWinnerStake = winners.reduce((s, w) => s + (w.points || 0), 0);
    if (totalPot <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ingen indsatser på dette bet' });
    }
    if (totalWinnerStake <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ingen har satset på vinderen. Brug refundér i stedet.' });
    }

    const { byWager } = computePayouts(winners, totalPot, totalWinnerStake);

    await client.query(
      `UPDATE bets
       SET status = 'resolved', resolved_at = NOW(), winner_option_id = $2
       WHERE id = $1`,
      [betId, winnerOptionId]
    );

    for (const w of winners) {
      const payout = byWager[w.id] || 0;
      if (payout > 0) {
        await client.query(
          `INSERT INTO point_transactions (user_id, delta, reason, bet_id, wager_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [w.user_id, payout, `Bet udbetaling: ${bet.title}`, betId, w.id]
        );
      }
    }

    await client.query('COMMIT');
    res.json(await hydrateBet(client, betId, req.userId));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  } finally {
    client.release();
  }
});

/** Admin: refundér alle indsatser */
router.post('/:id/refund', requireAdmin, async (req, res) => {
  const betId = toInt(req.params.id);
  if (!betId) return res.status(400).json({ error: 'Ugyldigt bet-id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const betRes = await client.query('SELECT id, title, status FROM bets WHERE id = $1 FOR UPDATE', [betId]);
    if (!betRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Bet ikke fundet' });
    }
    const bet = betRes.rows[0];
    if (bet.status === 'resolved' || bet.status === 'refunded') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Bet er allerede afsluttet' });
    }

    const wagersRes = await client.query(
      `SELECT id, user_id, points
       FROM bet_wagers
       WHERE bet_id = $1`,
      [betId]
    );
    for (const w of wagersRes.rows || []) {
      if ((w.points || 0) > 0) {
        await client.query(
          `INSERT INTO point_transactions (user_id, delta, reason, bet_id, wager_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [w.user_id, w.points, `Bet refund: ${bet.title}`, betId, w.id]
        );
      }
    }

    await client.query(
      `UPDATE bets
       SET status = 'refunded', refunded_at = NOW(), winner_option_id = NULL
       WHERE id = $1`,
      [betId]
    );
    await client.query('COMMIT');
    res.json(await hydrateBet(client, betId, req.userId));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  } finally {
    client.release();
  }
});

module.exports = router;

