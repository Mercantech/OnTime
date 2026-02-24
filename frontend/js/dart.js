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

  let state = {
    players: [],
    currentIndex: 0,
    gameOver: false
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
      gameOver: false
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

  function render() {
    if (!scoreboardEl) return;

    scoreboardEl.innerHTML = state.players.map(function (p, i) {
      const isActive = !state.gameOver && i === state.currentIndex;
      const isBust = p.score < 0;
      const classes = 'dart-score-card' + (isActive ? ' is-active' : '') + (isBust ? ' is-bust' : '');
      return '<div class="' + classes + '" data-index="' + i + '">' +
        '<div class="dart-score-name">' + escapeHtml(p.name) + '</div>' +
        '<div class="dart-score-value">' + Math.max(0, p.score) + '</div>' +
        '</div>';
    }).join('');

    if (state.gameOver) {
      currentNameEl.textContent = '';
      turnArea.hidden = true;
      return;
    }

    const current = state.players[state.currentIndex];
    currentNameEl.textContent = current.name;
    whoseTurnEl.hidden = false;
    turnArea.hidden = false;
    scoreInput.focus();
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
    state = { players: [], currentIndex: 0, gameOver: false };
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
})();
