(function () {
  const START_SCORE = 501;

  const setupEl = document.getElementById('dart-setup');
  const gameEl = document.getElementById('dart-game');
  const nameInputs = [
    document.getElementById('dart-name-1'),
    document.getElementById('dart-name-2'),
    document.getElementById('dart-name-3'),
    document.getElementById('dart-name-4')
  ];
  const startBtn = document.getElementById('dart-start-btn');
  const setupError = document.getElementById('dart-setup-error');
  const scoreboardEl = document.getElementById('dart-scoreboard');
  const whoseTurnEl = document.getElementById('dart-whose-turn');
  const currentNameEl = document.getElementById('dart-current-name');
  const scoreInput = document.getElementById('dart-score-input');
  const registerBtn = document.getElementById('dart-register-btn');
  const bustMsg = document.getElementById('dart-bust-msg');
  const turnArea = document.getElementById('dart-turn-area');
  const winnerEl = document.getElementById('dart-winner');
  const winnerNameEl = document.getElementById('dart-winner-name');
  const newGameBtn = document.getElementById('dart-new-game-btn');
  const resetBtn = document.getElementById('dart-reset-btn');

  const rankingListEl = document.getElementById('dart-ranking-list');
  const helperDartsEl = document.getElementById('dart-helper-darts');
  const helperTotalEl = document.getElementById('dart-helper-total');
  const helperUseBtn = document.getElementById('dart-helper-use-btn');

  function buildHelperDarts() {
    if (!helperDartsEl) return;
    var segments = [];
    for (var i = 1; i <= 20; i++) segments.push({ value: i, label: '' + i });
    segments.push({ value: 25, label: 'Bull' });
    var html = '';
    for (var d = 0; d < 3; d++) {
      html += '<div class="dart-helper-row">';
      html += '<label class="dart-helper-label">Pil ' + (d + 1) + '</label>';
      html += '<select class="dart-helper-segment" data-dart="' + d + '" aria-label="Segment pil ' + (d + 1) + '">';
      segments.forEach(function (s) {
        html += '<option value="' + s.value + '">' + s.label + '</option>';
      });
      html += '</select>';
      html += '<select class="dart-helper-type" data-dart="' + d + '" aria-label="Single/double/triple pil ' + (d + 1) + '">';
      html += '<option value="1">S (single)</option><option value="2">D (double)</option><option value="3">T (triple)</option>';
      html += '</select>';
      html += '<span class="dart-helper-points" data-dart="' + d + '">0</span>';
      html += '</div>';
    }
    helperDartsEl.innerHTML = html;
    helperDartsEl.querySelectorAll('.dart-helper-segment, .dart-helper-type').forEach(function (el) {
      el.addEventListener('change', updateHelperTotal);
    });
  }

  function pointsForDart(segmentValue, typeMultiplier) {
    if (segmentValue === 25 && typeMultiplier === 3) return 0;
    return segmentValue * typeMultiplier;
  }

  function updateHelperTotal() {
    if (!helperDartsEl || !helperTotalEl) return;
    var total = 0;
    for (var d = 0; d < 3; d++) {
      var row = helperDartsEl.querySelector('.dart-helper-row:nth-child(' + (d + 1) + ')');
      if (!row) continue;
      var seg = parseInt(row.querySelector('.dart-helper-segment').value, 10);
      var mult = parseInt(row.querySelector('.dart-helper-type').value, 10);
      var pts = pointsForDart(seg, mult);
      total += pts;
      var ptsEl = row.querySelector('.dart-helper-points');
      if (ptsEl) ptsEl.textContent = pts;
    }
    helperTotalEl.textContent = total;
  }

  function useHelperTotal() {
    if (!helperTotalEl || !scoreInput) return;
    var total = parseInt(helperTotalEl.textContent, 10);
    if (!isNaN(total)) {
      scoreInput.value = total;
      scoreInput.focus();
    }
  }

  let state = {
    players: [],
    currentIndex: 0,
    gameOver: false,
    finishedOrder: []
  };

  function getPlayerNames() {
    return nameInputs.map(function (input) {
      return (input && input.value) ? input.value.trim() : '';
    }).filter(Boolean);
  }

  function startGame() {
    const names = getPlayerNames();
    if (names.length < 2) {
      setupError.textContent = 'Tilføj mindst 2 spillere.';
      setupError.hidden = false;
      return;
    }
    setupError.hidden = true;
    state = {
      players: names.map(function (name) { return { name: name, score: START_SCORE }; }),
      currentIndex: 0,
      gameOver: false,
      finishedOrder: []
    };
    setupEl.hidden = true;
    gameEl.hidden = false;
    winnerEl.hidden = true;
    turnArea.hidden = false;
    bustMsg.hidden = true;
    scoreInput.value = '';
    scoreInput.focus();
    render();
  }

  function getRemainingPlayerIndices() {
    return state.players.map(function (_, i) { return i; }).filter(function (i) {
      return state.finishedOrder.indexOf(i) === -1;
    });
  }

  function render() {
    if (!scoreboardEl) return;

    scoreboardEl.innerHTML = state.players.map(function (p, i) {
      const isActive = !state.gameOver && i === state.currentIndex;
      const isBust = p.score < 0;
      const place = state.finishedOrder.indexOf(i);
      const placeLabel = place === -1 ? '' : (place + 1) + '. plads';
      const classes = 'dart-score-card' + (isActive ? ' is-active' : '') + (isBust ? ' is-bust' : '') + (place !== -1 ? ' is-finished' : '');
      return '<div class="' + classes + '" data-index="' + i + '">' +
        '<div class="dart-score-name">' + escapeHtml(p.name) + (placeLabel ? ' <span class="dart-score-place">' + placeLabel + '</span>' : '') + '</div>' +
        '<div class="dart-score-value">' + Math.max(0, p.score) + '</div>' +
        '</div>';
    }).join('');

    if (state.gameOver) {
      currentNameEl.textContent = '';
      turnArea.hidden = true;
      renderRanking();
      return;
    }

    const current = state.players[state.currentIndex];
    currentNameEl.textContent = current.name;
    whoseTurnEl.hidden = false;
    turnArea.hidden = false;
    scoreInput.focus();
  }

  function renderRanking() {
    if (!rankingListEl) return;
    const order = state.finishedOrder.slice();
    const remaining = getRemainingPlayerIndices();
    if (remaining.length === 1) {
      order.push(remaining[0]);
    }
    rankingListEl.innerHTML = order.map(function (playerIndex, i) {
      const name = state.players[playerIndex].name;
      const isLast = i === order.length - 1 && remaining.length === 1;
      const label = isLast ? 'Sidste plads' : (i + 1) + '. plads';
      return '<li class="dart-ranking-item"><span class="dart-ranking-place">' + label + '</span> ' + escapeHtml(name) + '</li>';
    }).join('');
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function registerScore() {
    if (state.gameOver) return;

    const raw = scoreInput.value.trim();
    const points = parseInt(raw, 10);
    if (raw === '' || isNaN(points) || points < 0 || points > 180) {
      scoreInput.focus();
      return;
    }

    const p = state.players[state.currentIndex];
    const newScore = p.score - points;
    bustMsg.hidden = true;

    if (newScore < 0) {
      bustMsg.hidden = false;
      nextPlayer();
      scoreInput.value = '';
      scoreInput.focus();
      render();
      return;
    }

    p.score = newScore;
    scoreInput.value = '';
    scoreInput.focus();

    if (newScore === 0) {
      state.gameOver = true;
      winnerNameEl.textContent = p.name;
      winnerEl.hidden = false;
      turnArea.hidden = true;
    } else {
      nextPlayer();
    }
    render();
  }

  function nextPlayer() {
    state.currentIndex = (state.currentIndex + 1) % state.players.length;
  }

  function backToSetup() {
    setupEl.hidden = false;
    gameEl.hidden = true;
    state = { players: [], currentIndex: 0, gameOver: false, finishedOrder: [] };
  }

  if (startBtn) startBtn.addEventListener('click', startGame);

  if (registerBtn) registerBtn.addEventListener('click', registerScore);

  if (scoreInput) {
    scoreInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') registerScore();
    });
  }

  if (newGameBtn) newGameBtn.addEventListener('click', backToSetup);
  if (resetBtn) resetBtn.addEventListener('click', backToSetup);

  buildHelperDarts();
  if (helperUseBtn) helperUseBtn.addEventListener('click', useHelperTotal);
})();
