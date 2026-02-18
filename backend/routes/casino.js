const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

const SYMBOLS = ['🍒', '🍋', '🍊', '⭐', '7️⃣', '💎'];
const COST_PER_SPIN = 1;

function monthWindowSql(field) {
  return `${field} >= date_trunc('month', CURRENT_DATE) AND ${field} < date_trunc('month', CURRENT_DATE) + interval '1 month'`;
}

async function getUserMonthPointsTotal(client, userId) {
  const r = await client.query(
    `
    SELECT
      (
        COALESCE((SELECT SUM(points)::int FROM check_ins WHERE user_id = $1 AND ${monthWindowSql('checked_at')}), 0)
        + COALESCE((SELECT SUM(points)::int FROM game_completions WHERE user_id = $1
            AND play_date >= date_trunc('month', CURRENT_DATE)::date
            AND play_date < (date_trunc('month', CURRENT_DATE)::date + interval '1 month')::date), 0)
        + COALESCE((SELECT SUM(delta)::int FROM point_transactions WHERE user_id = $1 AND ${monthWindowSql('created_at')}), 0)
      )::int AS total_points
    `,
    [userId]
  );
  return r.rows[0]?.total_points ?? 0;
}

/** Har brugeren allerede spillet casino i dag? (kostet 1 point) */
async function hasSpunToday(client, userId) {
  const r = await client.query(
    `SELECT 1 FROM point_transactions
     WHERE user_id = $1 AND delta = -${COST_PER_SPIN}
       AND reason = 'Casino spin'
       AND created_at >= CURRENT_DATE
       AND created_at < CURRENT_DATE + interval '1 day'
     LIMIT 1`,
    [userId]
  );
  return r.rows.length > 0;
}

/** Har brugeren badge one_armed_bandit? */
async function hasBadge(client, userId) {
  const r = await client.query(
    'SELECT 1 FROM user_badges WHERE user_id = $1 AND badge_key = $2',
    [userId, 'one_armed_bandit']
  );
  return r.rows.length > 0;
}

/** ~95% tilbagebetaling: 50% tab (0), 15% +1, 25% +2, 10% +3. Returner { symbols, win, message }. */
function runSlotRng() {
  const s1 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  const s2 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  const s3 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  const r = Math.random();

  if (r < 0.50) return { symbols: [s1, s2, s3], win: 0, message: 'Desværre – ingen gevinst. Prøv igen i morgen!' };
  if (r < 0.65) return { symbols: [s1, s2, s3], win: 1, message: 'Lille gevinst! +1 point.' };
  if (r < 0.90) return { symbols: [s1, s2, s3], win: 2, message: 'Flot! +2 point.' };
  return { symbols: [s1, s2, s3], win: 3, message: 'Jackpot! +3 point! 🎰' };
}

router.use(auth);

/** Status: kan brugeren spinne, saldo, har de spillet i dag, har de badge? */
router.get('/status', async (req, res) => {
  try {
    const userId = req.userId;
    const client = await pool.connect();
    try {
      const [balance, spunToday, badgeEarned] = await Promise.all([
        getUserMonthPointsTotal(client, userId),
        hasSpunToday(client, userId),
        hasBadge(client, userId),
      ]);
      res.json({
        balance,
        canSpin: balance >= COST_PER_SPIN && !spunToday,
        alreadySpunToday: spunToday,
        badgeEarned: !!badgeEarned,
        costPerSpin: COST_PER_SPIN,
      });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Træk i den enarmede – 1 point, max én gang per dag. Huset vinder oftest. */
router.post('/spin', async (req, res) => {
  const userId = req.userId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const [balance, spunToday, hadBadge] = await Promise.all([
      getUserMonthPointsTotal(client, userId),
      hasSpunToday(client, userId),
      hasBadge(client, userId),
    ]);

    if (spunToday) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Du har allerede spillet én gang i dag. Kom tilbage i morgen!' });
    }
    if (balance < COST_PER_SPIN) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Du har ikke nok point (skal bruge 1 point).' });
    }

    await client.query(
      `INSERT INTO point_transactions (user_id, delta, reason) VALUES ($1, $2, $3)`,
      [userId, -COST_PER_SPIN, 'Casino spin']
    );

    const result = runSlotRng();
    if (result.win > 0) {
      await client.query(
        `INSERT INTO point_transactions (user_id, delta, reason) VALUES ($1, $2, $3)`,
        [userId, result.win, 'Casino gevinst']
      );
    }

    let badgeEarned = false;
    if (!hadBadge) {
      await client.query(
        'INSERT INTO user_badges (user_id, badge_key) VALUES ($1, $2) ON CONFLICT (user_id, badge_key) DO NOTHING',
        [userId, 'one_armed_bandit']
      );
      badgeEarned = true;
    }

    await client.query('COMMIT');
    res.json({
      symbols: result.symbols,
      win: result.win,
      message: result.message,
      badgeEarned,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  } finally {
    client.release();
  }
});

module.exports = router;
