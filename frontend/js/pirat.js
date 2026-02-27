(function () {
  const SUITS = ['C', 'D', 'H', 'S'];
  const RANK_NAMES = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'Kn', 12: 'D', 13: 'K', 14: 'E' };
  const TRUMP = 'S';

  function cardStr(c) {
    const suitNames = { C: 'Klør', D: 'Ruder', H: 'Hjerter', S: 'Spar' };
    return (suitNames[c.s] || c.s) + ' ' + (RANK_NAMES[c.r] || c.r);
  }

  function isLegal(card, legalCards) {
    return legalCards && legalCards.some((l) => l.s === card.s && l.r === card.r);
  }

  function renderCard(card, legal, onClick) {
    const div = document.createElement('div');
    div.className = 'pirat-card' + (card.s === TRUMP ? ' pirat-card-trump' : '');
    if (legal) {
      div.classList.add('pirat-card-legal');
      div.classList.add('pirat-card-clickable');
    } else {
      div.classList.add('pirat-card-illegal');
    }
    div.textContent = (RANK_NAMES[card.r] || card.r) + (card.s === 'S' ? '♠' : card.s === 'H' ? '♥' : card.s === 'D' ? '♦' : '♣');
    div.title = cardStr(card);
    if (legal && onClick) div.addEventListener('click', () => onClick(card));
    return div;
  }

  const lobbyEl = document.getElementById('pirat-lobby');
  const lobbyActionsEl = document.getElementById('pirat-lobby-actions');
  const gameEl = document.getElementById('pirat-game');
  const createBtn = document.getElementById('pirat-create-btn');
  const joinCodeInput = document.getElementById('pirat-join-code');
  const joinBtn = document.getElementById('pirat-join-btn');
  const waitingEl = document.getElementById('pirat-waiting');
  const gameCodeEl = document.getElementById('pirat-game-code');
  const gameLinkEl = document.getElementById('pirat-game-link');
  const playerWaitListEl = document.getElementById('pirat-player-wait-list');
  const startGameBtn = document.getElementById('pirat-start-btn');
  const lobbyErrorEl = document.getElementById('pirat-lobby-error');
  const turnStatusEl = document.getElementById('pirat-turn-status');
  const turnNameEl = document.getElementById('pirat-turn-name');
  const roundInfoEl = document.getElementById('pirat-round-info');
  const scoresEl = document.getElementById('pirat-scores');
  const bidPhaseEl = document.getElementById('pirat-bid-phase');
  const bidHandEl = document.getElementById('pirat-bid-hand');
  const bidChoicesEl = document.getElementById('pirat-bid-choices');
  const bidConfirmBtn = document.getElementById('pirat-bid-confirm');
  const bidRevealEl = document.getElementById('pirat-bid-reveal');
  const bidRevealListEl = document.getElementById('pirat-bid-reveal-list');
  const bidRevealOkBtn = document.getElementById('pirat-bid-reveal-ok');
  const playPhaseEl = document.getElementById('pirat-play-phase');
  const whoseLeadEl = document.getElementById('pirat-whose-lead');
  const trickCenterEl = document.getElementById('pirat-trick-center');
  const handWrapEl = document.getElementById('pirat-hand-wrap');
  const handLabelPlayerEl = document.getElementById('pirat-current-hand-player');
  const handEl = document.getElementById('pirat-hand');
  const trickDoneEl = document.getElementById('pirat-trick-done');
  const trickWinnerMsgEl = document.getElementById('pirat-trick-winner-msg');
  const trickDoneCardsEl = document.getElementById('pirat-trick-done-cards');
  const trickDoneHintEl = document.getElementById('pirat-trick-done-hint');
  const roundDoneEl = document.getElementById('pirat-round-done');
  const roundScoresEl = document.getElementById('pirat-round-scores');
  const nextRoundBtn = document.getElementById('pirat-next-round-btn');
  const gameOverEl = document.getElementById('pirat-game-over');
  const winnerEl = document.getElementById('pirat-winner');
  const playAgainBtn = document.getElementById('pirat-play-again-btn');

  let socket = null;
  let lastState = null;
  let selectedBid = null;

  function hideAllPhases() {
    [bidPhaseEl, bidRevealEl, playPhaseEl, trickDoneEl, roundDoneEl, gameOverEl].forEach((el) => {
      if (el) el.hidden = true;
    });
  }

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
      lobbyErrorEl.classList.remove('pirat-info');
      lobbyErrorEl.classList.add('pirat-error');
      lobbyErrorEl.hidden = false;
    }
  }

  function updateTurnStatus(state) {
    if (!turnStatusEl || !turnNameEl) return;
    const names = state.playerNames || [];
    const cur = state.currentPlayer;
    const name = names[cur] || 'Spiller ' + (cur + 1);
    turnStatusEl.hidden = false;
    turnNameEl.textContent = name;
  }

  function renderState(state) {
    lastState = state;
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
      if (startGameBtn) {
        startGameBtn.hidden = count < 2 || count > 4;
      }
      return;
    }

    if (lobbyEl) lobbyEl.hidden = true;
    if (gameEl) gameEl.hidden = false;
    if (roundInfoEl) roundInfoEl.textContent = 'Runde ' + (state.roundIndex + 1) + ' · ' + (state.n || 0) + ' kort hver';
    if (scoresEl) scoresEl.textContent = (state.playerNames || []).map((n, i) => n + ': ' + ((state.scores || [])[i] ?? 0)).join(' · ');
    updateTurnStatus(state);
    hideAllPhases();

    if (state.phase === 'bid') {
      if (bidPhaseEl) bidPhaseEl.hidden = false;
      if (bidHandEl) {
        bidHandEl.innerHTML = '';
        (state.myHand || []).forEach((card) => {
          bidHandEl.appendChild(renderCard(card, false, null));
        });
      }
      const n = state.n || 0;
      const bids = state.bids || [];
      const myBid = state.myIndex != null ? bids[state.myIndex] : null;
      const allBid = bids.every((b) => b !== null);
      const names = state.playerNames || [];
      let statusHtml = '<ul class="pirat-bid-status">';
      for (let i = 0; i < names.length; i++) {
        const name = escapeHtml(names[i] || 'Spiller ' + (i + 1));
        const done = bids[i] !== null;
        statusHtml += '<li>' + name + ': ' + (done ? '✓ Klar' : '…') + '</li>';
      }
      statusHtml += '</ul>';
      if (myBid !== null) {
        selectedBid = null;
        bidChoicesEl.innerHTML = '<p class="pirat-bid-prompt">Du har budt <strong>' + myBid + '</strong> stik.</p>' + statusHtml +
          (allBid ? '' : '<p class="pirat-bid-wait">Venter på at alle har budt.</p>');
        if (bidConfirmBtn) bidConfirmBtn.hidden = true;
      } else {
        selectedBid = selectedBid ?? null;
        bidChoicesEl.innerHTML = '<p class="pirat-bid-prompt">Vælg antal stik (0–' + n + '):</p>' + statusHtml;
        const wrap = document.createElement('div');
        wrap.className = 'pirat-bid-buttons';
        for (let b = 0; b <= n; b++) {
          const isSelected = selectedBid === b;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pirat-btn pirat-btn-bid' + (isSelected ? ' pirat-btn-selected' : '');
          btn.textContent = b;
          btn.dataset.bid = String(b);
          btn.addEventListener('click', () => {
            selectedBid = b;
            wrap.querySelectorAll('.pirat-btn-bid').forEach((x) => x.classList.remove('pirat-btn-selected'));
            btn.classList.add('pirat-btn-selected');
            if (bidConfirmBtn) {
              bidConfirmBtn.hidden = false;
              bidConfirmBtn.disabled = false;
              bidConfirmBtn.textContent = 'Lås bud (' + b + ' stik)';
            }
          });
          wrap.appendChild(btn);
        }
        bidChoicesEl.appendChild(wrap);
        if (bidConfirmBtn) {
          bidConfirmBtn.hidden = false;
          bidConfirmBtn.disabled = selectedBid === null;
          bidConfirmBtn.textContent = selectedBid !== null ? 'Lås bud (' + selectedBid + ' stik)' : 'Lås bud';
          bidConfirmBtn.onclick = () => {
            if (socket && selectedBid !== null) {
              socket.emit('pirat:bid', { bid: selectedBid });
              selectedBid = null;
            }
          };
        }
      }
    } else if (state.phase === 'bid_reveal') {
      if (bidRevealEl) bidRevealEl.hidden = false;
      const bids = state.bids || [];
      const total = bids.reduce((a, b) => a + (b || 0), 0);
      const n = state.n || 0;
      let summaryClass = 'pirat-bid-summary';
      let summaryText = 'I alt budt: ' + total + ' stik. Der er ' + n + ' stik. ';
      if (total > n) {
        summaryClass += ' pirat-bid-summary-warning';
        summaryText += 'For mange tændstikker – krig om stikkene!';
      } else if (total < n) {
        summaryClass += ' pirat-bid-summary-warning';
        summaryText += 'For få tændstikker – stik til foræring.';
      } else {
        summaryText += 'Lige op.';
      }
      const listHtml = (state.playerNames || []).map((p, i) => '<li><strong>' + escapeHtml(p) + '</strong>: ' + (bids[i] ?? '–') + ' stik</li>').join('');
      bidRevealListEl.innerHTML = '<div class="' + summaryClass + '">' + summaryText + '</div><ul class="pirat-bid-list">' + listHtml + '</ul>';
      bidRevealOkBtn.onclick = () => { if (socket) socket.emit('pirat:reveal_ok'); };
    } else if (state.phase === 'play') {
      if (playPhaseEl) playPhaseEl.hidden = false;
      const names = state.playerNames || [];
      const who = state.currentPlayer;
      if (whoseLeadEl) whoseLeadEl.textContent = (state.trickWithPlayer && state.trickWithPlayer.length > 0)
        ? names[who] + 's tur.'
        : names[who] + ' spiller ud.';
      if (trickCenterEl) {
        trickCenterEl.innerHTML = '';
        (state.trickWithPlayer || []).forEach(({ card, playedBy }) => {
          const span = document.createElement('span');
          span.className = 'pirat-trick-card';
          span.textContent = (RANK_NAMES[card.r] || card.r) + (card.s === 'S' ? '♠' : card.s === 'H' ? '♥' : card.s === 'D' ? '♦' : '♣');
          span.title = (names[playedBy] || '') + ': ' + cardStr(card);
          trickCenterEl.appendChild(span);
        });
      }
      if (handLabelPlayerEl) handLabelPlayerEl.textContent = names[state.myIndex] || 'Du';
      const myHand = state.myHand || [];
      const legalCards = state.legalCards || [];
      handEl.innerHTML = '';
      myHand.forEach((c) => {
        const legal = isLegal(c, legalCards);
        handEl.appendChild(renderCard(c, legal, (card) => {
          if (socket && state.currentPlayer === state.myIndex) socket.emit('pirat:play_card', { card });
        }));
      });
    } else if (state.phase === 'trick_done') {
      if (trickDoneEl) trickDoneEl.hidden = false;
      const names = state.playerNames || [];
      const winner = state.trickWinner;
      const winningIdx = state.trickWinningCardIndex ?? 0;
      const trickWithPlayer = state.trickWithPlayer || [];
      const winningEntry = trickWithPlayer[winningIdx];
      const winnerName = names[winner] || 'Spiller ' + (winner + 1);
      const winningCard = winningEntry?.card;
      const cardStrShort = winningCard ? (RANK_NAMES[winningCard.r] || winningCard.r) + (winningCard.s === 'S' ? '♠' : winningCard.s === 'H' ? '♥' : winningCard.s === 'D' ? '♦' : '♣') : '';
      if (trickWinnerMsgEl) trickWinnerMsgEl.textContent = winnerName + ' vandt stikket med ' + cardStrShort;
      if (trickDoneCardsEl) {
        trickDoneCardsEl.innerHTML = '';
        trickWithPlayer.forEach(({ card, playedBy }, i) => {
          const span = document.createElement('span');
          span.className = 'pirat-trick-done-card' + (i === winningIdx ? ' pirat-trick-winner-card' : '');
          span.textContent = (RANK_NAMES[card.r] || card.r) + (card.s === 'S' ? '♠' : card.s === 'H' ? '♥' : card.s === 'D' ? '♦' : '♣');
          span.title = (names[playedBy] || '') + ': ' + cardStr(card);
          trickDoneCardsEl.appendChild(span);
        });
      }
      const tricksSoFar = (state.tricksWon || []).reduce((a, b) => a + b, 0);
      if (trickDoneHintEl) trickDoneHintEl.textContent = tricksSoFar === (state.n || 0) ? 'Runden er slut – point om lidt…' : 'Næste stik om lidt…';
    } else if (state.phase === 'round_done') {
      if (roundDoneEl) roundDoneEl.hidden = false;
      const bids = state.bids || [];
      const tricksWon = state.tricksWon || [];
      const scores = state.scores || [];
      roundScoresEl.innerHTML = '<ul class="pirat-round-score-list">' +
        (state.playerNames || []).map((p, i) => {
          const bid = bids[i];
          const took = tricksWon[i];
          const delta = bid === took ? 10 + took : -Math.abs(bid - took);
          let resultText = bid === took ? 'lige' : (took > bid ? (took - bid) + ' for meget' : (bid - took) + ' mangler');
          return '<li><strong>' + escapeHtml(p) + '</strong>: budt ' + bid + ', tog ' + took + ' → ' + resultText + ' (' + (delta >= 0 ? '+' : '') + delta + ' pt)</li>';
        }).join('') + '</ul><p class="pirat-total-so-far">Samlet: ' + (state.playerNames || []).map((p, i) => p + ' ' + (scores[i] || 0)).join(', ') + '</p>';
      nextRoundBtn.onclick = () => { if (socket) socket.emit('pirat:next_round'); };
    } else if (state.phase === 'game_over') {
      if (gameOverEl) gameOverEl.hidden = false;
      const scores = state.scores || [];
      const maxScore = Math.max(...scores);
      const winners = (state.playerNames || []).filter((_, i) => scores[i] === maxScore);
      if (winnerEl) winnerEl.textContent = winners.join(', ') + ' med ' + maxScore + ' point';
      playAgainBtn.onclick = () => { window.location.reload(); };
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
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
    socket.on('pirat:state', (state) => renderState(state));
    socket.on('pirat:error', (data) => showError(data.message || 'Fejl'));
    socket.on('pirat:game_ended', (data) => {
      if (lobbyEl) lobbyEl.hidden = false;
      if (gameEl) gameEl.hidden = true;
      if (waitingEl) waitingEl.hidden = true;
      if (lobbyActionsEl) lobbyActionsEl.hidden = false;
      if (gameCodeEl) gameCodeEl.textContent = '';
      if (playerWaitListEl) playerWaitListEl.innerHTML = '';
      if (startGameBtn) startGameBtn.hidden = true;
      if (lobbyErrorEl) {
        lobbyErrorEl.textContent = data.message || 'Spillet er afsluttet.';
        lobbyErrorEl.classList.remove('pirat-error');
        lobbyErrorEl.classList.add('pirat-info');
        lobbyErrorEl.hidden = false;
      }
    });
  }

  createBtn.addEventListener('click', () => {
    if (lobbyErrorEl) lobbyErrorEl.hidden = true;
    if (socket) socket.emit('pirat:create');
  });

  joinBtn.addEventListener('click', () => {
    const code = (joinCodeInput && joinCodeInput.value) ? joinCodeInput.value.trim().toUpperCase() : '';
    if (!code) {
      showError('Indtast en spilkode');
      return;
    }
    if (lobbyErrorEl) lobbyErrorEl.hidden = true;
    if (socket) socket.emit('pirat:join', { code });
  });

  startGameBtn?.addEventListener('click', () => {
    if (socket) socket.emit('pirat:start');
  });

  document.getElementById('pirat-logout')?.addEventListener('click', () => {
    localStorage.removeItem('ontime_token');
    window.location.href = '/';
  });

  const token = localStorage.getItem('ontime_token');
  if (token) {
    fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => r.ok ? r.json() : null)
      .then((user) => {
        const el = document.getElementById('pirat-user-name');
        if (el && user && user.name) el.textContent = user.name;
      })
      .catch(() => {});
  }

  connect();

  const params = new URLSearchParams(window.location.search);
  const joinCode = params.get('k');
  if (joinCode && joinCodeInput) {
    joinCodeInput.value = joinCode.toUpperCase();
  }
})();
