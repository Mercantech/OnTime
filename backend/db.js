const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Kun SSL mod eksterne tjenester (fx Neon); lokal Docker-Postgres kræver det ikke
  ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false,
});

module.exports = { pool };
