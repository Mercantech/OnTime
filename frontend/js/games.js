const token = localStorage.getItem('ontime_token');
if (!token) {
  window.location.href = '/';
}

const api = (path, opts = {}) =>
  fetch(path, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${token}` },
  });

// ---------- Lyd og animation ved vundet/tabt spil ----------
let gameAudioCtx = null;
function getAudioCtx() {
  if (!gameAudioCtx) gameAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return gameAudioCtx;
}

function playTone(freq, startTime, duration, type) {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0.15, startTime);
  gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

function playGameWin() {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => playTone(freq, now + i * 0.12, 0.2, 'square'));
    showFireworks();
  } catch (e) {}
}

function playGameLose() {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    playTone(349, now, 0.25, 'square');
    playTone(262, now + 0.2, 0.35, 'square');
    playTone(175, now + 0.45, 0.4, 'square');
  } catch (e) {}
}

function showFireworks() {
  const wrap = document.createElement('div');
  wrap.className = 'game-fireworks-wrap';
  wrap.setAttribute('aria-hidden', 'true');
  document.body.appendChild(wrap);
  const colors = ['#22c55e', '#eab308', '#f97316', '#ec4899'];
  for (let b = 0; b < 3; b++) {
    setTimeout(() => {
      const cx = 0.2 + Math.random() * 0.6;
      const cy = 0.2 + Math.random() * 0.5;
      for (let i = 0; i < 24; i++) {
        const p = document.createElement('div');
        p.className = 'game-firework-particle';
        const angle = (i / 24) * Math.PI * 2 + Math.random() * 0.5;
        const dist = 80 + Math.random() * 60;
        const color = colors[Math.floor(Math.random() * colors.length)];
        const tx = Math.cos(angle) * dist;
        const ty = Math.sin(angle) * dist;
        p.style.cssText = `left:${cx * 100}%;top:${cy * 100}%;--tx:${tx}px;--ty:${ty}px;background:${color}`;
        wrap.appendChild(p);
      }
    }, b * 280);
  }
  setTimeout(() => wrap.remove(), 2200);
}

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
  // Tæl hvor mange af hvert bogstav der er tilbage i svaret (bruges til grøn, derefter gul)
  const answerCount = {};
  for (let i = 0; i < 5; i++) {
    const c = a[i];
    answerCount[c] = (answerCount[c] || 0) + 1;
  }
  // Først: markér korrekte (grøn) og brug dem i tælleren
  for (let i = 0; i < 5; i++) {
    if (g[i] === a[i]) {
      res[i] = 'correct';
      answerCount[g[i]]--;
    }
  }
  // Derefter: markér kun så mange gule pr. bogstav som svaret har (resten grå)
  for (let i = 0; i < 5; i++) {
    if (res[i] === 'correct') continue;
    const letter = g[i];
    if ((answerCount[letter] || 0) > 0) {
      res[i] = 'present';
      answerCount[letter]--;
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
    else if (state.status === 'lost') statusEl.textContent = 'Øv. Du har brugt alle forsøg. Lev i evig undren!';
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
      if (guess === state.answer) {
        state.status = 'won';
        persist();
        render();
        awardIfWin();
        playGameWin();
      } else if (state.guesses.length >= 6) {
        state.status = 'lost';
        persist();
        render();
        playGameLose();
      } else {
        persist();
        render();
      }
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

// ---------- Dagens flag (3 forsøg, state fra backend) + hovedstad (efter land) ----------
async function initFlagGame() {
  const statusEl = document.getElementById('flag-status');
  const wrapEl = document.getElementById('flag-wrap');
  const imgEl = document.getElementById('flag-img');
  const attemptsEl = document.getElementById('flag-attempts');
  const guessRowEl = document.getElementById('flag-guess-row');
  const inputEl = document.getElementById('flag-guess');
  const dropdownEl = document.getElementById('flag-dropdown');
  const submitBtn = document.getElementById('flag-submit');
  const feedbackEl = document.getElementById('flag-feedback');
  const capitalWrapEl = document.getElementById('flag-capital-wrap');
  const capitalStatusEl = document.getElementById('flag-capital-status');
  const capitalAttemptsEl = document.getElementById('flag-capital-attempts');
  const capitalGuessRowEl = document.getElementById('flag-capital-guess-row');
  const capitalInputEl = document.getElementById('flag-capital-guess');
  const capitalDropdownEl = document.getElementById('flag-capital-dropdown');
  const capitalSubmitBtn = document.getElementById('flag-capital-submit');
  const capitalFeedbackEl = document.getElementById('flag-capital-feedback');
  if (!statusEl || !wrapEl || !imgEl || !attemptsEl || !guessRowEl || !inputEl || !submitBtn || !feedbackEl) return;

  let state = {
    won: false,
    lost: false,
    attemptsUsed: 0,
    attemptsLeft: 3,
    countryName: null,
    hasCapitalStep: false,
    wonCapital: false,
    capitalLost: false,
    capitalAttemptsUsed: 0,
    capitalAttemptsLeft: 3,
    countryNameForCapital: null,
    capitalNameRevealed: null,
  };
  let countryOptions = [];
  let capitalOptions = [];
  let dropdownHighlight = -1;
  let capitalDropdownHighlight = -1;

  function renderFlagUI() {
    feedbackEl.hidden = true;
    if (capitalWrapEl) capitalWrapEl.hidden = true;
    if (state.won) {
      statusEl.textContent = 'Du har gættet dagens flag!';
      attemptsEl.hidden = true;
      guessRowEl.hidden = true;
      feedbackEl.hidden = false;
      if (state.wonCapital) {
        feedbackEl.textContent = 'Det var ' + (state.countryName || '') + '. Du fik 2 point for landet og 1 point for hovedstaden.';
      } else {
        feedbackEl.textContent = 'Det var ' + (state.countryName || '') + '. Du fik 2 point.';
      }
      feedbackEl.className = 'flag-feedback flag-feedback-correct';
      inputEl.disabled = true;
      submitBtn.disabled = true;
      if (state.hasCapitalStep && (state.wonCapital || state.capitalLost)) {
        if (capitalWrapEl) capitalWrapEl.hidden = false;
        if (capitalStatusEl) {
          capitalStatusEl.textContent = state.wonCapital
            ? 'Du gættede også hovedstaden!'
            : (state.capitalNameRevealed ? 'Ingen forsøg tilbage. Hovedstaden var ' + state.capitalNameRevealed + '.' : 'Ingen forsøg tilbage til hovedstad.');
        }
        if (capitalGuessRowEl) capitalGuessRowEl.hidden = true;
      } else if (state.hasCapitalStep && !state.wonCapital && !state.capitalLost) {
        if (capitalWrapEl) capitalWrapEl.hidden = false;
        if (capitalStatusEl) capitalStatusEl.textContent = 'Hvad er hovedstaden i ' + (state.countryNameForCapital || state.countryName || '') + '?';
        if (capitalAttemptsEl) {
          capitalAttemptsEl.hidden = false;
          capitalAttemptsEl.textContent = 'Forsøg ' + (state.capitalAttemptsUsed + 1) + '/3 – du har ' + state.capitalAttemptsLeft + ' forsøg tilbage.';
        }
        if (capitalGuessRowEl) capitalGuessRowEl.hidden = false;
        if (capitalInputEl) capitalInputEl.disabled = false;
        if (capitalSubmitBtn) capitalSubmitBtn.disabled = false;
        if (capitalFeedbackEl) capitalFeedbackEl.hidden = true;
      }
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
    const [flagRes, statusRes, countriesRes, capitalsRes] = await Promise.all([
      api('/api/games/daily-flag'),
      api('/api/games/flag/status'),
      api('/api/games/flag/countries'),
      api('/api/games/flag/capitals'),
    ]);
    const flagData = await flagRes.json().catch(() => ({}));
    const statusData = await statusRes.json().catch(() => ({}));
    const countriesList = await countriesRes.json().catch(() => []);
    const capitalsList = await capitalsRes.json().catch(() => []);

    countryOptions = countriesList.map((c) => {
      const value = c.name_da || c.name;
      const label = c.name_da && c.name_da !== c.name ? `${c.name_da} (${c.name})` : c.name;
      return { label, value };
    });
    capitalOptions = capitalsList.map((c) => {
      const capitalDa = c.capital_da || c.capital;
      const label = c.capital_da && c.capital_da !== c.capital ? capitalDa + ' (' + c.capital + ')' : capitalDa;
      return { label, value: capitalDa };
    });

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
      hasCapitalStep: !!statusData.hasCapitalStep,
      wonCapital: !!statusData.wonCapital,
      capitalLost: !!statusData.capitalLost,
      capitalAttemptsUsed: statusData.capitalAttemptsUsed ?? 0,
      capitalAttemptsLeft: statusData.capitalAttemptsLeft ?? Math.max(0, 3 - (statusData.capitalAttemptsUsed ?? 0)),
      countryNameForCapital: statusData.countryNameForCapital || null,
      capitalNameRevealed: statusData.capitalNameRevealed || null,
    };
    renderFlagUI();
  } catch (e) {
    statusEl.textContent = 'Fejl ved indlæsning.';
    return;
  }

  function hideDropdown() {
    if (dropdownEl) {
      dropdownEl.hidden = true;
      dropdownEl.innerHTML = '';
      dropdownHighlight = -1;
      inputEl.setAttribute('aria-expanded', 'false');
    }
  }

  function showDropdown(items) {
    if (!dropdownEl) return;
    dropdownEl.innerHTML = '';
    items.forEach((opt, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.textContent = opt.label;
      li.dataset.value = opt.value;
      li.className = 'flag-dropdown-item';
      if (i === dropdownHighlight) li.classList.add('flag-dropdown-item-active');
      li.addEventListener('click', () => {
        inputEl.value = opt.value;
        hideDropdown();
        inputEl.focus();
      });
      dropdownEl.appendChild(li);
    });
    dropdownEl.hidden = items.length === 0;
    inputEl.setAttribute('aria-expanded', items.length > 0 ? 'true' : 'false');
  }

  function filterAndShowDropdown() {
    if (inputEl.disabled) { hideDropdown(); return; }
    const q = (inputEl.value || '').trim().toLowerCase();
    if (!q) {
      showDropdown(countryOptions.slice(0, 12));
      dropdownHighlight = 0;
      return;
    }
    const filtered = countryOptions.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    );
    dropdownHighlight = filtered.length > 0 ? 0 : -1;
    showDropdown(filtered.slice(0, 20));
    if (dropdownEl && !dropdownEl.hidden) {
      const items = dropdownEl.querySelectorAll('.flag-dropdown-item');
      items.forEach((el, i) => el.classList.toggle('flag-dropdown-item-active', i === dropdownHighlight));
    }
  }

  function selectHighlighted() {
    const items = dropdownEl.querySelectorAll('.flag-dropdown-item');
    if (dropdownHighlight >= 0 && items[dropdownHighlight]) {
      inputEl.value = items[dropdownHighlight].dataset.value || '';
      hideDropdown();
      return true;
    }
    return false;
  }

  if (dropdownEl) {
    inputEl.addEventListener('focus', filterAndShowDropdown);
    inputEl.addEventListener('input', filterAndShowDropdown);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideDropdown();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const items = dropdownEl.querySelectorAll('.flag-dropdown-item');
        if (items.length === 0) return;
        dropdownHighlight = (dropdownHighlight + 1) % items.length;
        items.forEach((el, i) => el.classList.toggle('flag-dropdown-item-active', i === dropdownHighlight));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const items = dropdownEl.querySelectorAll('.flag-dropdown-item');
        if (items.length === 0) return;
        dropdownHighlight = dropdownHighlight <= 0 ? items.length - 1 : dropdownHighlight - 1;
        items.forEach((el, i) => el.classList.toggle('flag-dropdown-item-active', i === dropdownHighlight));
        return;
      }
      if (e.key === 'Enter') {
        if (dropdownEl && !dropdownEl.hidden && selectHighlighted()) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        submitGuess();
        return;
      }
    });
    document.addEventListener('click', (e) => {
      if (inputEl.disabled) return;
      const wrap = inputEl.closest('.flag-combobox-wrap');
      if (wrap && !wrap.contains(e.target)) hideDropdown();
    });
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
        state.countryNameForCapital = data.countryName || null;
        renderFlagUI();
        playGameWin();
        return;
      }

      if (data.invalidGuess) {
        feedbackEl.textContent = data.message || 'Det er ikke et land fra listen. Vælg eller skriv et land fra listen (dansk eller engelsk).';
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
        playGameLose();
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

  // ---------- Hovedstad (samme dropdown-oplevelse) ----------
  function hideCapitalDropdown() {
    if (capitalDropdownEl) {
      capitalDropdownEl.hidden = true;
      capitalDropdownEl.innerHTML = '';
      capitalDropdownHighlight = -1;
      if (capitalInputEl) capitalInputEl.setAttribute('aria-expanded', 'false');
    }
  }

  function showCapitalDropdown(items) {
    if (!capitalDropdownEl) return;
    capitalDropdownEl.innerHTML = '';
    items.forEach((opt, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.textContent = opt.label;
      li.dataset.value = opt.value;
      li.className = 'flag-dropdown-item';
      if (i === capitalDropdownHighlight) li.classList.add('flag-dropdown-item-active');
      li.addEventListener('click', () => {
        capitalInputEl.value = opt.value;
        hideCapitalDropdown();
        capitalInputEl.focus();
      });
      capitalDropdownEl.appendChild(li);
    });
    capitalDropdownEl.hidden = items.length === 0;
    if (capitalInputEl) capitalInputEl.setAttribute('aria-expanded', items.length > 0 ? 'true' : 'false');
  }

  function filterCapitalDropdown() {
    if (!capitalInputEl || capitalInputEl.disabled) { hideCapitalDropdown(); return; }
    const q = (capitalInputEl.value || '').trim().toLowerCase();
    if (!q) {
      showCapitalDropdown(capitalOptions.slice(0, 12));
      capitalDropdownHighlight = 0;
      return;
    }
    const filtered = capitalOptions.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    );
    capitalDropdownHighlight = filtered.length > 0 ? 0 : -1;
    showCapitalDropdown(filtered.slice(0, 20));
    if (capitalDropdownEl && !capitalDropdownEl.hidden) {
      const items = capitalDropdownEl.querySelectorAll('.flag-dropdown-item');
      items.forEach((el, i) => el.classList.toggle('flag-dropdown-item-active', i === capitalDropdownHighlight));
    }
  }

  function selectHighlightedCapital() {
    const items = capitalDropdownEl.querySelectorAll('.flag-dropdown-item');
    if (capitalDropdownHighlight >= 0 && items[capitalDropdownHighlight]) {
      capitalInputEl.value = items[capitalDropdownHighlight].dataset.value || '';
      hideCapitalDropdown();
      return true;
    }
    return false;
  }

  async function submitCapitalGuess() {
    if (!capitalInputEl || !capitalSubmitBtn) return;
    const guess = (capitalInputEl.value || '').trim();
    if (!guess) return;
    capitalSubmitBtn.disabled = true;
    if (capitalFeedbackEl) {
      capitalFeedbackEl.hidden = false;
      capitalFeedbackEl.textContent = 'Tjekker…';
      capitalFeedbackEl.className = 'flag-feedback';
    }
    try {
      const res = await api('/api/games/flag/capital/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guess }),
      });
      const data = await res.json().catch(() => ({}));

      if (data.correct) {
        state.wonCapital = true;
        state.capitalAttemptsLeft = 0;
        if (capitalFeedbackEl) {
          capitalFeedbackEl.textContent = 'Rigtigt! Hovedstaden er ' + (data.capitalName || '') + '. Du fik 1 point ekstra.';
          capitalFeedbackEl.className = 'flag-feedback flag-feedback-correct';
        }
        if (capitalGuessRowEl) capitalGuessRowEl.hidden = true;
        if (capitalAttemptsEl) capitalAttemptsEl.hidden = true;
        renderFlagUI();
        playGameWin();
        return;
      }

      if (data.invalidGuess) {
        if (capitalFeedbackEl) {
          capitalFeedbackEl.textContent = data.message || 'Vælg eller skriv en hovedstad fra listen.';
          capitalFeedbackEl.className = 'flag-feedback flag-feedback-wrong';
        }
        capitalSubmitBtn.disabled = false;
        return;
      }

      state.capitalAttemptsUsed = 3 - (data.attemptsLeft ?? 0);
      state.capitalAttemptsLeft = data.attemptsLeft ?? 0;
      state.capitalLost = !!data.noMoreAttempts;
      if (state.capitalLost && data.capitalName) state.capitalAttemptsUsed = 3;

      if (state.capitalLost) {
        if (capitalFeedbackEl) {
          capitalFeedbackEl.textContent = 'Ingen forsøg tilbage. Hovedstaden var ' + (data.capitalName || '') + '.';
          capitalFeedbackEl.className = 'flag-feedback flag-feedback-wrong';
        }
        if (capitalGuessRowEl) capitalGuessRowEl.hidden = true;
        renderFlagUI();
        return;
      }
      if (capitalFeedbackEl) {
        capitalFeedbackEl.textContent = 'Forkert. Du har ' + state.capitalAttemptsLeft + ' forsøg tilbage.';
        capitalFeedbackEl.className = 'flag-feedback flag-feedback-wrong';
      }
      if (capitalAttemptsEl) {
        capitalAttemptsEl.textContent = 'Forsøg ' + (state.capitalAttemptsUsed + 1) + '/3 – du har ' + state.capitalAttemptsLeft + ' forsøg tilbage.';
      }
      capitalSubmitBtn.disabled = false;
    } catch (e) {
      if (capitalFeedbackEl) {
        capitalFeedbackEl.textContent = 'Der opstod en fejl.';
        capitalFeedbackEl.className = 'flag-feedback';
      }
      capitalSubmitBtn.disabled = false;
    }
  }

  if (capitalInputEl && capitalDropdownEl) {
    capitalInputEl.addEventListener('focus', filterCapitalDropdown);
    capitalInputEl.addEventListener('input', filterCapitalDropdown);
    capitalInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideCapitalDropdown();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const items = capitalDropdownEl.querySelectorAll('.flag-dropdown-item');
        if (items.length === 0) return;
        capitalDropdownHighlight = (capitalDropdownHighlight + 1) % items.length;
        items.forEach((el, i) => el.classList.toggle('flag-dropdown-item-active', i === capitalDropdownHighlight));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const items = capitalDropdownEl.querySelectorAll('.flag-dropdown-item');
        if (items.length === 0) return;
        capitalDropdownHighlight = capitalDropdownHighlight <= 0 ? items.length - 1 : capitalDropdownHighlight - 1;
        items.forEach((el, i) => el.classList.toggle('flag-dropdown-item-active', i === capitalDropdownHighlight));
        return;
      }
      if (e.key === 'Enter') {
        if (!capitalDropdownEl.hidden && selectHighlightedCapital()) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        submitCapitalGuess();
        return;
      }
    });
    document.addEventListener('click', (e) => {
      const wrap = capitalInputEl.closest('.flag-combobox-wrap');
      if (wrap && !wrap.contains(e.target)) hideCapitalDropdown();
    });
  }
  if (capitalSubmitBtn) capitalSubmitBtn.addEventListener('click', submitCapitalGuess);
}

// ---------- Sudoku (dagligt 6×6, timer, leaderboard på tid) ----------
const SUDOKU_CELLS = 36;
const SUDOKU_COLS = 6;
const SUDOKU_MAX_NUM = 6;

async function initSudoku() {
  const statusEl = document.getElementById('sudoku-status');
  const gameWrap = document.getElementById('sudoku-game');
  const doneWrap = document.getElementById('sudoku-done');
  const doneMsgEl = document.getElementById('sudoku-done-msg');
  const gridWrap = document.getElementById('sudoku-grid-wrap');
  const timerEl = document.getElementById('sudoku-timer');
  const checkBtn = document.getElementById('sudoku-check');
  const feedbackEl = document.getElementById('sudoku-feedback');
  const leaderboardList = document.getElementById('sudoku-leaderboard');
  const numpadEl = document.getElementById('sudoku-numpad');
  const numpadLabelEl = document.getElementById('sudoku-numpad-label');
  if (!statusEl || !gameWrap || !gridWrap || !timerEl || !checkBtn) return;

  let given = [];
  let values = []; // 36 tal, 0 = tomt (kopi af given + brugerens indtastninger)
  let selectedIndex = null;
  let timerStartedAt = null;
  let timerInterval = null;

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function startTimer() {
    if (timerStartedAt) return;
    timerStartedAt = Date.now();
    timerInterval = setInterval(() => {
      if (!timerEl) return;
      const elapsed = Math.floor((Date.now() - timerStartedAt) / 1000);
      timerEl.textContent = formatTime(elapsed);
    }, 1000);
    timerEl.textContent = '0:00';
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function getElapsedSeconds() {
    return timerStartedAt ? Math.floor((Date.now() - timerStartedAt) / 1000) : 0;
  }

  function selectCell(i) {
    if (given[i]) return;
    startTimer();
    selectedIndex = i;
    gridWrap.querySelectorAll('.sudoku-cell').forEach((el, idx) => {
      el.classList.toggle('selected', idx === i);
      el.setAttribute('aria-selected', idx === i ? 'true' : 'false');
    });
    if (numpadLabelEl) numpadLabelEl.textContent = 'Vælg et tal 1–6 nedenfor';
  }

  function setCellValue(n) {
    if (selectedIndex == null || given[selectedIndex]) return;
    if (n < 1 || n > SUDOKU_MAX_NUM) return;
    values[selectedIndex] = n;
    const cellEl = gridWrap.querySelector('[data-index="' + selectedIndex + '"]');
    if (cellEl) cellEl.textContent = n;
  }

  function clearCell() {
    if (selectedIndex == null || given[selectedIndex]) return;
    values[selectedIndex] = 0;
    const cellEl = gridWrap.querySelector('[data-index="' + selectedIndex + '"]');
    if (cellEl) cellEl.textContent = '';
  }

  function buildGrid() {
    gridWrap.innerHTML = '';
    for (let i = 0; i < SUDOKU_CELLS; i++) {
      const row = Math.floor(i / SUDOKU_COLS);
      const col = i % SUDOKU_COLS;
      const box = Math.floor(row / 2) * 3 + Math.floor(col / 3);
      const cell = document.createElement('div');
      cell.className = 'sudoku-cell' + (given[i] ? ' given' : ' editable');
      cell.setAttribute('data-index', i);
      cell.setAttribute('data-row', row);
      cell.setAttribute('data-col', col);
      cell.setAttribute('data-box', box);
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-selected', 'false');
      if (given[i]) {
        cell.textContent = given[i];
        cell.setAttribute('aria-label', 'Fast felt ' + given[i]);
      } else {
        cell.textContent = values[i] || '';
        cell.setAttribute('aria-label', 'Felt række ' + (row + 1) + ' kolonne ' + (col + 1) + (values[i] ? ', værdi ' + values[i] : ', tom'));
        cell.addEventListener('click', () => selectCell(i));
      }
      gridWrap.appendChild(cell);
    }
  }

  function getGrid() {
    return values.slice();
  }

  try {
    const [puzzleRes, statusRes] = await Promise.all([
      api('/api/games/sudoku/puzzle'),
      api('/api/games/sudoku/status'),
    ]);
    const puzzleData = await puzzleRes.json().catch(() => ({}));
    const statusData = await statusRes.json().catch(() => ({}));

    if (!puzzleRes.ok) {
      statusEl.textContent = puzzleData.error || 'Kunne ikke hente dagens Sudoku.';
      return;
    }

    if (statusData.completed) {
      statusEl.hidden = true;
      doneWrap.hidden = false;
      const sec = statusData.timeSeconds;
      doneMsgEl.textContent = 'Du har allerede løst dagens Sudoku. Tid: ' + (sec != null ? formatTime(sec) : '–');
      const lbRes = await api('/api/leaderboard/sudoku');
      const lbData = await lbRes.json().catch(() => ({}));
      if (lbData.leaderboard && lbData.leaderboard.length) {
        leaderboardList.innerHTML = lbData.leaderboard.map((s) =>
          '<li><span class="rank">' + s.rank + '.</span> ' + escapeHtml(s.name) + ' – ' + formatTime(s.timeSeconds) + '</li>'
        ).join('');
      } else {
        leaderboardList.innerHTML = '<li class="muted">Ingen rangering endnu</li>';
      }
      return;
    }

    given = Array.isArray(puzzleData.given) ? puzzleData.given : [];
    if (given.length !== SUDOKU_CELLS) {
      statusEl.textContent = 'Kunne ikke hente dagens Sudoku.';
      return;
    }
    values = given.slice();

    statusEl.hidden = true;
    gameWrap.hidden = false;
    buildGrid();

    if (numpadEl) {
      numpadEl.querySelectorAll('.sudoku-num-btn').forEach((btn) => {
        const n = parseInt(btn.dataset.num, 10);
        btn.addEventListener('click', () => {
          setCellValue(n);
        });
      });
    }

    document.addEventListener('keydown', (e) => {
      if (selectedIndex == null) return;
      if (e.key >= '1' && e.key <= '6') {
        setCellValue(parseInt(e.key, 10));
        e.preventDefault();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        clearCell();
        e.preventDefault();
      }
    });

    checkBtn.addEventListener('click', async () => {
      const grid = getGrid();
      const hasEmpty = grid.some((v) => v === 0);
      if (hasEmpty) {
        feedbackEl.hidden = false;
        feedbackEl.className = 'sudoku-feedback error';
        feedbackEl.textContent = 'Udfyld alle felter med tallene 1–6.';
        return;
      }
      checkBtn.disabled = true;
      feedbackEl.hidden = false;
      feedbackEl.textContent = 'Tjekker…';
      feedbackEl.className = 'sudoku-feedback';
      stopTimer();
      const timeSeconds = getElapsedSeconds();
      try {
        const res = await api('/api/games/sudoku/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grid, timeSeconds }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          playGameWin();
          gameWrap.hidden = true;
          doneWrap.hidden = false;
          doneMsgEl.textContent = 'Korrekt! Du løste det på ' + formatTime(timeSeconds) + '. Du fik 2 point.';
          const lbRes = await api('/api/leaderboard/sudoku');
          const lbData = await lbRes.json().catch(() => ({}));
          if (lbData.leaderboard && lbData.leaderboard.length) {
            leaderboardList.innerHTML = lbData.leaderboard.map((s) =>
              '<li><span class="rank">' + s.rank + '.</span> ' + escapeHtml(s.name) + ' – ' + formatTime(s.timeSeconds) + '</li>'
            ).join('');
          } else {
            leaderboardList.innerHTML = '<li class="muted">Ingen rangering endnu</li>';
          }
          return;
        }
        feedbackEl.className = 'sudoku-feedback error';
        feedbackEl.textContent = data.error || 'Løsningen var ikke korrekt.';
        checkBtn.disabled = false;
      } catch (e) {
        feedbackEl.className = 'sudoku-feedback error';
        feedbackEl.textContent = 'Der opstod en fejl.';
        checkBtn.disabled = false;
      }
    });
  } catch (e) {
    statusEl.textContent = 'Fejl ved indlæsning.';
  }
}

// ---------- Init (kun det spil der matcher URL) ----------
async function init() {
  await loadUser();
  const pathname = window.location.pathname;
  if (pathname.includes('/spil/wordle')) {
    loadWordle();
  } else if (pathname.includes('/spil/flag')) {
    await initFlagGame();
  } else if (pathname.includes('/spil/sudoku')) {
    await initSudoku();
  }
  // /spil = kun oversigt, ingen spil at starte
}

init();
