const express = require('express');
const { pool } = require('../db');
const config = require('../config');

const router = express.Router();

function getMaxPossiblePoints() {
  const now = new Date();
  return config.getWeekdaysUpToToday(now.getFullYear(), now.getMonth()) * 45;
}

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

/** Offentligt klasse-dashboard: GET /api/public/class/:name (fx /api/public/class/2b) */
router.get('/:name', async (req, res) => {
  const className = decodeURIComponent(req.params.name || '').trim();
  if (!className) return res.status(400).json({ error: 'Klassenavn mangler' });
  try {
    const classRow = await pool.query('SELECT id, name FROM classes WHERE LOWER(TRIM(name)) = LOWER($1)', [className]);
    if (!classRow.rows.length) return res.status(404).json({ error: 'Klasse ikke fundet' });
    const classId = classRow.rows[0].id;
    const displayClassName = classRow.rows[0].name;

    const maxPossible = getMaxPossiblePoints();
    const studentsRes = await pool.query(
      `SELECT u.id, u.name,
              COALESCE(SUM(c.points), 0)::int AS total_points
       FROM users u
       LEFT JOIN check_ins c ON c.user_id = u.id
         AND c.checked_at >= date_trunc('month', CURRENT_DATE)
         AND c.checked_at < date_trunc('month', CURRENT_DATE) + interval '1 month'
       WHERE u.class_id = $1
       GROUP BY u.id, u.name
       ORDER BY total_points DESC, u.name`,
      [classId]
    );
    const numStudents = studentsRes.rows.length;
    const classTotal = studentsRes.rows.reduce((sum, row) => sum + row.total_points, 0);
    const maxPossibleClass = maxPossible * numStudents;
    const names = studentsRes.rows.map(row => row.name);
    const displayNames = uniqueDisplayNames(names);
    const students = studentsRes.rows.map((row, i) => ({
      rank: i + 1,
      name: displayNames[i],
      totalPoints: row.total_points,
      percentage: maxPossible ? Math.round((row.total_points / maxPossible) * 100) : 0,
    }));

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthStart = new Date(year, month, 1);

    const weekdays = [];
    const d = new Date(monthStart);
    while (d <= now && d.getMonth() === month) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) weekdays.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }

    const checkInsByDate = await pool.query(
      `SELECT check_date, user_id, points FROM check_ins c
       JOIN users u ON u.id = c.user_id AND u.class_id = $1
       WHERE c.check_date >= $2 AND c.check_date <= $3`,
      [classId, monthStart.toISOString().slice(0, 10), now.toISOString().slice(0, 10)]
    );
    const pointsByDate = {};
    const countByDate = {};
    checkInsByDate.rows.forEach(row => {
      const key = row.check_date.toISOString().slice(0, 10);
      pointsByDate[key] = (pointsByDate[key] || 0) + row.points;
      countByDate[key] = (countByDate[key] || 0) + 1;
    });

    let cum = 0;
    const burndownActual = weekdays.map(date => {
      const key = date.toISOString().slice(0, 10);
      cum += pointsByDate[key] || 0;
      return cum;
    });
    const burndownIdeal = weekdays.map((_, i) => 45 * numStudents * (i + 1));
    const burndownLabels = weekdays.map(x => x.getDate() + '. ' + x.toLocaleDateString('da-DK', { month: 'short' }));

    const perfectDays = weekdays
      .filter(date => (countByDate[date.toISOString().slice(0, 10)] || 0) === numStudents)
      .map(date => date.toISOString().slice(0, 10));

    let classStreak = 0;
    const today = new Date();
    let day = new Date(today);
    while (day.getMonth() === month) {
      const key = day.toISOString().slice(0, 10);
      const dow = day.getDay();
      if (dow !== 0 && dow !== 6) {
        if (numStudents > 0 && (countByDate[key] || 0) === numStudents) classStreak++;
        else break;
      }
      day.setDate(day.getDate() - 1);
    }

    res.json({
      classId,
      className: displayClassName,
      numStudents,
      classTotal,
      maxPossibleClass,
      classPercentage: maxPossibleClass ? Math.round((classTotal / maxPossibleClass) * 100) : 0,
      students,
      streak: classStreak,
      perfectDays,
      burndown: { labels: burndownLabels, ideal: burndownIdeal, actual: burndownActual },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

module.exports = router;
