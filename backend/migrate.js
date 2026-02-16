const { pool } = require('./db');

const MIGRATIONS = [
  {
    name: 'add_is_admin',
    sql: `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_admin'
        ) THEN
          ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
        END IF;
      END $$;
    `,
  },
  {
    name: 'check_ins_lat_lng_nullable',
    sql: `
      ALTER TABLE check_ins ALTER COLUMN lat DROP NOT NULL;
      ALTER TABLE check_ins ALTER COLUMN lng DROP NOT NULL;
    `,
  },
  {
    name: 'allowed_ip_ranges',
    sql: `
      CREATE TABLE IF NOT EXISTS allowed_ip_ranges (
        id SERIAL PRIMARY KEY,
        range TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  },
];

async function run() {
  for (const m of MIGRATIONS) {
    try {
      await pool.query(m.sql);
      console.log('Migration ok:', m.name);
    } catch (e) {
      console.error('Migration fejlede:', m.name, e.message);
      throw e;
    }
  }
}

module.exports = { run };
