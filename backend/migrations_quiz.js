const { pool } = require('./db');

async function runQuizMigrations() {
  const sql = `
    CREATE TABLE IF NOT EXISTS quiz_templates (
      id SERIAL PRIMARY KEY,
      owner_admin_id INT REFERENCES users(id) ON DELETE SET NULL,
      class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_quiz_templates_class ON quiz_templates (class_id);

    CREATE TABLE IF NOT EXISTS quiz_questions (
      id SERIAL PRIMARY KEY,
      quiz_template_id INT NOT NULL REFERENCES quiz_templates(id) ON DELETE CASCADE,
      question_text TEXT NOT NULL,
      options TEXT[] NOT NULL,
      correct_option_index INT NOT NULL CHECK (correct_option_index >= 0),
      time_limit_seconds INT NOT NULL DEFAULT 20 CHECK (time_limit_seconds > 0 AND time_limit_seconds <= 300),
      order_index INT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_quiz_questions_template ON quiz_questions (quiz_template_id, order_index, id);

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'quiz_session_status'
      ) THEN
        CREATE TYPE quiz_session_status AS ENUM ('lobby', 'running', 'finished');
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS quiz_sessions (
      id SERIAL PRIMARY KEY,
      quiz_template_id INT NOT NULL REFERENCES quiz_templates(id) ON DELETE CASCADE,
      class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      status quiz_session_status NOT NULL DEFAULT 'lobby',
      current_question_index INT NOT NULL DEFAULT 0,
      pin_code TEXT,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_quiz_sessions_class_status ON quiz_sessions (class_id, status);
    CREATE INDEX IF NOT EXISTS idx_quiz_sessions_template ON quiz_sessions (quiz_template_id);

    CREATE TABLE IF NOT EXISTS quiz_participants (
      id SERIAL PRIMARY KEY,
      quiz_session_id INT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      total_score INT NOT NULL DEFAULT 0 CHECK (total_score >= 0),
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (quiz_session_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_quiz_participants_session ON quiz_participants (quiz_session_id);

    CREATE TABLE IF NOT EXISTS quiz_answers (
      id SERIAL PRIMARY KEY,
      quiz_session_id INT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
      quiz_question_id INT NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
      participant_id INT NOT NULL REFERENCES quiz_participants(id) ON DELETE CASCADE,
      selected_option_index INT NOT NULL CHECK (selected_option_index >= 0),
      is_correct BOOLEAN NOT NULL,
      score INT NOT NULL DEFAULT 0 CHECK (score >= 0),
      answer_time_ms INT,
      answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (quiz_session_id, quiz_question_id, participant_id)
    );
    CREATE INDEX IF NOT EXISTS idx_quiz_answers_session_question ON quiz_answers (quiz_session_id, quiz_question_id);
    CREATE INDEX IF NOT EXISTS idx_quiz_answers_participant ON quiz_answers (participant_id);
  `;

  await pool.query(sql);
  console.log('Quiz migrations executed');
}

module.exports = { runQuizMigrations };

