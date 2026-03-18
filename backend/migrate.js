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
    name: 'wordle_tables',
    sql: `
      -- Wordle dagsord (persistes pr. dato)
      CREATE TABLE IF NOT EXISTS wordle_word_bank (
        word TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (char_length(word) = 5 AND word ~ '^[a-zæøå]{5}$')
      );

      CREATE TABLE IF NOT EXISTS wordle_daily_answers (
        play_date DATE PRIMARY KEY,
        word TEXT NOT NULL REFERENCES wordle_word_bank(word),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_wordle_daily_answers_word ON wordle_daily_answers (word);

      -- Seed ord (hidtidige 30 dage fra frontend/wordle-answers-30d.json)
      INSERT INTO wordle_word_bank (word) VALUES
        ('skole'),
        ('lærer'),
        ('bøger'),
        ('viden'),
        ('spørg'),
        ('sprog'),
        ('regne'),
        ('noter'),
        ('tavle'),
        ('prøve'),
        ('læser'),
        ('kloge'),
        ('tanke'),
        ('logik'),
        ('fokus'),
        ('lærte'),
        ('tælle'),
        ('fejle'),
        ('ønske'),
        ('vaner'),
        ('start'),
        ('pause'),
        ('tempo'),
        ('smart'),
        ('skarp'),
        ('modig'),
        ('rolig'),
        ('stolt'),
        ('flere'),
        ('håber')
      ON CONFLICT (word) DO NOTHING;

      -- Nye ord til de næste 60 dage (ikke brugt i den gamle 30-dages fil)
      INSERT INTO wordle_word_bank (word) VALUES
        ('musik'),
        ('timer'),
        ('kaffe'),
        ('teori'),
        ('skema'),
        ('bryde'),
        ('vinde'),
        ('tjene'),
        ('holde'),
        ('spise'),
        ('smile'),
        ('hjælp'),
        ('tøjle'),
        ('ørken'),
        ('åbner'),
        ('ånder'),
        ('køber'),
        ('søger'),
        ('ærlig'),
        ('bager'),
        ('natte'),
        ('lysne'),
        ('stier'),
        ('vejen'),
        ('frisk'),
        ('sprød'),
        ('blidt'),
        ('kraft'),
        ('storm'),
        ('flugt'),
        ('vågen'),
        ('lager'),
        ('gange'),
        ('sidde'),
        ('ståle'),
        ('glimt'),
        ('pragt'),
        ('klare'),
        ('tætne'),
        ('ruter'),
        ('huset'),
        ('træer'),
        ('kører'),
        ('spore'),
        ('stave'),
        ('lænde'),
        ('hælde'),
        ('vifte'),
        ('kaste'),
        ('ringe'),
        ('prins'),
        ('dansk'),
        ('vinke'),
        ('vække'),
        ('fælde'),
        ('skære'),
        ('løber'),
        ('tapet'),
        ('sømme'),
        ('varme')
      ON CONFLICT (word) DO NOTHING;

      -- Bevar eksisterende ord for historiske datoer (så man ikke får nye ord på genindlæsning)
      INSERT INTO wordle_daily_answers (play_date, word) VALUES
        ('2026-02-16','skole'),
        ('2026-02-17','lærer'),
        ('2026-02-18','bøger'),
        ('2026-02-19','viden'),
        ('2026-02-20','spørg'),
        ('2026-02-21','sprog'),
        ('2026-02-22','regne'),
        ('2026-02-23','noter'),
        ('2026-02-24','tavle'),
        ('2026-02-25','prøve'),
        ('2026-02-26','læser'),
        ('2026-02-27','kloge'),
        ('2026-02-28','tanke'),
        ('2026-03-01','logik'),
        ('2026-03-02','fokus'),
        ('2026-03-03','lærte'),
        ('2026-03-04','tælle'),
        ('2026-03-05','fejle'),
        ('2026-03-06','ønske'),
        ('2026-03-07','vaner'),
        ('2026-03-08','start'),
        ('2026-03-09','pause'),
        ('2026-03-10','tempo'),
        ('2026-03-11','smart'),
        ('2026-03-12','skarp'),
        ('2026-03-13','modig'),
        ('2026-03-14','rolig'),
        ('2026-03-15','stolt'),
        ('2026-03-16','flere'),
        ('2026-03-17','håber')
      ON CONFLICT (play_date) DO NOTHING;

      -- Forudfyld næste 60 dage fra i dag med uudnyttede ord (så de bliver låst pr. dato)
      WITH days AS (
        SELECT (CURRENT_DATE + offs)::date AS play_date,
               row_number() OVER (ORDER BY offs) - 1 AS rn
        FROM generate_series(0, 59) AS offs
      ),
      avail AS (
        SELECT wb.word,
               row_number() OVER (ORDER BY wb.word) - 1 AS rn
        FROM wordle_word_bank wb
        WHERE NOT EXISTS (
          SELECT 1 FROM wordle_daily_answers da WHERE da.word = wb.word
        )
      )
      INSERT INTO wordle_daily_answers (play_date, word)
      SELECT d.play_date, a.word
      FROM days d
      JOIN avail a ON a.rn = d.rn
      WHERE NOT EXISTS (
        SELECT 1 FROM wordle_daily_answers da2 WHERE da2.play_date = d.play_date
      )
      ON CONFLICT (play_date) DO NOTHING;
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
    name: 'game_completions_time_seconds',
    sql: `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'game_completions' AND column_name = 'time_seconds'
        ) THEN
          ALTER TABLE game_completions ADD COLUMN time_seconds INT NULL CHECK (time_seconds >= 0);
        END IF;
      END $$;
    `,
  },
  {
    name: 'flag_capital_daily_attempts',
    sql: `
      CREATE TABLE IF NOT EXISTS flag_capital_daily_attempts (
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        play_date DATE NOT NULL,
        attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 3),
        PRIMARY KEY (user_id, play_date)
      );
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
  {
    name: 'poker_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS poker_tables (
        id SERIAL PRIMARY KEY,
        invite_code TEXT NOT NULL UNIQUE,
        created_by_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'finished')),
        small_blind INT NOT NULL DEFAULT 1 CHECK (small_blind >= 1),
        big_blind INT NOT NULL DEFAULT 2 CHECK (big_blind >= 1),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_poker_tables_invite_code ON poker_tables (invite_code);
      CREATE INDEX IF NOT EXISTS idx_poker_tables_status ON poker_tables (status);

      CREATE TABLE IF NOT EXISTS poker_table_players (
        id SERIAL PRIMARY KEY,
        table_id INT NOT NULL REFERENCES poker_tables(id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        seat_index INT NOT NULL CHECK (seat_index >= 0 AND seat_index <= 3),
        chips_in_hand INT NOT NULL DEFAULT 0 CHECK (chips_in_hand >= 0),
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        left_at TIMESTAMPTZ,
        UNIQUE (table_id, seat_index),
        UNIQUE (table_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_poker_table_players_table ON poker_table_players (table_id);
    `,
  },
  {
    name: 'song_requests_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS song_requests (
        id SERIAL PRIMARY KEY,
        class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        requested_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        spotify_track_id TEXT NOT NULL,
        track_name TEXT NOT NULL,
        artist_name TEXT NOT NULL,
        album_art_url TEXT,
        preview_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_song_requests_class ON song_requests (class_id);
      CREATE INDEX IF NOT EXISTS idx_song_requests_created ON song_requests (created_at);

      CREATE TABLE IF NOT EXISTS song_request_votes (
        request_id INT NOT NULL REFERENCES song_requests(id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (request_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_song_request_votes_request ON song_request_votes (request_id);
    `,
  },
  {
    name: 'jokes_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS jokes (
        id SERIAL PRIMARY KEY,
        class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        submitted_date DATE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (class_id, user_id, submitted_date)
      );
      CREATE INDEX IF NOT EXISTS idx_jokes_class_date ON jokes (class_id, submitted_date);
      CREATE INDEX IF NOT EXISTS idx_jokes_created ON jokes (created_at);

      CREATE TABLE IF NOT EXISTS joke_votes (
        joke_id INT NOT NULL REFERENCES jokes(id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (joke_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_joke_votes_joke ON joke_votes (joke_id);
    `,
  },
  {
    name: 'user_bans',
    sql: `
      CREATE TABLE IF NOT EXISTS user_bans (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        banned_until TIMESTAMPTZ NOT NULL,
        banned_by INT REFERENCES users(id) ON DELETE SET NULL,
        reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_user_bans_user ON user_bans (user_id);
      CREATE INDEX IF NOT EXISTS idx_user_bans_until ON user_bans (banned_until);
    `,
  },
  {
    name: 'spotify_user_tokens',
    sql: `
      CREATE TABLE IF NOT EXISTS spotify_user_tokens (
        user_id INT NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    name: 'login_sessions',
    sql: `
      CREATE TABLE IF NOT EXISTS login_sessions (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        jti TEXT NOT NULL UNIQUE,
        ip TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_login_sessions_user ON login_sessions (user_id);
      CREATE INDEX IF NOT EXISTS idx_login_sessions_jti ON login_sessions (jti);
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
