const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

const BADGE_DEFS = [
  { key: 'first_checkin', name: 'Første gang', description: 'Din allerførste indstempling' },
  { key: 'streak_3', name: 'Streak 3', description: '3 hverdage i træk med indstempling' },
  { key: 'streak_5', name: 'Streak 5', description: '5 hverdage i træk' },
  { key: 'streak_10', name: 'Streak 10', description: '10 hverdage i træk' },
  { key: 'perfect_week', name: 'Perfekt uge', description: '5/5 hverdage med 45 point i én uge' },
  { key: 'early_bird', name: 'Tidlig fugl', description: '5 indstemplinger før kl. 08:15' },
  { key: 'month_top', name: 'Månedens mester', description: 'Flest point i klassen denne måned' },
];

/** Returnerer brugerens badges; beregner og gemmer nye præstationer. */
router.get('/me', auth, async (req, res) => {
  try {
    const userId = req.userId;

    const [existingRows, checkInsRows, classLeaderboard] = await Promise.all([
      pool.query('SELECT badge_key, earned_at FROM user_badges WHERE user_id = $1', [userId]),
      pool.query(
        `SELECT check_date, checked_at, points FROM check_ins WHERE user_id = $1 ORDER BY checked_at`,
        [userId]
      ),
      pool.query(
        `SELECT u.id, COALESCE(SUM(c.points), 0)::int AS total
         FROM users u
         LEFT JOIN check_ins c ON c.user_id = u.id
           AND c.checked_at >= date_trunc('month', CURRENT_DATE)
           AND c.checked_at < date_trunc('month', CURRENT_DATE) + interval '1 month'
         WHERE u.class_id = (SELECT class_id FROM users WHERE id = $1)
         GROUP BY u.id ORDER BY total DESC`,
        [userId]
      ),
    ]);

    const earned = new Map(existingRows.rows.map((r) => [r.badge_key, r.earned_at.toISOString().slice(0, 10)]));
    const checkIns = checkInsRows.rows;
    const toAward = [];

    if (checkIns.length >= 1 && !earned.has('first_checkin')) toAward.push('first_checkin');

    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthDates = new Set(
      checkIns
        .filter((c) => c.check_date >= monthStart && c.check_date <= today)
        .map((c) => c.check_date.toISOString().slice(0, 10))
    );
    let streak = 0;
    const d = new Date(today);
    while (d.getMonth() === today.getMonth()) {
      const key = d.toISOString().slice(0, 10);
      const day = d.getDay();
      if (day !== 0 && day !== 6) {
        if (monthDates.has(key)) streak++;
        else break;
      }
      d.setDate(d.getDate() - 1);
    }
    if (streak >= 3 && !earned.has('streak_3')) toAward.push('streak_3');
    if (streak >= 5 && !earned.has('streak_5')) toAward.push('streak_5');
    if (streak >= 10 && !earned.has('streak_10')) toAward.push('streak_10');

    const earlyCount = checkIns.filter((c) => {
      const t = new Date(c.checked_at);
      return t.getHours() < 8 || (t.getHours() === 8 && t.getMinutes() < 15);
    }).length;
    if (earlyCount >= 5 && !earned.has('early_bird')) toAward.push('early_bird');

    const byWeek = new Map();
    checkIns.forEach((c) => {
      const d = new Date(c.check_date);
      const mon = new Date(d);
      mon.setDate(d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1));
      const key = mon.toISOString().slice(0, 10);
      if (!byWeek.has(key)) byWeek.set(key, []);
      byWeek.get(key).push({ date: (c.check_date instanceof Date ? c.check_date : new Date(c.check_date)).toISOString().slice(0, 10), points: c.points });
    });
    let hasPerfectWeek = false;
    for (const [, days] of byWeek) {
      const weekdays45 = new Set();
      days.forEach((x) => {
        const dd = new Date(x.date + 'T12:00:00');
        const dow = dd.getDay();
        if (dow !== 0 && dow !== 6 && x.points === 45) weekdays45.add(x.date);
      });
      if (weekdays45.size >= 5) hasPerfectWeek = true;
    }
    if (hasPerfectWeek && !earned.has('perfect_week')) toAward.push('perfect_week');

    const rank1UserId = classLeaderboard.rows[0]?.id;
    if (rank1UserId === parseInt(userId, 10) && !earned.has('month_top')) toAward.push('month_top');

    for (const key of toAward) {
      await pool.query(
        'INSERT INTO user_badges (user_id, badge_key) VALUES ($1, $2) ON CONFLICT (user_id, badge_key) DO NOTHING',
        [userId, key]
      );
      earned.set(key, new Date().toISOString().slice(0, 10));
    }

    const list = BADGE_DEFS.map((b) => ({
      key: b.key,
      name: b.name,
      description: b.description,
      earnedAt: earned.get(b.key) || null,
    }));

    res.json({ badges: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

module.exports = router;
