const { pool } = require('./db');

async function getDbIpRanges() {
  const r = await pool.query('SELECT range FROM allowed_ip_ranges ORDER BY id');
  return (r.rows || []).map(row => row.range);
}

module.exports = { getDbIpRanges };
