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

const ROULETTE_COST = 1;
const ROULETTE_WIN_PAYOUT = 2;
const ROULETTE_GREEN_PAYOUT = 15;
const ROULETTE_SPINS_PER_DAY = 3;

async function getRouletteSpinsToday(client, userId) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM point_transactions
     WHERE user_id = $1 AND reason = 'Roulette' AND delta = $2
       AND created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + interval '1 day'`,
    [userId, -ROULETTE_COST]
  );
  return r.rows[0]?.n ?? 0;
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

/** Roulette status: saldo, spins brugt i dag (max 3). */
router.get('/roulette/status', async (req, res) => {
  try {
    const userId = req.userId;
    const client = await pool.connect();
    try {
      const [balance, spinsToday] = await Promise.all([
        getUserMonthPointsTotal(client, userId),
        getRouletteSpinsToday(client, userId),
      ]);
      const spinsRemaining = Math.max(0, ROULETTE_SPINS_PER_DAY - spinsToday);
      res.json({
        balance,
        canSpin: balance >= ROULETTE_COST && spinsRemaining > 0,
        spinsUsedToday: spinsToday,
        spinsRemainingToday: spinsRemaining,
        maxSpinsPerDay: ROULETTE_SPINS_PER_DAY,
        cost: ROULETTE_COST,
        winPayout: ROULETTE_WIN_PAYOUT,
        greenPayout: ROULETTE_GREEN_PAYOUT,
      });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Roulette: vælg rød, sort eller grøn. 1 pt. Rød/sort: 2 pt ved gevinst. Grøn: 15 pt ved gevinst. Max 3 spil/dag. */
router.post('/roulette/spin', async (req, res) => {
  const userId = req.userId;
  const rawBet = req.body && req.body.bet;
  const bet = rawBet === 'green' ? 'green' : rawBet === 'black' ? 'black' : 'red';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const [balance, spinsToday] = await Promise.all([
      getUserMonthPointsTotal(client, userId),
      getRouletteSpinsToday(client, userId),
    ]);

    if (spinsToday >= ROULETTE_SPINS_PER_DAY) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Du har brugt alle ' + ROULETTE_SPINS_PER_DAY + ' roulette-spin i dag.' });
    }
    if (balance < ROULETTE_COST) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Du har ikke nok point.' });
    }

    await client.query(
      `INSERT INTO point_transactions (user_id, delta, reason) VALUES ($1, $2, $3)`,
      [userId, -ROULETTE_COST, 'Roulette']
    );

    const r = Math.random();
    const result = r < 1 / 37 ? 'green' : r < 19 / 37 ? 'red' : 'black';
    const win = result === bet;
    const payout = win ? (bet === 'green' ? ROULETTE_GREEN_PAYOUT : ROULETTE_WIN_PAYOUT) : 0;
    if (payout > 0) {
      await client.query(
        `INSERT INTO point_transactions (user_id, delta, reason) VALUES ($1, $2, $3)`,
        [userId, payout, 'Roulette gevinst']
      );
    }

    await client.query('COMMIT');
    res.json({ result, win, payout });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  } finally {
    client.release();
  }
});

// --- Blackjack (robot dealer) ---
const BLACKJACK_COST = 1;
const BLACKJACK_WIN_PAYOUT = 2;
const BLACKJACK_HANDS_PER_DAY = 3;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['H', 'D', 'C', 'S'];

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(rank + suit);
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(card) {
  const r = card.slice(0, -1);
  if (r === 'A') return 11;
  if (['J', 'Q', 'K'].includes(r)) return 10;
  return parseInt(r, 10);
}

function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    const v = cardValue(card);
    total += v;
    if (v === 11) aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function isBlackjack(hand) {
  return hand.length === 2 && handValue(hand) === 21;
}

async function getBlackjackHandsToday(client, userId) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM point_transactions
     WHERE user_id = $1 AND reason = 'Blackjack' AND delta = $2
       AND created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + interval '1 day'`,
    [userId, -BLACKJACK_COST]
  );
  return r.rows[0]?.n ?? 0;
}

const blackjackGames = new Map();

router.get('/blackjack/status', async (req, res) => {
  try {
    const userId = req.userId;
    const client = await pool.connect();
    try {
      const [balance, handsToday] = await Promise.all([
        getUserMonthPointsTotal(client, userId),
        getBlackjackHandsToday(client, userId),
      ]);
      const handsRemaining = Math.max(0, BLACKJACK_HANDS_PER_DAY - handsToday);
      const inGame = blackjackGames.has(userId);
      res.json({
        balance,
        canStart: balance >= BLACKJACK_COST && handsRemaining > 0 && !inGame,
        handsUsedToday: handsToday,
        handsRemainingToday: handsRemaining,
        maxHandsPerDay: BLACKJACK_HANDS_PER_DAY,
        cost: BLACKJACK_COST,
        winPayout: BLACKJACK_WIN_PAYOUT,
        inGame,
      });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

router.post('/blackjack/start', async (req, res) => {
  const userId = req.userId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const [balance, handsToday] = await Promise.all([
      getUserMonthPointsTotal(client, userId),
      getBlackjackHandsToday(client, userId),
    ]);

    if (blackjackGames.has(userId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Du har allerede en aktiv hånd. Afslut den først.' });
    }
    if (handsToday >= BLACKJACK_HANDS_PER_DAY) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Du har brugt alle ' + BLACKJACK_HANDS_PER_DAY + ' blackjack-hænder i dag.' });
    }
    if (balance < BLACKJACK_COST) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Du har ikke nok point.' });
    }

    await client.query(
      `INSERT INTO point_transactions (user_id, delta, reason) VALUES ($1, $2, $3)`,
      [userId, -BLACKJACK_COST, 'Blackjack']
    );

    const deck = createDeck();
    const playerHand = [deck.pop(), deck.pop()];
    const dealerHand = [deck.pop(), deck.pop()];

    blackjackGames.set(userId, { deck, playerHand, dealerHand });

    const playerVal = handValue(playerHand);
    const dealerBlackjack = isBlackjack(dealerHand);
    const playerBlackjack = isBlackjack(playerHand);

    if (playerBlackjack && dealerBlackjack) {
      blackjackGames.delete(userId);
      await client.query(
        `INSERT INTO point_transactions (user_id, delta, reason) VALUES ($1, $2, $3)`,
        [userId, BLACKJACK_COST, 'Blackjack push']
      );
      await client.query('COMMIT');
      return res.json({
        result: 'push',
        playerHand,
        dealerHand,
        playerValue: 21,
        dealerValue: 21,
        payout: 0,
        message: 'Blackjack begge – push.',
      });
    }
    if (playerBlackjack) {
      blackjackGames.delete(userId);
      await client.query(
        `INSERT INTO point_transactions (user_id, delta, reason) VALUES ($1, $2, $3)`,
        [userId, BLACKJACK_WIN_PAYOUT, 'Blackjack gevinst']
      );
      await client.query('COMMIT');
      return res.json({
        result: 'blackjack',
        playerHand,
        dealerHand,
        playerValue: 21,
        dealerValue: handValue(dealerHand),
        payout: BLACKJACK_WIN_PAYOUT,
        message: 'Blackjack! Du vandt.',
      });
    }
    if (dealerBlackjack) {
      blackjackGames.delete(userId);
      await client.query('COMMIT');
      return res.json({
        result: 'lose',
        playerHand,
        dealerHand,
        playerValue: handValue(playerHand),
        dealerValue: 21,
        payout: 0,
        message: 'Dealer har blackjack – du tabte.',
      });
    }

    await client.query('COMMIT');
    res.json({
      playerHand,
      dealerVisible: [dealerHand[0]],
      dealerHidden: true,
      playerValue: playerVal,
      canHit: true,
      canStand: true,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  } finally {
    client.release();
  }
});

router.post('/blackjack/hit', async (req, res) => {
  const userId = req.userId;
  const game = blackjackGames.get(userId);
  if (!game) {
    return res.status(400).json({ error: 'Ingen aktiv hånd. Start en ny.' });
  }

  const card = game.deck.pop();
  game.playerHand.push(card);
  const playerVal = handValue(game.playerHand);

  if (playerVal > 21) {
    blackjackGames.delete(userId);
    return res.json({
      result: 'bust',
      playerHand: game.playerHand,
      dealerHand: game.dealerHand,
      playerValue: playerVal,
      dealerValue: handValue(game.dealerHand),
      payout: 0,
      message: 'Du slog over 21 – bust.',
    });
  }

  res.json({
    playerHand: game.playerHand,
    dealerVisible: [game.dealerHand[0]],
    dealerHidden: true,
    playerValue: playerVal,
    canHit: true,
    canStand: true,
  });
});

router.post('/blackjack/stand', async (req, res) => {
  const userId = req.userId;
  const game = blackjackGames.get(userId);
  if (!game) {
    return res.status(400).json({ error: 'Ingen aktiv hånd. Start en ny.' });
  }

  let dealerHand = game.dealerHand;
  let dealerVal = handValue(dealerHand);
  while (dealerVal < 17) {
    const card = game.deck.pop();
    dealerHand.push(card);
    dealerVal = handValue(dealerHand);
  }

  const playerVal = handValue(game.playerHand);
  blackjackGames.delete(userId);

  let result, payout, message;
  if (dealerVal > 21) {
    result = 'win';
    payout = BLACKJACK_WIN_PAYOUT;
    message = 'Dealer bust – du vandt!';
  } else if (playerVal > dealerVal) {
    result = 'win';
    payout = BLACKJACK_WIN_PAYOUT;
    message = 'Du vandt!';
  } else if (playerVal < dealerVal) {
    result = 'lose';
    payout = 0;
    message = 'Dealer vandt.';
  } else {
    result = 'push';
    payout = BLACKJACK_COST;
    message = 'Uafgjort – push. Indsats tilbage.';
  }

  if (payout > 0) {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO point_transactions (user_id, delta, reason) VALUES ($1, $2, $3)`,
        [userId, payout, 'Blackjack gevinst']
      );
    } finally {
      client.release();
    }
  }

  res.json({
    result,
    playerHand: game.playerHand,
    dealerHand,
    playerValue: playerVal,
    dealerValue: dealerVal,
    payout,
    message,
  });
});

module.exports = router;
