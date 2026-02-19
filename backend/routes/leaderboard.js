const express = require('express');
const { pool } = require('../db');
const config = require('../config');
const { auth } = require('../middleware/auth');

const router = express.Router();

/** Formatér et Date fra DB (DATE er midnat i serverens tidszone) som YYYY-MM-DD uden UTC-forskydning. */
function toDateString(d) {
  if (d == null) return '';
  const date = d instanceof Date ? d : new Date(d);
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const day = date.getDate();
  return y + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

/** GDPR: vis kun fornavn + forbogstav på efternavn; ved duplikater tilføjes ét bogstav mere. */
function uniqueDisplayNames(names) {
  const result = [];
  const used = new Set();
  for (const fullName of names) {
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    const last = parts[parts.length - 1] || '';
    let d = parts.length <= 1 ? (parts[0] || '') : parts[0] + ' ' + (last[0] || '').toUpperCase();
    let n = 1;
    while (used.has(d) && n <= last.length) {
      d = parts[0] + ' ' + last.slice(0, n).toUpperCase();
      n++;
    }
    used.add(d);
    result.push(d);
  }
  return result;
}

function getMaxPossiblePoints() {
  const now = new Date();
  return config.getWeekdaysUpToToday(now.getFullYear(), now.getMonth()) * 45;
}

router.get('/class', auth, async (req, res) => {
  try {
    const classId = req.query.classId != null ? parseInt(req.query.classId, 10) : null;
    const id = classId ?? (await pool.query('SELECT class_id FROM users WHERE id = $1', [req.userId])).rows[0]?.class_id;
    if (!id) {
      return res.status(400).json({ error: 'Klasse ikke fundet' });
    }
    const maxPossible = getMaxPossiblePoints();
    const r = await pool.query(
      `SELECT u.id, u.name,
              COALESCE(ci.total, 0)::int AS checkin_points,
              COALESCE(gm.total, 0)::int AS game_points,
              COALESCE(pt.total, 0)::int AS ledger_points,
              (COALESCE(ci.total, 0) + COALESCE(gm.total, 0) + COALESCE(pt.total, 0))::int AS total_points
       FROM users u
       LEFT JOIN (
         SELECT user_id, SUM(points)::int AS total
         FROM check_ins
         WHERE checked_at >= date_trunc('month', CURRENT_DATE)
           AND checked_at < date_trunc('month', CURRENT_DATE) + interval '1 month'
         GROUP BY user_id
       ) ci ON ci.user_id = u.id
       LEFT JOIN (
         SELECT user_id, SUM(points)::int AS total
         FROM game_completions
         WHERE play_date >= date_trunc('month', CURRENT_DATE)::date
           AND play_date < (date_trunc('month', CURRENT_DATE)::date + interval '1 month')::date
         GROUP BY user_id
       ) gm ON gm.user_id = u.id
       LEFT JOIN (
         SELECT user_id, SUM(delta)::int AS total
         FROM point_transactions
         WHERE created_at >= date_trunc('month', CURRENT_DATE)
           AND created_at < date_trunc('month', CURRENT_DATE) + interval '1 month'
         GROUP BY user_id
       ) pt ON pt.user_id = u.id
       WHERE u.class_id = $1
       GROUP BY u.id, u.name, ci.total, gm.total, pt.total
       ORDER BY total_points DESC, u.name`,
      [id]
    );

    const userIds = r.rows.map((row) => row.id);
    const gamesTodayRes = userIds.length
      ? await pool.query(
          `SELECT user_id, array_agg(game_key ORDER BY game_key) AS games
           FROM game_completions
           WHERE play_date = CURRENT_DATE AND user_id = ANY($1::int[])
           GROUP BY user_id`,
          [userIds]
        )
      : { rows: [] };
    const gamesTodayByUser = {};
    gamesTodayRes.rows.forEach((row) => { gamesTodayByUser[row.user_id] = row.games || []; });

    const classTotal = r.rows.reduce((sum, row) => sum + row.total_points, 0);
    const names = r.rows.map(row => row.name);
    const displayNames = uniqueDisplayNames(names);
    res.json({
      maxPossiblePerUser: maxPossible,
      maxPossibleClass: maxPossible * r.rows.length,
      classTotal,
      classPercentage: r.rows.length ? Math.round((classTotal / (maxPossible * r.rows.length)) * 100) : 0,
      students: r.rows.map((row, i) => ({
        rank: i + 1,
        userId: row.id,
        name: displayNames[i],
        totalPoints: row.total_points,
        gamesToday: gamesTodayByUser[row.id] || [],
        percentage: maxPossible ? Math.round((row.total_points / maxPossible) * 100) : 0,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

router.get('/my-stats', auth, async (req, res) => {
  try {
    const maxPossible = getMaxPossiblePoints();
    const [checkinRes, gameRes, ledgerRes] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(points), 0)::int AS total
         FROM check_ins
         WHERE user_id = $1
           AND checked_at >= date_trunc('month', CURRENT_DATE)
           AND checked_at < date_trunc('month', CURRENT_DATE) + interval '1 month'`,
        [req.userId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(points), 0)::int AS total
         FROM game_completions
         WHERE user_id = $1
           AND play_date >= date_trunc('month', CURRENT_DATE)::date
           AND play_date < (date_trunc('month', CURRENT_DATE)::date + interval '1 month')::date`,
        [req.userId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(delta), 0)::int AS total
         FROM point_transactions
         WHERE user_id = $1
           AND created_at >= date_trunc('month', CURRENT_DATE)
           AND created_at < date_trunc('month', CURRENT_DATE) + interval '1 month'`,
        [req.userId]
      ),
    ]);
    const total = (checkinRes.rows[0].total || 0) + (gameRes.rows[0].total || 0) + (ledgerRes.rows[0].total || 0);
    res.json({
      totalPoints: total,
      maxPossible,
      percentage: maxPossible ? Math.round((total / maxPossible) * 100) : 0,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Burndown: per hverdag i måneden indtil i dag – ideal (45*antal dage) vs faktiske kumulative point */
router.get('/burndown', auth, async (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthStart = new Date(year, month, 1);
    const days = [];
    const d = new Date(monthStart);
    while (d <= now && d.getMonth() === month) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) days.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    const dayLabels = days.map(x => x.getDate() + '. ' + x.toLocaleDateString('da-DK', { month: 'short' }));
    const ideal = days.map((_, i) => 45 * (i + 1));

    const r = await pool.query(
      `SELECT check_date, points FROM check_ins
       WHERE user_id = $1 AND check_date >= $2 AND check_date <= $3
       ORDER BY check_date`,
      [req.userId, toDateString(monthStart), toDateString(now)]
    );
    const pointsByDate = {};
    r.rows.forEach(row => {
      pointsByDate[toDateString(row.check_date)] = row.points;
    });
    let cum = 0;
    const actual = days.map(date => {
      const key = toDateString(date);
      cum += pointsByDate[key] || 0;
      return cum;
    });

    res.json({ labels: dayLabels, ideal, actual });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Seneste indstemplinger (denne måned) */
router.get('/recent', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT check_date, checked_at, points FROM check_ins
       WHERE user_id = $1 AND checked_at >= date_trunc('month', CURRENT_DATE)
       ORDER BY checked_at DESC LIMIT 10`,
      [req.userId]
    );
    res.json(r.rows.map(row => ({
      date: toDateString(row.check_date),
      time: row.checked_at,
      points: row.points,
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Dato i Europe/Copenhagen som YYYY-MM-DD (til streak så "i dag" er dansk dag). */
function getTodayCopenhagenStr() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = f.formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return get('year') + '-' + get('month') + '-' + get('day');
}

/** Streak: antal på hinanden følgende hverdage med indstempling (lørdag/søndag medtages ikke). Nulstilles først når en hverdag mangler. */
router.get('/streak', auth, async (req, res) => {
  try {
    const todayStr = getTodayCopenhagenStr();
    const [y, m] = todayStr.split('-').map(Number);
    const firstStr = String(y) + '-' + String(m).padStart(2, '0') + '-01';

    const r = await pool.query(
      `SELECT to_char(check_date, 'YYYY-MM-DD') AS d FROM check_ins
       WHERE user_id = $1 AND check_date >= $2::date AND check_date <= $3::date
       ORDER BY check_date DESC`,
      [req.userId, firstStr, todayStr]
    );
    const checkedDates = new Set(r.rows.map((row) => row.d));

    let streak = 0;
    let current = todayStr;
    while (current >= firstStr) {
      const utcMidday = new Date(current + 'T12:00:00Z');
      const dow = utcMidday.getUTCDay();
      if (dow !== 0 && dow !== 6) {
        if (checkedDates.has(current)) streak++;
        else break;
      }
      const [yy, mm, dd] = current.split('-').map(Number);
      const prev = new Date(Date.UTC(yy, mm - 1, dd - 1));
      current = prev.getUTCFullYear() + '-' + String(prev.getUTCMonth() + 1).padStart(2, '0') + '-' + String(prev.getUTCDate()).padStart(2, '0');
    }
    res.json({ currentStreak: streak });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Kalender: datoer (YYYY-MM-DD) med indstempling denne måned (til heatmap) */
router.get('/calendar', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT check_date FROM check_ins
       WHERE user_id = $1 AND checked_at >= date_trunc('month', CURRENT_DATE)
         AND checked_at < date_trunc('month', CURRENT_DATE) + interval '1 month'`,
      [req.userId]
    );
    res.json(r.rows.map(row => toDateString(row.check_date)));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

module.exports = router;
