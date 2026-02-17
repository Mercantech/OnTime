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
  {
    name: 'user_badges',
    sql: `
      CREATE TABLE IF NOT EXISTS user_badges (
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        badge_key TEXT NOT NULL,
        earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, badge_key)
      );
    `,
  },
  {
    name: 'game_completions',
    sql: `
      CREATE TABLE IF NOT EXISTS game_completions (
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game_key TEXT NOT NULL,
        play_date DATE NOT NULL,
        points INT NOT NULL DEFAULT 0 CHECK (points >= 0 AND points <= 45),
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, game_key, play_date)
      );
      CREATE INDEX IF NOT EXISTS idx_game_completions_date ON game_completions (play_date);
      CREATE INDEX IF NOT EXISTS idx_game_completions_user ON game_completions (user_id);
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
