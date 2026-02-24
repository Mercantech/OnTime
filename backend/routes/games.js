const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

/** Deterministik indeks for dagens land ud fra dato (alle får samme land). */
function getDailyCountryIndex(dateStr, totalCountries) {
  const hash = crypto.createHash('sha256').update(dateStr).digest();
  const n = hash.readUInt32BE(0);
  return n % totalCountries;
}

function loadCountries() {
  const fs = require('fs');
  const file = path.join(__dirname, '..', 'data', 'countries.json');
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

/** Normaliser landnavn til sammenligning (lowercase, trim). */
function normalizeCountryName(s) {
  return String(s || '').trim().toLowerCase();
}

/** Returnér dagens land-objekt. */
function getDailyCountry(countries, dateStr) {
  const idx = getDailyCountryIndex(dateStr, countries.length);
  return countries[idx];
}

/** Tjek om gættet matcher et land i listen (engelsk eller dansk navn). */
function guessMatchesCountry(guessNorm, countries) {
  return countries.some((c) => {
    if (normalizeCountryName(c.name) === guessNorm) return true;
    if (c.name_da && normalizeCountryName(c.name_da) === guessNorm) return true;
    return false;
  });
}

/** Returnér det officielle (engelske) navn for et gæt (engelsk eller dansk). */
function guessToCountryName(guessNorm, countries) {
  const c = countries.find((c) => {
    if (normalizeCountryName(c.name) === guessNorm) return true;
    if (c.name_da && normalizeCountryName(c.name_da) === guessNorm) return true;
    return false;
  });
  return c ? c.name : null;
}

/** Normaliser hovedstad til sammenligning (lowercase, trim, fjern diakritik). */
function normalizeCapital(s) {
  const t = String(s || '').trim().toLowerCase();
  return t.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/** Liste over lande til søgebar dropdown (engelsk + dansk navn). */
router.get('/flag/countries', auth, (req, res) => {
  try {
    const countries = loadCountries();
    res.json(countries.map((c) => ({ name: c.name, name_da: c.name_da || c.name })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Liste over hovedstæder til søgebar dropdown (capital + capital_da, som lande). Sorteret efter visningsnavn. */
router.get('/flag/capitals', auth, (req, res) => {
  try {
    const countries = loadCountries();
    const withCapital = countries
      .filter((c) => c.capital)
      .map((c) => ({ capital: c.capital, capital_da: c.capital_da || c.capital, name: c.name }));
    withCapital.sort((a, b) => (a.capital_da || a.capital || '').localeCompare(b.capital_da || b.capital || '', 'da'));
    res.json(withCapital);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Hent dagens flag (kun flag-URL og kode, ikke landets navn). */
router.get('/daily-flag', auth, async (req, res) => {
  try {
    const countries = loadCountries();
    if (!countries.length) return res.status(500).json({ error: 'Ingen lande' });

    const today = new Date().toISOString().slice(0, 10);
    const c = getDailyCountry(countries, today);
    const flagUrl = `https://flagcdn.com/w320/${c.code}.png`;
    res.json({ flagUrl, countryCode: c.code });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Hent state for dagens flag (vundet land, vundet hovedstad, forsøg). */
router.get('/flag/status', auth, async (req, res) => {
  try {
    const userId = req.userId;
    const today = new Date().toISOString().slice(0, 10);
    const countries = loadCountries();
    const daily = getDailyCountry(countries, today);

    const winRow = await pool.query(
      'SELECT 1 FROM game_completions WHERE user_id = $1 AND game_key = $2 AND play_date = $3',
      [userId, 'flag', today]
    );
    const won = winRow.rows.length > 0;

    const capitalWinRow = await pool.query(
      'SELECT 1 FROM game_completions WHERE user_id = $1 AND game_key = $2 AND play_date = $3',
      [userId, 'flag_capital', today]
    );
    const wonCapital = capitalWinRow.rows.length > 0;

    const attemptRow = await pool.query(
      'SELECT attempts FROM flag_daily_attempts WHERE user_id = $1 AND play_date = $2',
      [userId, today]
    );
    const attemptsUsed = attemptRow.rows[0] ? Math.min(attemptRow.rows[0].attempts, 3) : 0;
    const attemptsLeft = Math.max(0, 3 - attemptsUsed);
    const lost = !won && attemptsUsed >= 3;

    const capitalAttemptRow = await pool.query(
      'SELECT attempts FROM flag_capital_daily_attempts WHERE user_id = $1 AND play_date = $2',
      [userId, today]
    );
    const capitalAttemptsUsed = capitalAttemptRow.rows[0] ? Math.min(capitalAttemptRow.rows[0].attempts, 3) : 0;
    const capitalAttemptsLeft = Math.max(0, 3 - capitalAttemptsUsed);
    const capitalLost = !wonCapital && won && capitalAttemptsUsed >= 3;

    const hasCapitalStep = !!daily.capital;

    res.json({
      won,
      lost,
      attemptsUsed,
      attemptsLeft,
      countryName: (won || lost) ? daily.name : undefined,
      wonCapital,
      capitalLost,
      capitalAttemptsUsed,
      capitalAttemptsLeft,
      hasCapitalStep,
      countryNameForCapital: won && hasCapitalStep ? daily.name : undefined,
      capitalNameRevealed: (won && hasCapitalStep && (wonCapital || capitalLost)) ? (daily.capital_da || daily.capital) : undefined,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Gæt dagens flag. Max 3 forsøg. Gættet skal matche et land i countries.json. */
router.post('/flag/guess', auth, async (req, res) => {
  try {
    const userId = req.userId;
    const guess = String(req.body.guess || '').trim();
    const guessNorm = normalizeCountryName(guess);
    if (!guessNorm) return res.status(400).json({ error: 'Angiv et gæt' });

    const countries = loadCountries();
    const today = new Date().toISOString().slice(0, 10);
    const daily = getDailyCountry(countries, today);

    // Allerede vundet i dag?
    const winRow = await pool.query(
      'SELECT 1 FROM game_completions WHERE user_id = $1 AND game_key = $2 AND play_date = $3',
      [userId, 'flag', today]
    );
    if (winRow.rows.length > 0) {
      return res.json({ correct: true, countryName: daily.name, pointsAwarded: 2, alreadyWon: true });
    }

    // Gættet skal være et land fra listen
    if (!guessMatchesCountry(guessNorm, countries)) {
      return res.json({ correct: false, invalidGuess: true, message: 'Det er ikke et land fra listen. Vælg eller skriv et land fra listen (dansk eller engelsk).' });
    }

    // Hent nuværende forsøg
    const attemptRow = await pool.query(
      'SELECT attempts FROM flag_daily_attempts WHERE user_id = $1 AND play_date = $2',
      [userId, today]
    );
    let attempts = attemptRow.rows[0] ? attemptRow.rows[0].attempts : 0;
    if (attempts >= 3) {
      return res.json({
        correct: false,
        attemptsLeft: 0,
        noMoreAttempts: true,
        countryName: daily.name,
      });
    }

    const matchedName = guessToCountryName(guessNorm, countries);
    if (matchedName && matchedName === daily.name) {
      const now = new Date();
      await pool.query(
        `INSERT INTO game_completions (user_id, game_key, play_date, points, completed_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, game_key, play_date) DO UPDATE SET
           points = EXCLUDED.points,
           completed_at = EXCLUDED.completed_at`,
        [userId, 'flag', today, 2, now]
      );
      await pool.query(
        'INSERT INTO user_badges (user_id, badge_key) VALUES ($1, $2) ON CONFLICT (user_id, badge_key) DO NOTHING',
        [userId, 'flag_win']
      );
      return res.json({ correct: true, countryName: daily.name, pointsAwarded: 2 });
    }

    attempts += 1;
    await pool.query(
      `INSERT INTO flag_daily_attempts (user_id, play_date, attempts) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, play_date) DO UPDATE SET attempts = EXCLUDED.attempts`,
      [userId, today, attempts]
    );
    const attemptsLeft = 3 - attempts;
    const noMoreAttempts = attempts >= 3;
    res.json({
      correct: false,
      attemptsLeft,
      noMoreAttempts: noMoreAttempts,
      countryName: noMoreAttempts ? daily.name : undefined,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Tjek om gættet matcher en hovedstad i listen (capital eller capital_da, normaliseret). */
function guessMatchesCapital(guessNorm, countries) {
  return countries.some((c) => {
    if (!c.capital) return false;
    if (normalizeCapital(c.capital) === guessNorm) return true;
    if (c.capital_da && normalizeCapital(c.capital_da) === guessNorm) return true;
    return false;
  });
}

/** Gæt dagens hovedstad (kun når land er gættet, max 3 forsøg). +1 point for rigtig hovedstad. */
router.post('/flag/capital/guess', auth, async (req, res) => {
  try {
    const userId = req.userId;
    const guess = String(req.body.guess || '').trim();
    const guessNorm = normalizeCapital(guess);
    if (!guessNorm) return res.status(400).json({ error: 'Angiv et gæt' });

    const countries = loadCountries();
    const today = new Date().toISOString().slice(0, 10);
    const daily = getDailyCountry(countries, today);

    const winCountryRow = await pool.query(
      'SELECT 1 FROM game_completions WHERE user_id = $1 AND game_key = $2 AND play_date = $3',
      [userId, 'flag', today]
    );
    if (winCountryRow.rows.length === 0) {
      return res.status(400).json({ error: 'Gæt først landet rigtigt' });
    }
    if (!daily.capital) {
      return res.status(400).json({ error: 'Dagens land har ikke registreret hovedstad' });
    }

    const capitalWinRow = await pool.query(
      'SELECT 1 FROM game_completions WHERE user_id = $1 AND game_key = $2 AND play_date = $3',
      [userId, 'flag_capital', today]
    );
    if (capitalWinRow.rows.length > 0) {
      return res.json({
        correct: true,
        capitalName: daily.capital_da || daily.capital,
        pointsAwarded: 1,
        alreadyWon: true,
      });
    }

    if (!guessMatchesCapital(guessNorm, countries)) {
      return res.json({
        correct: false,
        invalidGuess: true,
        message: 'Det er ikke en hovedstad fra listen. Vælg eller skriv en hovedstad fra listen (dansk eller engelsk).',
      });
    }

    const attemptRow = await pool.query(
      'SELECT attempts FROM flag_capital_daily_attempts WHERE user_id = $1 AND play_date = $2',
      [userId, today]
    );
    let attempts = attemptRow.rows[0] ? attemptRow.rows[0].attempts : 0;
    if (attempts >= 3) {
      return res.json({
        correct: false,
        attemptsLeft: 0,
        noMoreAttempts: true,
        capitalName: daily.capital_da || daily.capital,
      });
    }

    const capitalMatch =
      normalizeCapital(daily.capital) === guessNorm ||
      (daily.capital_da && normalizeCapital(daily.capital_da) === guessNorm);
    if (capitalMatch) {
      const now = new Date();
      await pool.query(
        `INSERT INTO game_completions (user_id, game_key, play_date, points, completed_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, game_key, play_date) DO UPDATE SET
           points = EXCLUDED.points,
           completed_at = EXCLUDED.completed_at`,
        [userId, 'flag_capital', today, 1, now]
      );
      return res.json({
        correct: true,
        capitalName: daily.capital_da || daily.capital,
        pointsAwarded: 1,
      });
    }

    attempts += 1;
    await pool.query(
      `INSERT INTO flag_capital_daily_attempts (user_id, play_date, attempts) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, play_date) DO UPDATE SET attempts = EXCLUDED.attempts`,
      [userId, today, attempts]
    );
    const attemptsLeft = 3 - attempts;
    const noMoreAttempts = attempts >= 3;
    res.json({
      correct: false,
      attemptsLeft,
      noMoreAttempts,
      capitalName: noMoreAttempts ? (daily.capital_da || daily.capital) : undefined,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

router.use(auth);

const COINFLIP_COST = 1;
const COINFLIP_WIN_PAYOUT = 2;
const COINFLIP_POINTS_RECORDED = 1; // point registreret i game_completions (viser på leaderboard)

function monthWindowSql(field) {
  return `${field} >= date_trunc('month', CURRENT_DATE) AND ${field} < date_trunc('month', CURRENT_DATE) + interval '1 month'`;
}

async function getUserMonthPointsTotal(client, userId) {
  const r = await client.query(
    `SELECT (
      COALESCE((SELECT SUM(points)::int FROM check_ins WHERE user_id = $1 AND ${monthWindowSql('checked_at')}), 0)
      + COALESCE((SELECT SUM(points)::int FROM game_completions WHERE user_id = $1 AND play_date >= date_trunc('month', CURRENT_DATE)::date AND play_date < (date_trunc('month', CURRENT_DATE)::date + interval '1 month')::date), 0)
      + COALESCE((SELECT SUM(delta)::int FROM point_transactions WHERE user_id = $1 AND ${monthWindowSql('created_at')}), 0)
    )::int AS total_points`,
    [userId]
  );
  return r.rows[0]?.total_points ?? 0;
}

const COINFLIP_MAX_FLIPS_PER_DAY = 100;

/** Dato i Europe/Copenhagen som YYYY-MM-DD (så "i dag" matcher brugerens dag). */
function getTodayCopenhagenStr() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = f.formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return get('year') + '-' + get('month') + '-' + get('day');
}

async function getFlipCountToday(client, userId) {
  const todayStr = getTodayCopenhagenStr();
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM point_transactions
     WHERE user_id = $1 AND reason = 'Coinflip' AND delta = $2
       AND (created_at AT TIME ZONE 'Europe/Copenhagen')::date = $3::date`,
    [userId, -COINFLIP_COST, todayStr]
  );
  return r.rows[0]?.n ?? 0;
}

/** Coinflip status: saldo, hvor mange flips i dag, om der er flips tilbage (max 100/dag). */
router.get('/coinflip/status', async (req, res) => {
  try {
    const userId = req.userId;
    const client = await pool.connect();
    try {
      const [balance, flipCountToday] = await Promise.all([
        getUserMonthPointsTotal(client, userId),
        getFlipCountToday(client, userId),
      ]);
      const flipsRemaining = Math.max(0, COINFLIP_MAX_FLIPS_PER_DAY - flipCountToday);
      const canFlip = balance >= COINFLIP_COST && flipsRemaining > 0;
      res.json({
        balance,
        canFlip,
        flipsUsedToday: flipCountToday,
        flipsRemainingToday: flipsRemaining,
        maxFlipsPerDay: COINFLIP_MAX_FLIPS_PER_DAY,
        cost: COINFLIP_COST,
      });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Coinflip: 1 point per flip, max 100 flips/dag. 50% vinder 2 point. */
router.post('/coinflip/flip', async (req, res) => {
  const userId = req.userId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const [balance, flipCountToday] = await Promise.all([
      getUserMonthPointsTotal(client, userId),
      getFlipCountToday(client, userId),
    ]);

    if (flipCountToday >= COINFLIP_MAX_FLIPS_PER_DAY) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Du har brugt alle ' + COINFLIP_MAX_FLIPS_PER_DAY + ' flips i dag. Kom tilbage i morgen!' });
    }
    if (balance < COINFLIP_COST) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Du har ikke nok point (skal bruge 1 point).' });
    }

    await client.query(
      `INSERT INTO point_transactions (user_id, delta, reason) VALUES ($1, $2, $3)`,
      [userId, -COINFLIP_COST, 'Coinflip']
    );

    const win = Math.random() < 0.5;
    if (win) {
      await client.query(
        `INSERT INTO point_transactions (user_id, delta, reason) VALUES ($1, $2, $3)`,
        [userId, COINFLIP_WIN_PAYOUT, 'Coinflip gevinst']
      );
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      await client.query(
        `INSERT INTO game_completions (user_id, game_key, play_date, points, completed_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, game_key, play_date) DO UPDATE SET points = EXCLUDED.points, completed_at = EXCLUDED.completed_at`,
        [userId, 'coinflip', today, COINFLIP_POINTS_RECORDED, now]
      );
    }

    await client.query('COMMIT');
    res.json({ win, payout: win ? COINFLIP_WIN_PAYOUT : 0 });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  } finally {
    client.release();
  }
});

/** Marker at brugeren har vundet Wordle (giver badge én gang). */
router.post('/wordle/win', async (req, res) => {
  try {
    const userId = req.userId;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    // 2 point pr. dag man gennemfører Wordle
    await pool.query(
      `INSERT INTO game_completions (user_id, game_key, play_date, points, completed_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, game_key, play_date) DO UPDATE SET
         points = EXCLUDED.points,
         completed_at = EXCLUDED.completed_at`,
      [userId, 'wordle', today, 2, now]
    );

    // Badge for at have vundet Wordle (mindst én gang)
    await pool.query(
      'INSERT INTO user_badges (user_id, badge_key) VALUES ($1, $2) ON CONFLICT (user_id, badge_key) DO NOTHING',
      [userId, 'wordle_win']
    );
    res.json({ ok: true, pointsAwarded: 2 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

// ---------- Sudoku (dagligt 6×6, samme for alle, leaderboard på tid) ----------
const SUDOKU_SIZE = 36;
const SUDOKU_MAX_NUM = 6;

/** 2×3-boks indeks 0–5 for 6×6 (3 rækker af bokse × 2 kolonner: række 0-1 kol 0-2 = 0, 0-1 kol 3-5 = 1, osv.). */
function sudokuBoxIndex(i) {
  const row = Math.floor(i / 6);
  const col = i % 6;
  return Math.floor(row / 2) * 2 + Math.floor(col / 3);
}

/** Tjek at solution er en gyldig 6×6 Sudoku (1-6 i hver række, kolonne og 2×3-boks). */
function isValidSudokuSolution(grid) {
  if (!Array.isArray(grid) || grid.length !== SUDOKU_SIZE) return false;
  const rows = [new Set(), new Set(), new Set(), new Set(), new Set(), new Set()];
  const cols = [new Set(), new Set(), new Set(), new Set(), new Set(), new Set()];
  const boxes = [new Set(), new Set(), new Set(), new Set(), new Set(), new Set()];
  for (let i = 0; i < SUDOKU_SIZE; i++) {
    const v = Number(grid[i]);
    if (!Number.isInteger(v) || v < 1 || v > SUDOKU_MAX_NUM) return false;
    const r = Math.floor(i / 6);
    const c = i % 6;
    const b = sudokuBoxIndex(i);
    if (rows[r].has(v) || cols[c].has(v) || boxes[b].has(v)) return false;
    rows[r].add(v);
    cols[c].add(v);
    boxes[b].add(v);
  }
  return true;
}

/** Tjek at given kun har 0 eller solution-værdi (ingen konflikter fra start). */
function isValidSudokuGiven(given, solution) {
  if (!Array.isArray(given) || given.length !== SUDOKU_SIZE || !Array.isArray(solution)) return false;
  for (let i = 0; i < SUDOKU_SIZE; i++) {
    const g = Number(given[i]);
    if (g !== 0 && g !== solution[i]) return false;
  }
  return true;
}

function loadSudokuPuzzles() {
  const fs = require('fs');
  const candidates = [
    path.join(__dirname, '..', 'data', 'sudoku-puzzles.json'),
    path.join(process.cwd(), 'data', 'sudoku-puzzles.json'),
    path.join(process.cwd(), 'backend', 'data', 'sudoku-puzzles.json'),
  ];
  let raw = null;
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      raw = fs.readFileSync(file, 'utf8');
      break;
    }
  }
  if (!raw) throw new Error('Sudoku-fil ikke fundet (søgte: ' + candidates[0] + ')');
  const puzzles = JSON.parse(raw);
  if (!Array.isArray(puzzles) || !puzzles.length) throw new Error('Sudoku-fil indeholder ingen opgaver');
  for (let idx = 0; idx < puzzles.length; idx++) {
    const p = puzzles[idx];
    if (!p || !Array.isArray(p.solution) || p.solution.length !== SUDOKU_SIZE) {
      throw new Error('Sudoku-puzzle ' + idx + ': ugyldig solution (skal have 36 tal)');
    }
    if (!isValidSudokuSolution(p.solution)) {
      throw new Error('Sudoku-puzzle ' + idx + ': ugyldig solution (skal følge 6×6-reglerne)');
    }
    if (!Array.isArray(p.given) || p.given.length !== SUDOKU_SIZE) {
      throw new Error('Sudoku-puzzle ' + idx + ': given skal have 36 tal');
    }
    if (!isValidSudokuGiven(p.given, p.solution)) {
      throw new Error('Sudoku-puzzle ' + idx + ': given matcher ikke solution (alle opgavetal skal være 0 eller løsningens værdi)');
    }
  }
  return puzzles;
}

/** Deterministik indeks for dagens Sudoku ud fra dato. */
function getDailySudokuIndex(dateStr, totalPuzzles) {
  const hash = crypto.createHash('sha256').update(dateStr).digest();
  const n = hash.readUInt32BE(0);
  return n % totalPuzzles;
}

/** Hent dagens Sudoku-opgave (kun given, aldrig solution). */
router.get('/sudoku/puzzle', auth, (req, res) => {
  try {
    const puzzles = loadSudokuPuzzles();
    const today = new Date().toISOString().slice(0, 10);
    const idx = getDailySudokuIndex(today, puzzles.length);
    const puzzle = puzzles[idx];
    if (!puzzle || !Array.isArray(puzzle.given) || puzzle.given.length !== SUDOKU_SIZE) {
      return res.status(500).json({ error: 'Ugyldig opgave' });
    }
    res.json({ given: puzzle.given, date: today });
  } catch (e) {
    console.error('Sudoku puzzle load error:', e.message);
    res.status(500).json({ error: e.message || 'Serverfejl' });
  }
});

/** Status for dagens Sudoku (allerede løst, tid, evt. rang). */
router.get('/sudoku/status', auth, async (req, res) => {
  try {
    const userId = req.userId;
    const today = new Date().toISOString().slice(0, 10);
    const r = await pool.query(
      `SELECT points, time_seconds, completed_at FROM game_completions
       WHERE user_id = $1 AND game_key = $2 AND play_date = $3`,
      [userId, 'sudoku', today]
    );
    const row = r.rows[0];
    if (!row) {
      return res.json({ completed: false });
    }
    res.json({
      completed: true,
      timeSeconds: row.time_seconds ?? null,
      completedAt: row.completed_at,
      pointsAwarded: row.points ?? 2,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Valider at grid matcher dagens løsning (1-6, 36 tal for 6×6). */
function validateSudokuGrid(grid, solution) {
  if (!Array.isArray(grid) || grid.length !== SUDOKU_SIZE || !Array.isArray(solution) || solution.length !== SUDOKU_SIZE) return false;
  for (let i = 0; i < SUDOKU_SIZE; i++) {
    const g = Number(grid[i]);
    if (!Number.isInteger(g) || g < 1 || g > SUDOKU_MAX_NUM) return false;
    if (g !== solution[i]) return false;
  }
  return true;
}

function sudokuCellStates(grid, solution) {
  if (!Array.isArray(grid) || grid.length !== SUDOKU_SIZE || !Array.isArray(solution) || solution.length !== SUDOKU_SIZE) return null;
  const states = new Array(SUDOKU_SIZE);
  let correctCount = 0;
  let wrongCount = 0;
  for (let i = 0; i < SUDOKU_SIZE; i++) {
    const g = Number(grid[i]);
    const valid = Number.isInteger(g) && g >= 1 && g <= SUDOKU_MAX_NUM;
    const isCorrect = valid && g === solution[i];
    if (isCorrect) {
      states[i] = 'correct';
      correctCount++;
    } else {
      states[i] = valid ? 'wrong' : 'invalid';
      wrongCount++;
    }
  }
  return { states, correctCount, wrongCount };
}

/** Indsend løsning og registrér tid. */
router.post('/sudoku/complete', auth, async (req, res) => {
  try {
    const userId = req.userId;
    const grid = req.body.grid;
    const timeSeconds = typeof req.body.timeSeconds === 'number' ? Math.max(0, Math.floor(req.body.timeSeconds)) : null;
    if (timeSeconds == null) return res.status(400).json({ error: 'Angiv timeSeconds' });

    const puzzles = loadSudokuPuzzles();
    const today = new Date().toISOString().slice(0, 10);
    const idx = getDailySudokuIndex(today, puzzles.length);
    const puzzle = puzzles[idx];
    if (!puzzle || !Array.isArray(puzzle.solution)) return res.status(400).json({ error: 'Kunne ikke finde dagens opgave' });

    if (!validateSudokuGrid(grid, puzzle.solution)) {
      const cell = sudokuCellStates(grid, puzzle.solution);
      return res.status(400).json({
        error: 'Løsningen er ikke korrekt. Tjek de markerede felter.',
        ...(cell ? { cellStates: cell.states, correctCount: cell.correctCount, wrongCount: cell.wrongCount } : {}),
      });
    }

    const now = new Date();
    await pool.query(
      `INSERT INTO game_completions (user_id, game_key, play_date, points, completed_at, time_seconds)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, game_key, play_date) DO UPDATE SET
         points = EXCLUDED.points,
         completed_at = EXCLUDED.completed_at,
         time_seconds = EXCLUDED.time_seconds`,
      [userId, 'sudoku', today, 2, now, timeSeconds]
    );
    await pool.query(
      'INSERT INTO user_badges (user_id, badge_key) VALUES ($1, $2) ON CONFLICT (user_id, badge_key) DO NOTHING',
      [userId, 'sudoku_win']
    );
    res.json({ ok: true, pointsAwarded: 2, timeSeconds });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

module.exports = router;

