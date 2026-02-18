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
  {
    name: 'flag_daily_attempts',
    sql: `
      CREATE TABLE IF NOT EXISTS flag_daily_attempts (
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        play_date DATE NOT NULL,
        attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 3),
        PRIMARY KEY (user_id, play_date)
      );
    `,
  },
  {
    name: 'bets_core_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS bets (
        id SERIAL PRIMARY KEY,
        class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked', 'resolved', 'refunded')),
        created_by INT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        locked_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ,
        refunded_at TIMESTAMPTZ,
        winner_option_id INT
      );
      CREATE INDEX IF NOT EXISTS idx_bets_class_status ON bets (class_id, status);

      CREATE TABLE IF NOT EXISTS bet_options (
        id SERIAL PRIMARY KEY,
        bet_id INT NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        sort_order INT NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_bet_options_bet ON bet_options (bet_id, sort_order, id);

      CREATE TABLE IF NOT EXISTS bet_wagers (
        id SERIAL PRIMARY KEY,
        bet_id INT NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        option_id INT NOT NULL REFERENCES bet_options(id) ON DELETE CASCADE,
        points INT NOT NULL CHECK (points > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (bet_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_bet_wagers_bet ON bet_wagers (bet_id);
      CREATE INDEX IF NOT EXISTS idx_bet_wagers_user ON bet_wagers (user_id);

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.table_constraints
          WHERE table_schema = 'public'
            AND table_name = 'bets'
            AND constraint_name = 'bets_winner_option_id_fkey'
        ) THEN
          ALTER TABLE bets
            ADD CONSTRAINT bets_winner_option_id_fkey
            FOREIGN KEY (winner_option_id) REFERENCES bet_options(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `,
  },
  {
    name: 'point_transactions_ledger',
    sql: `
      CREATE TABLE IF NOT EXISTS point_transactions (
        id BIGSERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        delta INT NOT NULL,
        reason TEXT NOT NULL,
        bet_id INT REFERENCES bets(id) ON DELETE SET NULL,
        wager_id INT REFERENCES bet_wagers(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_point_transactions_user ON point_transactions (user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_point_transactions_bet ON point_transactions (bet_id);
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
