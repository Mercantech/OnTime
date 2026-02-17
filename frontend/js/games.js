const token = localStorage.getItem('ontime_token');
if (!token) {
  window.location.href = '/';
}

const api = (path, opts = {}) =>
  fetch(path, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${token}` },
  });

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

function getLocalISODate(d = new Date()) {
  return (
    d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

// ---------- Bruger & log ud ----------
async function loadUser() {
  const el = document.getElementById('user-name');
  if (!el) return;
  try {
    const res = await api('/api/auth/me');
    const data = await res.json().catch(() => ({}));
    if (data.name) el.textContent = data.name;
  } catch (e) {
    el.textContent = '';
  }
}

document.getElementById('logout')?.addEventListener('click', () => {
  localStorage.removeItem('ontime_token');
  window.location.href = '/';
});

// ---------- Wordle (kopieret fra app.js) ----------
function normalizeWordleWord(s) {
  return String(s || '').trim().toLocaleLowerCase('da-DK');
}

function scoreWordleGuess(guess, answer) {
  const g = guess.split('');
  const a = answer.split('');
  const res = Array(5).fill('absent');
  for (let i = 0; i < 5; i++) {
    if (g[i] === a[i]) {
      res[i] = 'correct';
      g[i] = null;
      a[i] = null;
    }
  }
  for (let i = 0; i < 5; i++) {
    if (!g[i]) continue;
    const idx = a.indexOf(g[i]);
    if (idx !== -1) {
      res[i] = 'present';
      a[idx] = null;
    }
  }
  return res;
}

function upgradeKeyState(prev, next) {
  const order = { correct: 3, present: 2, absent: 1, unknown: 0 };
  const p = prev || 'unknown';
  return order[next] > order[p] ? next : p;
}

async function loadWordle() {
  const wrap = document.getElementById('wordle');
  const boardEl = document.getElementById('wordle-board');
  const kbEl = document.getElementById('wordle-keyboard');
  const statusEl = document.getElementById('wordle-status');
  if (!wrap || !boardEl || !kbEl || !statusEl) return;

  const dateKey = getLocalISODate();
  const storageKey = 'ontime_wordle_' + dateKey;

  let answer = '';
  try {
    const res = await fetch('/wordle-answers-30d.json');
    const data = await res.json().catch(() => ({}));
    answer = normalizeWordleWord(data[dateKey] || data.default || '');
  } catch (e) {
    answer = '';
  }

  if (!answer || answer.length !== 5) {
    statusEl.textContent = 'Ingen Wordle-ord i dag.';
    return;
  }

  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; }
  })();

  const state = {
    dateKey,
    answer,
    current: '',
    guesses: Array.isArray(saved?.guesses) ? saved.guesses : [],
    status: saved?.status === 'won' || saved?.status === 'lost' ? saved.status : 'playing',
    keyStates: {},
    awarded: !!saved?.awarded,
  };

  const rows = [
    ['Q','W','E','R','T','Y','U','I','O','P','Å'],
    ['A','S','D','F','G','H','J','K','L','Æ','Ø'],
    ['ENTER','Z','X','C','V','B','N','M','⌫'],
  ];

  function persist() {
    localStorage.setItem(storageKey, JSON.stringify({
      guesses: state.guesses,
      status: state.status,
      awarded: state.awarded,
    }));
  }

  function rebuildKeyStates() {
    state.keyStates = {};
    for (const g of state.guesses) {
      const word = normalizeWordleWord(g.word || '');
      const score = Array.isArray(g.score) ? g.score : [];
      for (let i = 0; i < 5; i++) {
        const ch = word[i]?.toLocaleUpperCase('da-DK');
        if (!ch) continue;
        state.keyStates[ch] = upgradeKeyState(state.keyStates[ch], score[i] || 'absent');
      }
    }
  }

  async function awardIfWin() {
    if (state.status !== 'won' || state.awarded) return;
    state.awarded = true;
    persist();
    try {
      await api('/api/games/wordle/win', { method: 'POST' });
    } catch (e) {}
  }

  function render() {
    rebuildKeyStates();
    if (state.status === 'won') statusEl.textContent = 'Du vandt Wordle i dag. Flot!';
    else if (state.status === 'lost') statusEl.textContent = 'Øv. Dagens ord var: ' + state.answer.toLocaleUpperCase('da-DK') + '.';
    else statusEl.textContent = 'Gæt dagens ord (' + state.dateKey + ').';

    const rowHtml = [];
    for (let r = 0; r < 6; r++) {
      let letters = '';
      let score = null;
      if (r < state.guesses.length) {
        letters = normalizeWordleWord(state.guesses[r].word || '');
        score = Array.isArray(state.guesses[r].score) ? state.guesses[r].score : null;
      } else if (r === state.guesses.length) {
        letters = normalizeWordleWord(state.current);
      }
      const tiles = [];
      for (let c = 0; c < 5; c++) {
        const ch = (letters[c] || '').toLocaleUpperCase('da-DK');
        let cls = 'wordle-tile';
        if (ch) cls += ' filled';
        if (score) cls += ' ' + (score[c] || 'absent');
        tiles.push('<div class="' + cls + '" role="gridcell" aria-label="' + escapeHtml(ch || 'tom') + '">' + escapeHtml(ch) + '</div>');
      }
      rowHtml.push('<div class="wordle-row" role="row">' + tiles.join('') + '</div>');
    }
    boardEl.innerHTML = rowHtml.join('');

    kbEl.innerHTML = rows.map((row) => {
      const keys = row.map((k) => {
        const stateCls = (k.length === 1 && state.keyStates[k]) ? ' ' + state.keyStates[k] : '';
        const wide = (k === 'ENTER' || k === '⌫') ? ' wide' : '';
        const label = k === '⌫' ? 'Slet' : (k === 'ENTER' ? 'Enter' : k);
        return '<button type="button" class="wordle-key' + wide + stateCls + '" data-key="' + escapeHtml(k) + '">' + escapeHtml(label) + '</button>';
      }).join('');
      return '<div class="wordle-keyboard-row">' + keys + '</div>';
    }).join('');

    kbEl.querySelectorAll('.wordle-key').forEach((btn) => {
      btn.addEventListener('click', () => handleKey(btn.getAttribute('data-key')));
    });
  }

  function handleKey(key) {
    if (state.status !== 'playing') return;
    if (!key) return;
    if (key === 'ENTER') {
      if (state.current.length !== 5) return;
      const guess = normalizeWordleWord(state.current);
      const score = scoreWordleGuess(guess, state.answer);
      state.guesses.push({ word: guess, score });
      state.current = '';
      if (guess === state.answer) state.status = 'won';
      else if (state.guesses.length >= 6) state.status = 'lost';
      persist();
      render();
      awardIfWin();
      return;
    }
    if (key === '⌫') {
      state.current = state.current.slice(0, -1);
      render();
      return;
    }
    if (key.length === 1) {
      const ch = key.toLocaleLowerCase('da-DK');
      if (!/^[a-zæøå]$/i.test(ch)) return;
      if (state.current.length >= 5) return;
      state.current += ch;
      render();
    }
  }

  if (!document.body.dataset.wordleInit) {
    document.body.dataset.wordleInit = '1';
    document.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'Enter') { e.preventDefault(); handleKey('ENTER'); return; }
      if (k === 'Backspace') { e.preventDefault(); handleKey('⌫'); return; }
      if (k && k.length === 1) {
        const ch = k.toLocaleUpperCase('da-DK');
        if (/^[A-ZÆØÅ]$/.test(ch)) handleKey(ch);
      }
    });
  }

  render();
  if (state.status === 'won') awardIfWin();
}

// ---------- Dagens flag (3 forsøg, state fra backend) ----------
async function initFlagGame() {
  const statusEl = document.getElementById('flag-status');
  const wrapEl = document.getElementById('flag-wrap');
  const imgEl = document.getElementById('flag-img');
  const attemptsEl = document.getElementById('flag-attempts');
  const guessRowEl = document.getElementById('flag-guess-row');
  const inputEl = document.getElementById('flag-guess');
  const submitBtn = document.getElementById('flag-submit');
  const feedbackEl = document.getElementById('flag-feedback');
  if (!statusEl || !wrapEl || !imgEl || !attemptsEl || !guessRowEl || !inputEl || !submitBtn || !feedbackEl) return;

  let state = { won: false, lost: false, attemptsUsed: 0, attemptsLeft: 3, countryName: null };

  function renderFlagUI() {
    feedbackEl.hidden = true;
    if (state.won) {
      statusEl.textContent = 'Du har gættet dagens flag!';
      attemptsEl.hidden = true;
      guessRowEl.hidden = true;
      feedbackEl.hidden = false;
      feedbackEl.textContent = 'Det var ' + (state.countryName || '') + '. Du fik 2 point.';
      feedbackEl.className = 'flag-feedback flag-feedback-correct';
      inputEl.disabled = true;
      submitBtn.disabled = true;
      return;
    }
    if (state.lost) {
      statusEl.textContent = 'Ingen forsøg tilbage i dag.';
      attemptsEl.hidden = false;
      attemptsEl.textContent = 'Dagens land var ' + (state.countryName || '') + '.';
      attemptsEl.className = 'flag-attempts flag-attempts-lost';
      guessRowEl.hidden = true;
      inputEl.disabled = true;
      submitBtn.disabled = true;
      return;
    }
    statusEl.textContent = 'Hvilket land tilhører dette flag?';
    attemptsEl.hidden = false;
    attemptsEl.textContent = 'Forsøg ' + (state.attemptsUsed + 1) + '/3 – du har ' + state.attemptsLeft + ' forsøg tilbage.';
    attemptsEl.className = 'flag-attempts';
    guessRowEl.hidden = false;
    inputEl.disabled = false;
    submitBtn.disabled = false;
  }

  try {
    const [flagRes, statusRes] = await Promise.all([
      api('/api/games/daily-flag'),
      api('/api/games/flag/status'),
    ]);
    const flagData = await flagRes.json().catch(() => ({}));
    const statusData = await statusRes.json().catch(() => ({}));

    if (!flagData.flagUrl) {
      statusEl.textContent = 'Kunne ikke hente dagens flag.';
      return;
    }
    imgEl.src = flagData.flagUrl;
    wrapEl.hidden = false;

    state = {
      won: !!statusData.won,
      lost: !!statusData.lost,
      attemptsUsed: statusData.attemptsUsed ?? 0,
      attemptsLeft: statusData.attemptsLeft ?? Math.max(0, 3 - (statusData.attemptsUsed ?? 0)),
      countryName: statusData.countryName || null,
    };
    renderFlagUI();
  } catch (e) {
    statusEl.textContent = 'Fejl ved indlæsning.';
    return;
  }

  async function submitGuess() {
    const guess = (inputEl.value || '').trim();
    if (!guess) return;
    submitBtn.disabled = true;
    feedbackEl.hidden = false;
    feedbackEl.textContent = 'Tjekker…';
    feedbackEl.className = 'flag-feedback';
    try {
      const res = await api('/api/games/flag/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guess }),
      });
      const data = await res.json().catch(() => ({}));

      if (data.correct) {
        state.won = true;
        state.countryName = data.countryName || null;
        renderFlagUI();
        return;
      }

      if (data.invalidGuess) {
        feedbackEl.textContent = data.message || 'Det er ikke et land fra listen. Brug det officielle engelske navn.';
        feedbackEl.className = 'flag-feedback flag-feedback-wrong';
        submitBtn.disabled = false;
        return;
      }

      state.attemptsUsed = 3 - (data.attemptsLeft ?? 0);
      state.attemptsLeft = data.attemptsLeft ?? 0;
      state.lost = !!data.noMoreAttempts;
      if (data.noMoreAttempts) state.countryName = data.countryName || null;

      if (state.lost) {
        renderFlagUI();
        return;
      }
      feedbackEl.textContent = 'Forkert. Du har ' + state.attemptsLeft + ' forsøg tilbage.';
      feedbackEl.className = 'flag-feedback flag-feedback-wrong';
      attemptsEl.textContent = 'Forsøg ' + (state.attemptsUsed + 1) + '/3 – du har ' + state.attemptsLeft + ' forsøg tilbage.';
      submitBtn.disabled = false;
    } catch (e) {
      feedbackEl.textContent = 'Der opstod en fejl.';
      feedbackEl.className = 'flag-feedback';
      submitBtn.disabled = false;
    }
  }

  submitBtn.addEventListener('click', submitGuess);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitGuess();
  });
}

// ---------- Init ----------
async function init() {
  await loadUser();
  loadWordle();
  await initFlagGame();
}

init();
