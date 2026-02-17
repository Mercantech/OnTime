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

/** Tjek om gættet matcher et land i listen (præcist navn fra JSON). */
function guessMatchesCountry(guessNorm, countries) {
  return countries.some((c) => normalizeCountryName(c.name) === guessNorm);
}

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

/** Hent state for dagens flag (vundet, tabt, forsøg brugt). */
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

    const attemptRow = await pool.query(
      'SELECT attempts FROM flag_daily_attempts WHERE user_id = $1 AND play_date = $2',
      [userId, today]
    );
    const attemptsUsed = attemptRow.rows[0] ? Math.min(attemptRow.rows[0].attempts, 3) : 0;
    const attemptsLeft = Math.max(0, 3 - attemptsUsed);
    const lost = !won && attemptsUsed >= 3;

    res.json({
      won,
      lost,
      attemptsUsed,
      attemptsLeft,
      countryName: (won || lost) ? daily.name : undefined,
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
    const expectedName = normalizeCountryName(daily.name);

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
      return res.json({ correct: false, invalidGuess: true, message: 'Det er ikke et land fra listen. Prøv med det officielle engelske navn (f.eks. Denmark, Germany).' });
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

    if (guessNorm === expectedName) {
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

router.use(auth);

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

module.exports = router;

