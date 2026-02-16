const express = require('express');
const { pool } = require('../db');
const config = require('../config');
const { auth } = require('../middleware/auth');

const router = express.Router();

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
    res.json({
      maxPossiblePerUser: maxPossible,
      maxPossibleClass: maxPossible * r.rows.length,
      classTotal,
      classPercentage: r.rows.length ? Math.round((classTotal / (maxPossible * r.rows.length)) * 100) : 0,
      students: r.rows.map((row, i) => ({
        rank: i + 1,
        userId: row.id,
        name: row.name,
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

module.exports = router;
