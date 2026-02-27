(function () {
  const ROLL_LABELS = {
    roll_of_cheers: 'Roll of Cheers',
    meyer: 'Meyer',
    little_meyer: 'Little Meyer',
    pair_66: 'Par 6',
    pair_55: 'Par 5',
    pair_44: 'Par 4',
    pair_33: 'Par 3',
    pair_22: 'Par 2',
    pair_11: 'Par 1',
  };

  function rollToLabel(high, low) {
    if (high === 3 && low === 2) return ROLL_LABELS.roll_of_cheers;
    if (high === 2 && low === 1) return ROLL_LABELS.meyer;
    if (high === 3 && low === 1) return ROLL_LABELS.little_meyer;
    if (high === low) return ROLL_LABELS['pair_' + high + high] || 'Par ' + high;
    return high + '' + low;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function createDieFace(value) {
    const div = document.createElement('div');
    div.className = value == null ? 'meyer-die hidden' : 'meyer-die face-' + value;
    if (value == null) {
      const q = document.createElement('span');
      q.className = 'meyer-die-question';
      q.textContent = '?';
      div.appendChild(q);
    } else {
      for (let i = 0; i < 9; i++) {
        const dot = document.createElement('span');
        dot.className = 'meyer-die-dot';
        div.appendChild(dot);
      }
    }
    return div;
  }

  const lobbyEl = document.getElementById('meyer-lobby');
  const lobbyActionsEl = document.getElementById('meyer-lobby-actions');
  const gameEl = document.getElementById('meyer-game');
  const createBtn = document.getElementById('meyer-create-btn');
  const joinCodeInput = document.getElementById('meyer-join-code');
  const joinBtn = document.getElementById('meyer-join-btn');
  const waitingEl = document.getElementById('meyer-waiting');
  const gameCodeEl = document.getElementById('meyer-game-code');
  const gameLinkEl = document.getElementById('meyer-game-link');
  const playerWaitListEl = document.getElementById('meyer-player-wait-list');
  const startGameBtn = document.getElementById('meyer-start-btn');
  const lobbyErrorEl = document.getElementById('meyer-lobby-error');
  const turnInfoEl = document.getElementById('meyer-turn-info');
  const declaredEl = document.getElementById('meyer-declared');
  const diceWrapEl = document.getElementById('meyer-dice-wrap');
  const diceEl = document.getElementById('meyer-dice');
  const actionsEl = document.getElementById('meyer-actions');
  const livesListEl = document.getElementById('meyer-lives-list');
  const revealEl = document.getElementById('meyer-reveal');
  const revealContentEl = document.getElementById('meyer-reveal-content');
  const nextRoundBtn = document.getElementById('meyer-next-round-btn');
  const gameOverEl = document.getElementById('meyer-game-over');
  const gameOverMsgEl = document.getElementById('meyer-game-over-msg');
  const playAgainBtn = document.getElementById('meyer-play-again-btn');

  let socket = null;

  function showLobby() {
    if (lobbyEl) lobbyEl.hidden = false;
    if (gameEl) gameEl.hidden = true;
    if (lobbyActionsEl) lobbyActionsEl.hidden = false;
    if (waitingEl) waitingEl.hidden = true;
    if (lobbyErrorEl) lobbyErrorEl.hidden = true;
  }

  function showError(msg) {
    if (lobbyErrorEl) {
      lobbyErrorEl.textContent = msg;
      lobbyErrorEl.hidden = false;
    }
  }

  function renderState(state) {
    if (state.phase === 'lobby') {
      if (lobbyEl) lobbyEl.hidden = false;
      if (gameEl) gameEl.hidden = true;
      if (lobbyActionsEl) lobbyActionsEl.hidden = true;
      if (waitingEl) waitingEl.hidden = false;
      if (gameCodeEl) gameCodeEl.textContent = state.gameCode || '';
      if (gameLinkEl) {
        gameLinkEl.href = window.location.origin + window.location.pathname + '?k=' + (state.gameCode || '');
        gameLinkEl.textContent = 'Åbn link til spillet';
      }
      if (playerWaitListEl) {
        playerWaitListEl.innerHTML = (state.playerNames || []).map((n) => '<li>' + escapeHtml(n) + '</li>').join('');
      }
      const count = state.playerCount ?? (state.playerIds || []).length;
      if (startGameBtn) startGameBtn.hidden = count < 2 || count > 6;
      return;
    }

    if (lobbyEl) lobbyEl.hidden = true;
    if (gameEl) gameEl.hidden = false;

    const names = state.playerNames || [];
    const lives = state.lives || [];
    if (livesListEl) {
      livesListEl.innerHTML = names.map((n, i) => '<li>' + escapeHtml(n) + ': ' + (lives[i] ?? 0) + ' liv</li>').join('');
    }

    if (state.phase === 'game_over') {
      revealEl.hidden = true;
      gameOverEl.hidden = false;
      const winnerIdx = state.winnerIndex;
      if (gameOverMsgEl) {
        gameOverMsgEl.textContent = winnerIdx != null ? names[winnerIdx] + ' vinder!' : 'Spil slut.';
      }
      playAgainBtn.onclick = () => { window.location.reload(); };
      return;
    }

    if (state.phase === 'check_done' || state.phase === 'roll_of_cheers') {
      if (revealEl) revealEl.hidden = false;
      if (revealContentEl) {
        const r = state.checkReveal;
        if (r?.rollOfCheers) {
          const who = names[r.whoRolled] || 'Spiller';
          revealContentEl.innerHTML = '<p class="meyer-reveal-title">Skål! Roll of Cheers</p><p>' + escapeHtml(who) + ' rullede 3-2. Ny runde – ' + escapeHtml(who) + ' starter.</p>';
        } else if (r) {
          const whoDecl = names[r.whoDeclared] || '';
          const checker = names[r.checkerIndex] || '';
          const declStr = r.declaredRoll ? rollToLabel(r.declaredRoll.high, r.declaredRoll.low) : '';
          const actualStr = r.actualRoll ? rollToLabel(r.actualRoll[0], r.actualRoll[1]) : '';
          const won = r.actualBeatsDeclared;
          revealContentEl.innerHTML = '<p class="meyer-reveal-title">Check</p><p>' + escapeHtml(whoDecl) + ' havde erklæret ' + escapeHtml(declStr) + '. Faktisk: ' + escapeHtml(actualStr) + '.</p>';
          if (r.actualRoll && r.actualRoll.length >= 2) {
            const diceRow = document.createElement('div');
            diceRow.className = 'meyer-reveal-dice';
            diceRow.appendChild(createDieFace(r.actualRoll[0]));
            diceRow.appendChild(createDieFace(r.actualRoll[1]));
            revealContentEl.appendChild(diceRow);
          }
          const p2 = document.createElement('p');
          p2.textContent = won ? checker + ' troede forkert og taber et liv.' : whoDecl + ' bluffede og taber et liv.';
          revealContentEl.appendChild(p2);
        } else {
          revealContentEl.textContent = '';
        }
      }
      nextRoundBtn.onclick = () => { if (socket) socket.emit('meyer:next_round'); };
      return;
    }

    gameOverEl.hidden = true;
    revealEl.hidden = true;

    const isMyTurn = state.turnIndex === state.myIndex;
    if (turnInfoEl) {
      const who = names[state.turnIndex] || 'Spiller';
      turnInfoEl.textContent = isMyTurn ? 'Din tur' : who + 's tur';
    }
    if (declaredEl) {
      const d = state.declaredRoll;
      declaredEl.textContent = d ? 'Erklæret: ' + rollToLabel(d.high, d.low) : state.turnNumber === 1 ? 'Tur 1 – vælg sandhed eller bluff' : '';
    }

    if (diceWrapEl) diceWrapEl.hidden = !isMyTurn || !state.currentRoll;
    if (diceEl && isMyTurn && state.currentRoll) {
      diceEl.innerHTML = '';
      if (state.currentRollHidden) {
        diceEl.appendChild(createDieFace(null));
        diceEl.appendChild(createDieFace(null));
      } else {
        const [a, b] = state.currentRoll;
        diceEl.appendChild(createDieFace(a));
        diceEl.appendChild(createDieFace(b));
      }
    }

    if (actionsEl) {
      actionsEl.innerHTML = '';
      if (!isMyTurn) {
        actionsEl.appendChild(document.createTextNode('Venter på ' + (names[state.turnIndex] || '') + '…'));
        return;
      }
      if (state.canRoll) {
        if (state.canCheck) {
          const checkBtn = document.createElement('button');
          checkBtn.type = 'button';
          checkBtn.className = 'meyer-btn meyer-btn-action';
          checkBtn.textContent = 'Check';
          checkBtn.onclick = () => { if (socket) socket.emit('meyer:action', { type: 'check' }); };
          actionsEl.appendChild(checkBtn);
        }
        const rollBtn = document.createElement('button');
        rollBtn.type = 'button';
        rollBtn.className = 'meyer-btn meyer-btn-primary';
        rollBtn.textContent = 'Rul';
        rollBtn.onclick = () => { if (socket) socket.emit('meyer:action', { type: 'roll' }); };
        actionsEl.appendChild(rollBtn);
        return;
      }
      if (state.canTruth) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'meyer-btn meyer-btn-primary';
        btn.textContent = 'Sandhed';
        btn.onclick = () => { if (socket) socket.emit('meyer:action', { type: 'truth' }); };
        actionsEl.appendChild(btn);
      }
      if (state.canSameOrHigher) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'meyer-btn meyer-btn-action';
        btn.textContent = 'Samme eller højere';
        btn.onclick = () => { if (socket) socket.emit('meyer:action', { type: 'same_or_higher' }); };
        actionsEl.appendChild(btn);
      }
      (state.bluffOptions || []).forEach((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'meyer-btn meyer-btn-bluff';
        btn.textContent = rollToLabel(opt.high, opt.low);
        btn.onclick = () => { if (socket) socket.emit('meyer:action', { type: 'bluff', declaredRoll: { high: opt.high, low: opt.low } }); };
        actionsEl.appendChild(btn);
      });
    }
  }

  function connect() {
    const token = localStorage.getItem('ontime_token');
    if (!token) {
      window.location.href = '/';
      return;
    }
    socket = io({ path: '/socket.io', auth: { token } });
    socket.on('connect_error', (err) => {
      showError('Kunne ikke forbinde: ' + (err.message || 'Tjek at du er logget ind'));
    });
    socket.on('meyer:state', (state) => renderState(state));
    socket.on('meyer:error', (data) => showError(data.message || 'Fejl'));
  }

  createBtn.addEventListener('click', () => {
    if (lobbyErrorEl) lobbyErrorEl.hidden = true;
    if (socket) socket.emit('meyer:create');
  });

  joinBtn.addEventListener('click', () => {
    const code = (joinCodeInput?.value || '').trim().toUpperCase();
    if (!code || code.length !== 6) { showError('Ugyldig spilkode (6 tegn)'); return; }
    if (lobbyErrorEl) lobbyErrorEl.hidden = true;
    if (socket) socket.emit('meyer:join', { code });
  });

  startGameBtn?.addEventListener('click', () => {
    if (socket) socket.emit('meyer:start');
  });

  document.getElementById('meyer-logout')?.addEventListener('click', () => {
    localStorage.removeItem('ontime_token');
    window.location.href = '/';
  });

  const token = localStorage.getItem('ontime_token');
  if (token) {
    fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => r.ok ? r.json() : null)
      .then((user) => {
        const el = document.getElementById('meyer-user-name');
        if (el && user && user.name) el.textContent = user.name;
      })
      .catch(() => {});
  }

  connect();

  const params = new URLSearchParams(window.location.search);
  const joinCode = params.get('k');
  if (joinCode && joinCodeInput) joinCodeInput.value = joinCode.toUpperCase();
})();
