const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.use(auth);

/** Marker at brugeren har vundet Wordle (giver badge én gang). */
router.post('/wordle/win', async (req, res) => {
  try {
    const userId = req.userId;
    await pool.query(
      'INSERT INTO user_badges (user_id, badge_key) VALUES ($1, $2) ON CONFLICT (user_id, badge_key) DO NOTHING',
      [userId, 'wordle_win']
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

module.exports = router;

