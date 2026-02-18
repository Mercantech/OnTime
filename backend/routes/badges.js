const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

const BADGE_DEFS = [
  { key: 'first_checkin', name: 'Første gang', description: 'Din allerførste indstempling' },
  { key: 'streak_3', name: 'Streak 3', description: '3 hverdage i træk med indstempling' },
  { key: 'streak_5', name: 'Streak 5', description: '5 hverdage i træk' },
  { key: 'streak_7', name: 'Seks-syv', description: '7 dages streak – 6-7? Nej, 7! 😏 🥚', secret: true },
  { key: 'streak_10', name: 'Streak 10', description: '10 hverdage i træk' },
  { key: 'perfect_week', name: 'Perfekt uge', description: '5/5 hverdage med 45 point i én uge' },
  { key: 'early_bird', name: 'Tidlig fugl', description: '1 Indstemplinger før kl. 07:15' },
  { key: 'wordle_win', name: 'Wordle', description: 'Vandt Wordle (spillet)' },
  { key: 'flag_win', name: 'Dagens flag', description: 'Gættede dagens flag korrekt' },
  { key: 'before_7', name: 'Før kl. 7', description: 'Kom inden kl. 7 om morgenen 🥚', secret: true },
  { key: 'exactly_8', name: 'Præcis 8', description: 'Stemplet ind præcis kl. 08:00 🥚', secret: true },
  { key: 'month_top', name: 'Månedens mester', description: 'Flest point i klassen denne måned' },
  { key: 'april_20', name: '4/20', description: 'Stemplet ind den 20. april 🌿 🥚', secret: true },
  { key: 'midnight', name: 'Midnat', description: 'Stemplet ind ved midnat 🌙', secret: true },
  { key: 'exactly_1234', name: '12:34', description: 'Stemplet ind kl. 12:34 🥚', secret: true },
  { key: 'date_13', name: '13.', description: 'Stemplet ind en 13. 🍀', secret: true },
  { key: 'pi_day', name: 'π-dag', description: 'Stemplet ind den 14. marts (π-dag) 🥧', secret: true },
  { key: 'agent_007', name: '007', description: 'Stemplet ind kl. 07:07 🕵️', secret: true },
  { key: 'programmer_day', name: '256', description: 'Stemplet ind på programmerens dag (256) 💻', secret: true },
  { key: 'nytaarsdag', name: 'Nytårsdag', description: 'Stemplet ind 1. januar 🎉', secret: true },
  { key: 'syden', name: 'Kl. 11:11', description: 'Stemplet ind kl. 11:11 – ønske dig noget 🪄', secret: true },
  { key: 'hakke_stifter', name: 'Hakke stifter', description: 'Har du været ude og hakke stifter? 🍺', secret: true },
  { key: 'one_armed_bandit', name: 'Enarmet bandit', description: 'Trak i den enarmede på casinoet 🎰', secret: true },
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
    if (streak >= 7 && !earned.has('streak_7')) toAward.push('streak_7');
    if (streak >= 10 && !earned.has('streak_10')) toAward.push('streak_10');

    const before7 = checkIns.some((c) => {
      const t = new Date(c.checked_at);
      return t.getHours() < 7;
    });
    if (before7 && !earned.has('before_7')) toAward.push('before_7');

    const exactly8 = checkIns.some((c) => {
      const t = new Date(c.checked_at);
      return t.getHours() === 8 && t.getMinutes() === 0;
    });
    if (exactly8 && !earned.has('exactly_8')) toAward.push('exactly_8');

    const april20 = checkIns.some((c) => {
      const d = c.check_date instanceof Date ? c.check_date : new Date(c.check_date);
      return d.getMonth() === 3 && d.getDate() === 20;
    });
    if (april20 && !earned.has('april_20')) toAward.push('april_20');

    const midnight = checkIns.some((c) => {
      const t = new Date(c.checked_at);
      return t.getHours() === 0 && t.getMinutes() === 0;
    });
    if (midnight && !earned.has('midnight')) toAward.push('midnight');

    const exactly1234 = checkIns.some((c) => {
      const t = new Date(c.checked_at);
      return t.getHours() === 12 && t.getMinutes() === 34;
    });
    if (exactly1234 && !earned.has('exactly_1234')) toAward.push('exactly_1234');

    const date13 = checkIns.some((c) => {
      const d = c.check_date instanceof Date ? c.check_date : new Date(c.check_date);
      return d.getDate() === 13;
    });
    if (date13 && !earned.has('date_13')) toAward.push('date_13');

    const piDay = checkIns.some((c) => {
      const d = c.check_date instanceof Date ? c.check_date : new Date(c.check_date);
      return d.getMonth() === 2 && d.getDate() === 14;
    });
    if (piDay && !earned.has('pi_day')) toAward.push('pi_day');

    const agent007 = checkIns.some((c) => {
      const t = new Date(c.checked_at);
      return t.getHours() === 7 && t.getMinutes() === 7;
    });
    if (agent007 && !earned.has('agent_007')) toAward.push('agent_007');

    const programmerDay = checkIns.some((c) => {
      const d = c.check_date instanceof Date ? c.check_date : new Date(c.check_date);
      const start = new Date(d.getFullYear(), 0, 0);
      const diff = d - start;
      const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
      return dayOfYear === 256;
    });
    if (programmerDay && !earned.has('programmer_day')) toAward.push('programmer_day');

    const nytaarsdag = checkIns.some((c) => {
      const d = c.check_date instanceof Date ? c.check_date : new Date(c.check_date);
      return d.getMonth() === 0 && d.getDate() === 1;
    });
    if (nytaarsdag && !earned.has('nytaarsdag')) toAward.push('nytaarsdag');

    const syden = checkIns.some((c) => {
      const t = new Date(c.checked_at);
      return t.getHours() === 11 && t.getMinutes() === 11;
    });
    if (syden && !earned.has('syden')) toAward.push('syden');

    const checkDates = new Set(
      checkIns.map((c) => (c.check_date instanceof Date ? c.check_date : new Date(c.check_date)).toISOString().slice(0, 10))
    );
    const hakkeStifter = checkIns.some((c) => {
      const d = c.check_date instanceof Date ? new Date(c.check_date.getTime()) : new Date(c.check_date);
      if (d.getDay() !== 4) return false;
      d.setDate(d.getDate() + 1);
      const friday = d.toISOString().slice(0, 10);
      return !checkDates.has(friday);
    });
    if (hakkeStifter && !earned.has('hakke_stifter')) toAward.push('hakke_stifter');

    const earlyCount = checkIns.filter((c) => {
      const t = new Date(c.checked_at);
      return t.getHours() < 7 || (t.getHours() === 7 && t.getMinutes() < 15);
    }).length;
    if (earlyCount >= 1 && !earned.has('early_bird')) toAward.push('early_bird');

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
      secret: !!b.secret,
    }));

    res.json({ badges: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

module.exports = router;
