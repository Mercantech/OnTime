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

/** Hent dagens flag (kun flag-URL og kode, ikke landets navn). */
router.get('/daily-flag', auth, async (req, res) => {
  try {
    const fs = require('fs');
    const file = path.join(__dirname, '..', 'data', 'countries.json');
    const raw = fs.readFileSync(file, 'utf8');
    const countries = JSON.parse(raw);
    if (!countries.length) return res.status(500).json({ error: 'Ingen lande' });

    const today = new Date().toISOString().slice(0, 10);
    const idx = getDailyCountryIndex(today, countries.length);
    const c = countries[idx];
    const flagUrl = `https://flagcdn.com/w320/${c.code}.png`;
    res.json({ flagUrl, countryCode: c.code });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Gæt dagens flag. Ved korrekt: gem completion + badge og returnér navn. */
router.post('/flag/guess', auth, async (req, res) => {
  try {
    const userId = req.userId;
    const guess = String(req.body.guess || '').trim().toLowerCase();
    if (!guess) return res.status(400).json({ error: 'Angiv et gæt' });

    const fs = require('fs');
    const file = path.join(__dirname, '..', 'data', 'countries.json');
    const raw = fs.readFileSync(file, 'utf8');
    const countries = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    const idx = getDailyCountryIndex(today, countries.length);
    const daily = countries[idx];
    const expectedName = (daily.name || '').trim().toLowerCase();

    if (guess !== expectedName) {
      return res.json({ correct: false });
    }

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
    res.json({ correct: true, countryName: daily.name, pointsAwarded: 2 });
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

