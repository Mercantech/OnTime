const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

// Admin: list quizzes for a class
router.get('/templates', auth, requireAdmin, async (req, res) => {
  const classId = Number(req.query.classId || 0);
  if (!classId) return res.status(400).json({ error: 'classId mangler' });
  try {
    const r = await pool.query(
      `SELECT id, title, description, class_id, created_at, updated_at
       FROM quiz_templates
       WHERE class_id = $1
       ORDER BY created_at DESC`,
      [classId]
    );
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

// Admin: create quiz template with questions
router.post('/templates', auth, requireAdmin, async (req, res) => {
  const { classId, title, description, questions } = req.body || {};
  if (!classId || !title || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'classId, title og mindst ét spørgsmål kræves' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tplRes = await client.query(
      `INSERT INTO quiz_templates (owner_admin_id, class_id, title, description)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, description, class_id, created_at, updated_at`,
      [req.userId, classId, title, description || null]
    );
    const templateId = tplRes.rows[0].id;
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q || !q.text || !Array.isArray(q.options) || q.options.length < 2) {
        throw new Error('Ugyldigt spørgsmål');
      }
      const correctIndex =
        typeof q.correctOptionIndex === 'number' && q.correctOptionIndex >= 0
          ? q.correctOptionIndex
          : 0;
      const timeLimit = q.timeLimitSeconds && q.timeLimitSeconds > 0 ? q.timeLimitSeconds : 20;
      await client.query(
        `INSERT INTO quiz_questions
           (quiz_template_id, question_text, options, correct_option_index, time_limit_seconds, order_index)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [templateId, q.text, q.options, correctIndex, timeLimit, i]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(tplRes.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  } finally {
    client.release();
  }
});

// Admin: update template (replace questions)
router.put('/templates/:id', auth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id || 0);
  const { title, description, questions } = req.body || {};
  if (!id || !title || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'title og mindst ét spørgsmål kræves' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT id, class_id FROM quiz_templates WHERE id = $1',
      [id]
    );
    if (!existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Quiz ikke fundet' });
    }
    await client.query(
      `UPDATE quiz_templates
       SET title = $1, description = $2, updated_at = NOW()
       WHERE id = $3`,
      [title, description || null, id]
    );
    await client.query('DELETE FROM quiz_questions WHERE quiz_template_id = $1', [id]);
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q || !q.text || !Array.isArray(q.options) || q.options.length < 2) {
        throw new Error('Ugyldigt spørgsmål');
      }
      const correctIndex =
        typeof q.correctOptionIndex === 'number' && q.correctOptionIndex >= 0
          ? q.correctOptionIndex
          : 0;
      const timeLimit = q.timeLimitSeconds && q.timeLimitSeconds > 0 ? q.timeLimitSeconds : 20;
      await client.query(
        `INSERT INTO quiz_questions
           (quiz_template_id, question_text, options, correct_option_index, time_limit_seconds, order_index)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, q.text, q.options, correctIndex, timeLimit, i]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  } finally {
    client.release();
  }
});

// Admin: start new session from template
router.post('/templates/:id/sessions', auth, requireAdmin, async (req, res) => {
  const templateId = Number(req.params.id || 0);
  const { classId } = req.body || {};
  if (!templateId || !classId) {
    return res.status(400).json({ error: 'classId kræves' });
  }
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  try {
    const tpl = await pool.query(
      'SELECT id FROM quiz_templates WHERE id = $1 AND class_id = $2',
      [templateId, classId]
    );
    if (!tpl.rows.length) {
      return res.status(404).json({ error: 'Quiz ikke fundet for klassen' });
    }
    const r = await pool.query(
      `INSERT INTO quiz_sessions (quiz_template_id, class_id, status, current_question_index, pin_code)
       VALUES ($1, $2, 'lobby', 0, $3)
       RETURNING id, quiz_template_id, class_id, status, current_question_index, pin_code, created_at`,
      [templateId, classId, pin]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

// Admin: control session state
router.post('/sessions/:id/start', auth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'Ugyldigt id' });
  try {
    const r = await pool.query(
      `UPDATE quiz_sessions
       SET status = 'running', started_at = COALESCE(started_at, NOW()), current_question_index = 0
       WHERE id = $1
       RETURNING id, quiz_template_id, class_id, status, current_question_index, pin_code, started_at`,
      [id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Session ikke fundet' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

router.post('/sessions/:id/next-question', auth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'Ugyldigt id' });
  try {
    const r = await pool.query(
      `UPDATE quiz_sessions
       SET current_question_index = current_question_index + 1
       WHERE id = $1
       RETURNING id, quiz_template_id, class_id, status, current_question_index, pin_code`,
      [id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Session ikke fundet' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

router.post('/sessions/:id/end', auth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'Ugyldigt id' });
  try {
    const r = await pool.query(
      `UPDATE quiz_sessions
       SET status = 'finished', finished_at = NOW()
       WHERE id = $1
       RETURNING id, quiz_template_id, class_id, status, current_question_index, pin_code, finished_at`,
      [id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Session ikke fundet' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

// Student: find active session for own class (lobby/running)
router.get('/active', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, quiz_template_id, class_id, status, current_question_index, pin_code
       FROM quiz_sessions
       WHERE class_id = (SELECT class_id FROM users WHERE id = $1)
         AND status IN ('lobby', 'running')
       ORDER BY created_at DESC
       LIMIT 1`,
      [req.userId]
    );
    if (!r.rows.length) return res.json({ active: null });
    res.json({ active: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

// Student: join session
router.post('/sessions/:id/join', auth, async (req, res) => {
  const id = Number(req.params.id || 0);
  const { pinCode } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Ugyldigt id' });
  try {
    const sessRes = await pool.query(
      `SELECT s.id, s.class_id, s.status, s.pin_code, u.class_id AS user_class_id, u.name
       FROM quiz_sessions s
       JOIN users u ON u.id = $1
       WHERE s.id = $2`,
      [req.userId, id]
    );
    if (!sessRes.rows.length) return res.status(404).json({ error: 'Session ikke fundet' });
    const sess = sessRes.rows[0];
    if (sess.status !== 'lobby' && sess.status !== 'running') {
      return res.status(400).json({ error: 'Session er ikke åben for join' });
    }
    if (sess.user_class_id !== sess.class_id) {
      if (sess.pin_code && pinCode && pinCode === sess.pin_code) {
        // allow via pin
      } else {
        return res.status(403).json({ error: 'Ingen adgang til denne quiz' });
      }
    }
    const displayName = sess.name || 'Elev';
    const r = await pool.query(
      `INSERT INTO quiz_participants (quiz_session_id, user_id, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (quiz_session_id, user_id) DO UPDATE
       SET display_name = EXCLUDED.display_name
       RETURNING id, quiz_session_id, user_id, display_name, total_score, joined_at`,
      [id, req.userId, displayName]
    );
    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

// Student: get current state
router.get('/sessions/:id/state', auth, async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'Ugyldigt id' });
  try {
    const sessRes = await pool.query(
      `SELECT s.id, s.quiz_template_id, s.class_id, s.status, s.current_question_index
       FROM quiz_sessions s
       WHERE s.id = $1`,
      [id]
    );
    if (!sessRes.rows.length) return res.status(404).json({ error: 'Session ikke fundet' });
    const sess = sessRes.rows[0];
    const questionsRes = await pool.query(
      `SELECT id, question_text, options, time_limit_seconds, order_index
       FROM quiz_questions
       WHERE quiz_template_id = $1
       ORDER BY order_index, id`,
      [sess.quiz_template_id]
    );
    const current = questionsRes.rows[sess.current_question_index] || null;
    res.json({
      session: sess,
      currentQuestion: current
        ? {
            id: current.id,
            text: current.question_text,
            options: current.options,
            timeLimitSeconds: current.time_limit_seconds,
            index: sess.current_question_index,
          }
        : null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

// Student: answer current question
router.post('/sessions/:id/answers', auth, async (req, res) => {
  const id = Number(req.params.id || 0);
  const { questionId, selectedOptionIndex, answerTimeMs } = req.body || {};
  if (!id || !questionId || typeof selectedOptionIndex !== 'number') {
    return res.status(400).json({ error: 'Manglende felter' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sessRes = await client.query(
      `SELECT s.id, s.quiz_template_id, s.status, s.current_question_index
       FROM quiz_sessions s
       WHERE s.id = $1
       FOR UPDATE`,
      [id]
    );
    if (!sessRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Session ikke fundet' });
    }
    const sess = sessRes.rows[0];
    if (sess.status !== 'running') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Quiz er ikke i gang' });
    }
    const qRes = await client.query(
      `SELECT id, question_text, options, correct_option_index, time_limit_seconds, order_index
       FROM quiz_questions
       WHERE id = $1 AND quiz_template_id = $2`,
      [questionId, sess.quiz_template_id]
    );
    if (!qRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Spørgsmål ikke fundet' });
    }
    const q = qRes.rows[0];
    if (q.order_index !== sess.current_question_index) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ikke aktivt spørgsmål' });
    }
    const partRes = await client.query(
      `SELECT id, total_score
       FROM quiz_participants
       WHERE quiz_session_id = $1 AND user_id = $2
       FOR UPDATE`,
      [id, req.userId]
    );
    if (!partRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Du deltager ikke i denne quiz' });
    }
    const participant = partRes.rows[0];
    const isCorrect = selectedOptionIndex === q.correct_option_index;
    const baseScore = isCorrect ? 1000 : 0;
    let bonus = 0;
    if (isCorrect && typeof answerTimeMs === 'number' && answerTimeMs >= 0) {
      const maxMs = q.time_limit_seconds * 1000;
      const clamped = Math.max(0, Math.min(maxMs, answerTimeMs));
      const factor = 1 - clamped / maxMs;
      bonus = Math.round(500 * factor);
    }
    const total = baseScore + bonus;
    const ansRes = await client.query(
      `INSERT INTO quiz_answers
         (quiz_session_id, quiz_question_id, participant_id, selected_option_index, is_correct, score, answer_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (quiz_session_id, quiz_question_id, participant_id) DO UPDATE
       SET selected_option_index = EXCLUDED.selected_option_index,
           is_correct = EXCLUDED.is_correct,
           score = EXCLUDED.score,
           answer_time_ms = EXCLUDED.answer_time_ms,
           answered_at = NOW()
       RETURNING id, is_correct, score`,
      [id, questionId, participant.id, selectedOptionIndex, isCorrect, total, answerTimeMs || null]
    );
    await client.query(
      `UPDATE quiz_participants
       SET total_score = total_score + $1
       WHERE id = $2`,
      [total, participant.id]
    );
    await client.query('COMMIT');
    res.json(ansRes.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  } finally {
    client.release();
  }
});

// Student: leaderboard
router.get('/sessions/:id/leaderboard', auth, async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'Ugyldigt id' });
  try {
    const r = await pool.query(
      `SELECT display_name, total_score
       FROM quiz_participants
       WHERE quiz_session_id = $1
       ORDER BY total_score DESC, joined_at ASC`,
      [id]
    );
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

module.exports = router;

