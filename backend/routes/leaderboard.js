const express = require('express');
const { pool } = require('../db');
const config = require('../config');
const { auth } = require('../middleware/auth');

const router = express.Router();

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
              COALESCE(SUM(c.points), 0)::int AS total_points
       FROM users u
       LEFT JOIN check_ins c ON c.user_id = u.id
         AND c.checked_at >= date_trunc('month', CURRENT_DATE)
         AND c.checked_at < date_trunc('month', CURRENT_DATE) + interval '1 month'
       WHERE u.class_id = $1
       GROUP BY u.id, u.name
       ORDER BY total_points DESC, u.name`,
      [id]
    );
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
    const r = await pool.query(
      `SELECT COALESCE(SUM(points), 0)::int AS total
       FROM check_ins
       WHERE user_id = $1
         AND checked_at >= date_trunc('month', CURRENT_DATE)
         AND checked_at < date_trunc('month', CURRENT_DATE) + interval '1 month'`,
      [req.userId]
    );
    const total = r.rows[0].total;
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
      [req.userId, monthStart.toISOString().slice(0, 10), now.toISOString().slice(0, 10)]
    );
    const pointsByDate = {};
    r.rows.forEach(row => {
      pointsByDate[row.check_date.toISOString().slice(0, 10)] = row.points;
    });
    let cum = 0;
    const actual = days.map(date => {
      const key = date.toISOString().slice(0, 10);
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
      date: row.check_date.toISOString().slice(0, 10),
      time: row.checked_at,
      points: row.points,
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

/** Streak: antal på hinanden følgende hverdage med indstempling (lørdag/søndag medtages ikke) */
router.get('/streak', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT check_date FROM check_ins
       WHERE user_id = $1 AND check_date >= date_trunc('month', CURRENT_DATE)::date
         AND check_date <= CURRENT_DATE
       ORDER BY check_date DESC`,
      [req.userId]
    );
    const checkedDates = new Set(r.rows.map(row => row.check_date.toISOString().slice(0, 10)));
    const today = new Date();
    let streak = 0;
    const d = new Date(today);
    while (d.getMonth() === today.getMonth()) {
      const day = d.getDay(); // 0=søn, 6=lør – kun hverdage tæller
      const key = d.toISOString().slice(0, 10);
      if (day !== 0 && day !== 6) {
        if (checkedDates.has(key)) streak++;
        else break;
      }
      d.setDate(d.getDate() - 1);
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
    res.json(r.rows.map(row => row.check_date.toISOString().slice(0, 10)));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

module.exports = router;
