const token = localStorage.getItem('ontime_token');
if (!token) {
  window.location.href = '/';
}

const api = (path, opts = {}) =>
  fetch(path, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${token}` },
  });

let currentSessionId = null;
let currentQuestionId = null;
let currentTimeLimit = null;
let questionStartedAt = null;
let timerInterval = null;

function formatSecondsLeft(total, startedAt) {
  if (!total || !startedAt) return '';
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const left = Math.max(0, total - elapsed);
  return left + ' sek.';
}

async function loadUser() {
  const res = await api('/api/auth/me');
  if (!res.ok) {
    localStorage.removeItem('ontime_token');
    window.location.href = '/';
    return;
  }
  const user = await res.json();
  const nameEl = document.getElementById('quiz-user-name');
  if (nameEl) nameEl.textContent = user.name + ' · ' + user.className;
}

async function ensureActiveSessionFromQueryOrApi() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('sessionId');
  if (fromUrl) {
    currentSessionId = parseInt(fromUrl, 10) || null;
  }
  if (currentSessionId) return;
  const res = await api('/api/quizzes/active');
  const data = await res.json().catch(() => ({}));
  if (data && data.active && data.active.id) {
    currentSessionId = data.active.id;
  }
}

async function joinSession() {
  if (!currentSessionId) return;
  const joinStatus = document.getElementById('quiz-join-status');
  const joinBtn = document.getElementById('quiz-join-btn');
  if (joinBtn) {
    joinBtn.disabled = true;
    joinBtn.textContent = 'Deltager…';
  }
  if (joinStatus) joinStatus.textContent = 'Deltager i quiz…';
  const res = await api('/api/quizzes/sessions/' + currentSessionId + '/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (joinStatus) joinStatus.textContent = data.error || 'Kunne ikke deltage i quiz.';
    if (joinBtn) {
      joinBtn.disabled = false;
      joinBtn.textContent = 'Prøv igen';
    }
    return;
  }
  if (joinStatus) joinStatus.textContent = 'Du deltager i quizzen. Vent på første spørgsmål.';
  const joinCard = document.getElementById('quiz-join-card');
  if (joinCard) joinCard.hidden = true;
  const qCard = document.getElementById('quiz-question-card');
  if (qCard) qCard.hidden = false;
  const lbCard = document.getElementById('quiz-leaderboard-card');
  if (lbCard) lbCard.hidden = false;
  pollState();
  pollLeaderboard();
}

function renderQuestion(session, question) {
  const heroSub = document.getElementById('quiz-hero-sub');
  const qText = document.getElementById('quiz-question-text');
  const optionsEl = document.getElementById('quiz-options');
  const timerEl = document.getElementById('quiz-timer');
  const feedbackEl = document.getElementById('quiz-answer-feedback');
  currentQuestionId = null;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (!question) {
    if (heroSub) heroSub.textContent = 'Ingen aktivt spørgsmål lige nu. Vent på læreren.';
    if (qText) qText.textContent = '';
    if (optionsEl) optionsEl.innerHTML = '';
    if (timerEl) timerEl.textContent = '';
    if (feedbackEl) {
      feedbackEl.hidden = false;
      feedbackEl.className = 'message';
      feedbackEl.textContent = session.status === 'finished'
        ? 'Quizzen er slut. Se stillingen nedenfor.'
        : 'Vent på næste spørgsmål.';
    }
    return;
  }

  currentQuestionId = question.id;
  currentTimeLimit = question.timeLimitSeconds || null;
  questionStartedAt = Date.now();
  if (heroSub) heroSub.textContent = 'Spørgsmål #' + (Number(question.index || 0) + 1);
  if (qText) qText.textContent = question.text || '';
  if (feedbackEl) feedbackEl.hidden = true;

  if (optionsEl) {
    optionsEl.innerHTML = '';
    (question.options || []).forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-option-btn';
      btn.textContent = String(opt);
      btn.addEventListener('click', () => submitAnswer(idx, btn));
      optionsEl.appendChild(btn);
    });
  }

  if (timerEl && currentTimeLimit) {
    timerEl.textContent = 'Tid tilbage: ' + formatSecondsLeft(currentTimeLimit, questionStartedAt);
    timerInterval = setInterval(() => {
      timerEl.textContent = 'Tid tilbage: ' + formatSecondsLeft(currentTimeLimit, questionStartedAt);
    }, 1000);
  } else if (timerEl) {
    timerEl.textContent = '';
  }
}

async function pollState() {
  if (!currentSessionId) return;
  try {
    const res = await api('/api/quizzes/sessions/' + currentSessionId + '/state');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    const sess = data.session || {};
    const q = data.currentQuestion || null;
    renderQuestion(sess, q);
  } catch (e) {
    // ignore
  }
  setTimeout(pollState, 3000);
}

async function pollLeaderboard() {
  if (!currentSessionId) return;
  try {
    const res = await api('/api/quizzes/sessions/' + currentSessionId + '/leaderboard');
    const data = await res.json().catch(() => []);
    const lbEl = document.getElementById('quiz-leaderboard');
    const list = Array.isArray(data) ? data : [];
    if (lbEl) {
      if (!list.length) {
        lbEl.innerHTML = '<p class="muted">Ingen svar endnu.</p>';
      } else {
        lbEl.innerHTML =
          '<ul class="leaderboard-list">' +
          list
            .map(
              (s, i) =>
                '<li><span class="rank">' +
                (i + 1) +
                '</span><span class="name">' +
                (s.display_name || '') +
                '</span><span class="points">' +
                (s.total_score || 0) +
                ' pt</span></li>'
            )
            .join('') +
          '</ul>';
      }
    }
  } catch (e) {
    // ignore
  }
  setTimeout(pollLeaderboard, 4000);
}

async function submitAnswer(optionIndex, btn) {
  if (!currentSessionId || !currentQuestionId) return;
  const feedbackEl = document.getElementById('quiz-answer-feedback');
  const optionsEl = document.getElementById('quiz-options');
  if (optionsEl) {
    optionsEl.querySelectorAll('button').forEach((b) => (b.disabled = true));
  }
  if (feedbackEl) {
    feedbackEl.hidden = false;
    feedbackEl.className = 'message';
    feedbackEl.textContent = 'Sender svar…';
  }
  let answerTimeMs = null;
  if (questionStartedAt) {
    answerTimeMs = Date.now() - questionStartedAt;
  }
  try {
    const res = await api('/api/quizzes/sessions/' + currentSessionId + '/answers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionId: currentQuestionId,
        selectedOptionIndex: optionIndex,
        answerTimeMs,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (feedbackEl) {
        feedbackEl.hidden = false;
        feedbackEl.className = 'message error';
        feedbackEl.textContent = data.error || 'Kunne ikke sende svar.';
      }
      if (optionsEl) {
        optionsEl.querySelectorAll('button').forEach((b) => (b.disabled = false));
      }
      return;
    }
    if (feedbackEl) {
      const correct = !!data.is_correct;
      feedbackEl.hidden = false;
      feedbackEl.className = 'message ' + (correct ? 'success' : 'error');
      feedbackEl.textContent = correct ? 'Rigtigt svar! +' + (data.score || 0) + ' point.' : 'Forkert svar. Du fik 0 point.';
    }
    pollLeaderboard();
  } catch (e) {
    if (feedbackEl) {
      feedbackEl.hidden = false;
      feedbackEl.className = 'message error';
      feedbackEl.textContent = 'Fejl ved svar.';
    }
  }
}

async function init() {
  document.getElementById('quiz-logout')?.addEventListener('click', () => {
    localStorage.removeItem('ontime_token');
    window.location.href = '/';
  });
  await loadUser();
  await ensureActiveSessionFromQueryOrApi();
  const heroTitle = document.getElementById('quiz-hero-title');
  const heroSub = document.getElementById('quiz-hero-sub');
  const joinStatus = document.getElementById('quiz-join-status');
  const joinBtn = document.getElementById('quiz-join-btn');
  if (!currentSessionId) {
    if (heroTitle) heroTitle.textContent = 'Ingen aktiv quiz';
    if (heroSub) heroSub.textContent = 'Din lærer har ikke startet en quiz lige nu.';
    if (joinStatus) joinStatus.textContent = 'Ingen aktiv quiz for din klasse.';
    if (joinBtn) joinBtn.disabled = true;
    return;
  }
  if (heroSub) heroSub.textContent = 'Der er en aktiv quiz for din klasse. Tryk “Deltag”.';
  if (joinStatus) joinStatus.textContent = 'Klar til at deltage.';
  if (joinBtn) {
    joinBtn.disabled = false;
    joinBtn.addEventListener('click', joinSession);
  }
}

init();

