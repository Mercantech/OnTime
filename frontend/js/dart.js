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
  const clickBoardEl = document.getElementById('dart-click-board');
  const clickStatusEl = document.getElementById('dart-click-status');
  const clickTotalEl = document.getElementById('dart-click-total');
  const clickUseBtn = document.getElementById('dart-click-use-btn');
  const clickResetBtn = document.getElementById('dart-click-reset-btn');

  var clickRound = [];

  var BOARD_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

  function buildClickBoard() {
    if (!clickBoardEl) return;
    var cx = 100, cy = 100;
    var rBull = 6, rBullOut = 12, rTriple = 32, rSingle = 82, rDouble = 98;
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 200 200');
    svg.setAttribute('class', 'dart-board-svg');
    svg.setAttribute('focusable', 'false');

    function deg2rad(d) { return d * Math.PI / 180; }
    function polar(angleDeg, r) {
      var a = deg2rad(angleDeg - 90);
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    }

    function wedgePath(rIn, rOut, a0, a1) {
      var p0 = polar(a0, rIn), p1 = polar(a0, rOut), p2 = polar(a1, rOut), p3 = polar(a1, rIn);
      return 'M ' + p0.x + ' ' + p0.y + ' L ' + p1.x + ' ' + p1.y + ' A ' + rOut + ' ' + rOut + ' 0 0 1 ' + p2.x + ' ' + p2.y + ' L ' + p3.x + ' ' + p3.y + ' A ' + rIn + ' ' + rIn + ' 0 0 0 ' + p0.x + ' ' + p0.y + ' Z';
    }
    var ringLabels = ['triple', 'single', 'double'];
    var ringTitles = ['T', 'Single ', 'D'];
    for (var i = 0; i < 20; i++) {
      var a0 = i * 18, a1 = (i + 1) * 18;
      var seg = BOARD_ORDER[i];
      var green = (i % 2) === 0;
      var fill = green ? '#1a472a' : '#c41e3a';
      ringLabels.forEach(function (ring, idx) {
        var rIn = idx === 0 ? rBullOut : (idx === 1 ? rTriple : rSingle);
        var rOut = idx === 0 ? rTriple : (idx === 1 ? rSingle : rDouble);
        var pts = idx === 0 ? seg * 3 : (idx === 1 ? seg : seg * 2);
        var title = ringTitles[idx] + seg + ' = ' + pts;
        var path = document.createElementNS(ns, 'path');
        path.setAttribute('d', wedgePath(rIn, rOut, a0, a1));
        path.setAttribute('fill', fill);
        path.setAttribute('stroke', '#2d5a3d');
        path.setAttribute('stroke-width', '0.5');
        path.setAttribute('title', title);
        svg.appendChild(path);
      });
    }

    var bullOut = document.createElementNS(ns, 'circle');
    bullOut.setAttribute('cx', cx);
    bullOut.setAttribute('cy', cy);
    bullOut.setAttribute('r', rBullOut);
    bullOut.setAttribute('fill', '#c41e3a');
    bullOut.setAttribute('stroke', '#2d5a3d');
    bullOut.setAttribute('stroke-width', '0.5');
    bullOut.setAttribute('title', 'Bull = 25');
    svg.appendChild(bullOut);
    var bullIn = document.createElementNS(ns, 'circle');
    bullIn.setAttribute('cx', cx);
    bullIn.setAttribute('cy', cy);
    bullIn.setAttribute('r', rBull);
    bullIn.setAttribute('fill', '#8b0000');
    bullIn.setAttribute('stroke', '#2d5a3d');
    bullIn.setAttribute('stroke-width', '0.5');
    bullIn.setAttribute('title', 'Dobbel bull = 50');
    svg.appendChild(bullIn);

    for (var i = 0; i < 20; i++) {
      var a = i * 18 - 90;
      var rad = deg2rad(a);
      var x2 = cx + rDouble * Math.cos(rad), y2 = cy + rDouble * Math.sin(rad);
      var line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', cx);
      line.setAttribute('y1', cy);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      line.setAttribute('stroke', '#1a1a1a');
      line.setAttribute('stroke-width', '0.8');
      svg.appendChild(line);
    }

    clickBoardEl.innerHTML = '';
    clickBoardEl.appendChild(svg);

    svg.addEventListener('click', function (e) {
      var rect = clickBoardEl.getBoundingClientRect();
      var x = (e.clientX - rect.left) / rect.width * 200;
      var y = (e.clientY - rect.top) / rect.height * 200;
      var dx = x - cx, dy = y - cy;
      var r = Math.sqrt(dx * dx + dy * dy);
      if (r > rDouble + 2) return;
      if (clickRound.length >= 3) return;

      var angleDeg = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
      var segIndex = Math.floor(angleDeg / 18) % 20;
      var segment = BOARD_ORDER[segIndex];
      var rNorm = r / rDouble;
      var mult, pts;
      if (rNorm < rBull / rDouble) {
        pts = 50;
      } else if (rNorm < rBullOut / rDouble) {
        pts = 25;
      } else if (rNorm < rTriple / rDouble) {
        pts = segment * 3;
      } else if (rNorm < rSingle / rDouble) {
        pts = segment;
      } else {
        pts = segment * 2;
      }
      clickRound.push(pts);
      updateClickBoardDisplay();
    });
  }

  function updateClickBoardDisplay() {
    var p1El = document.getElementById('dart-click-p1');
    var p2El = document.getElementById('dart-click-p2');
    var p3El = document.getElementById('dart-click-p3');
    var totalEl = document.getElementById('dart-click-total');
    if (!p1El || !totalEl) return;
    var a = clickRound[0], b = clickRound[1], c = clickRound[2];
    p1El.textContent = a !== undefined ? a : '–';
    if (p2El) p2El.textContent = b !== undefined ? b : '–';
    if (p3El) p3El.textContent = c !== undefined ? c : '–';
    var total = clickRound.reduce(function (sum, p) { return sum + p; }, 0);
    totalEl.textContent = total;
  }

  function useClickTotal() {
    if (!scoreInput) return;
    var total = clickRound.reduce(function (sum, p) { return sum + p; }, 0);
    scoreInput.value = total;
    scoreInput.focus();
  }

  function resetClickRound() {
    clickRound = [];
    updateClickBoardDisplay();
  }

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
  buildClickBoard();
  if (helperUseBtn) helperUseBtn.addEventListener('click', useHelperTotal);
  if (clickUseBtn) clickUseBtn.addEventListener('click', useClickTotal);
  if (clickResetBtn) clickResetBtn.addEventListener('click', resetClickRound);
})();
