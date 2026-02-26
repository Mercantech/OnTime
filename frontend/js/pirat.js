(function () {
  const SUITS = ['C', 'D', 'H', 'S'];
  const SUIT_NAMES = { C: 'Klør', D: 'Ruder', H: 'Hjerter', S: 'Spar' };
  const RANK_NAMES = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'Kn', 12: 'D', 13: 'K', 14: 'E' };
  const TRUMP = 'S';
  const CARDS_PER_ROUND = [1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1];
  const NUM_PLAYERS = 4;

  function makeDeck() {
    const deck = [];
    for (const s of SUITS) {
      for (let r = 2; r <= 14; r++) deck.push({ s, r });
    }
    return deck;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function cardOrder(c) {
    return (SUITS.indexOf(c.s) * 20) + c.r;
  }

  function canPlay(hand, card, leadSuit, hasLeadSuit) {
    if (!leadSuit) return true;
    const inLead = hand.filter((x) => x.s === leadSuit).length > 0;
    if (inLead) return card.s === leadSuit;
    return true;
  }

  function legalPlays(hand, leadSuit) {
    if (!leadSuit) return hand.slice();
    const ofSuit = hand.filter((c) => c.s === leadSuit);
    if (ofSuit.length) return ofSuit;
    return hand.slice();
  }

  function trickWinner(cards, leaderIndex) {
    const leadSuit = cards[0].s;
    const hasTrump = cards.some((c) => c.s === TRUMP);
    let best = 0;
    for (let i = 1; i < cards.length; i++) {
      const c = cards[i];
      const b = cards[best];
      if (c.s === TRUMP && b.s !== TRUMP) best = i;
      else if (c.s !== TRUMP && b.s === TRUMP) {}
      else if (c.s === leadSuit && b.s !== leadSuit) best = i;
      else if (c.s !== leadSuit && b.s === leadSuit) {}
      else if (c.s === b.s && c.r > b.r) best = i;
    }
    return (leaderIndex + best) % NUM_PLAYERS;
  }

  const setupEl = document.getElementById('pirat-setup');
  const gameEl = document.getElementById('pirat-game');
  const nameInputs = [1, 2, 3, 4].map((i) => document.getElementById('pirat-name-' + i));
  const startBtn = document.getElementById('pirat-start-btn');
  const setupErrorEl = document.getElementById('pirat-setup-error');
  const roundInfoEl = document.getElementById('pirat-round-info');
  const scoresEl = document.getElementById('pirat-scores');
  const bidPhaseEl = document.getElementById('pirat-bid-phase');
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
  const roundDoneEl = document.getElementById('pirat-round-done');
  const roundScoresEl = document.getElementById('pirat-round-scores');
  const nextRoundBtn = document.getElementById('pirat-next-round-btn');
  const gameOverEl = document.getElementById('pirat-game-over');
  const winnerEl = document.getElementById('pirat-winner');
  const playAgainBtn = document.getElementById('pirat-play-again-btn');

  let state = {
    players: [],
    roundIndex: 0,
    dealer: 0,
    hands: [[], [], [], []],
    bids: [null, null, null, null],
    phase: 'bid',
    currentPlayer: 0,
    leader: 0,
    trick: [],
    trickLeader: 0,
    tricksWon: [0, 0, 0, 0],
    scores: [0, 0, 0, 0],
    selectedBid: null,
  };

  function getN() {
    return CARDS_PER_ROUND[state.roundIndex] || 1;
  }

  function cardStr(c) {
    return (SUIT_NAMES[c.s] || c.s) + ' ' + (RANK_NAMES[c.r] || c.r);
  }

  function renderCard(c, clickable, onClick) {
    const div = document.createElement('div');
    div.className = 'pirat-card' + (c.s === TRUMP ? ' pirat-card-trump' : '');
    div.textContent = (RANK_NAMES[c.r] || c.r) + (c.s === 'S' ? '♠' : c.s === 'H' ? '♥' : c.s === 'D' ? '♦' : '♣');
    div.title = cardStr(c);
    if (clickable && onClick) {
      div.classList.add('pirat-card-clickable');
      div.addEventListener('click', () => onClick(c));
    }
    return div;
  }

  function hideAllPhases() {
    [bidPhaseEl, bidRevealEl, playPhaseEl, roundDoneEl, gameOverEl].forEach((el) => {
      if (el) el.hidden = true;
    });
  }

  function updateScoresDisplay() {
    if (!scoresEl) return;
    scoresEl.textContent = state.players.map((p, i) => p + ': ' + state.scores[i]).join(' · ');
  }

  function startRound() {
    const n = getN();
    const deck = shuffle(makeDeck());
    state.hands = [[], [], [], []];
    state.dealer = state.roundIndex % NUM_PLAYERS;
    state.leader = (state.dealer + 1) % NUM_PLAYERS;
    let idx = 0;
    for (let i = 0; i < n * NUM_PLAYERS; i++) {
      state.hands[i % NUM_PLAYERS].push(deck[idx++]);
    }
    state.hands.forEach((h) => h.sort((a, b) => cardOrder(a) - cardOrder(b)));
    state.bids = [null, null, null, null];
    state.tricksWon = [0, 0, 0, 0];
    state.phase = 'bid';
    state.currentPlayer = state.leader;
    state.selectedBid = null;
    state.trick = [];
    state.trickLeader = state.leader;

    if (roundInfoEl) roundInfoEl.textContent = 'Runde ' + (state.roundIndex + 1) + ' · ' + n + ' kort hver';
    updateScoresDisplay();
    renderBidPhase();
  }

  function renderBidPhase() {
    hideAllPhases();
    if (bidPhaseEl) bidPhaseEl.hidden = false;
    const n = getN();
    if (state.bids.every((b) => b !== null)) {
      bidChoicesEl.innerHTML = '';
      bidConfirmBtn.textContent = 'Afslør bud';
      bidConfirmBtn.onclick = () => {
        state.phase = 'bid_reveal';
        renderBidReveal();
      };
      return;
    }
    const who = state.currentPlayer;
    bidChoicesEl.innerHTML = '<p class="pirat-bid-prompt">' + state.players[who] + ': Vælg antal stik (0–' + n + ')</p>';
    const wrap = document.createElement('div');
    wrap.className = 'pirat-bid-buttons';
    for (let b = 0; b <= n; b++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pirat-btn pirat-btn-bid' + (state.selectedBid === b ? ' pirat-btn-selected' : '');
      btn.textContent = b;
      btn.addEventListener('click', () => {
        state.selectedBid = b;
        renderBidPhase();
      });
      wrap.appendChild(btn);
    }
    bidChoicesEl.appendChild(wrap);
    bidConfirmBtn.textContent = 'Bekræft bud';
    bidConfirmBtn.onclick = () => {
      if (state.selectedBid === null) return;
      state.bids[who] = state.selectedBid;
      state.currentPlayer = (who + 1) % NUM_PLAYERS;
      state.selectedBid = null;
      if (state.bids.every((b) => b !== null)) {
        renderBidPhase();
      } else {
        renderBidPhase();
      }
    };
  }

  function renderBidReveal() {
    hideAllPhases();
    if (bidRevealEl) bidRevealEl.hidden = false;
    const total = state.bids.reduce((a, b) => a + b, 0);
    const n = getN();
    let msg = 'I alt budt: ' + total + ' stik. Der er ' + n + ' stik. ';
    if (total > n) msg += 'Krig om stikkene!';
    else if (total < n) msg += 'Stik til foræring.';
    else msg += 'Lige op.';
    bidRevealListEl.innerHTML = '<p class="pirat-bid-total">' + msg + '</p><ul class="pirat-bid-list">' +
      state.players.map((p, i) => '<li>' + p + ': ' + state.bids[i] + ' stik</li>').join('') + '</ul>';
    bidRevealOkBtn.onclick = () => {
      state.phase = 'play';
      state.currentPlayer = state.leader;
      state.trick = [];
      renderPlayPhase();
    };
  }

  function renderPlayPhase() {
    hideAllPhases();
    if (playPhaseEl) playPhaseEl.hidden = false;
    const n = getN();
    const tricksSoFar = state.tricksWon.reduce((a, b) => a + b, 0);
    if (tricksSoFar === n) {
      endRound();
      return;
    }
    const who = state.currentPlayer;
    if (handLabelPlayerEl) handLabelPlayerEl.textContent = state.players[who];
    const leadSuit = state.trick.length ? state.trick[0].s : null;
    if (whoseLeadEl) {
      if (state.trick.length === 0) whoseLeadEl.textContent = state.players[who] + ' spiller ud.';
      else whoseLeadEl.textContent = state.players[who] + 's tur.';
    }
    if (trickCenterEl) {
      trickCenterEl.innerHTML = '';
      state.trick.forEach((c) => trickCenterEl.appendChild(renderCard(c, false)));
    }
    const hand = state.hands[who];
    const legal = legalPlays(hand, leadSuit);
    handEl.innerHTML = '';
    hand.forEach((c) => {
      const clickable = legal.some((x) => x.s === c.s && x.r === c.r);
      handEl.appendChild(renderCard(c, clickable, () => playCard(who, c)));
    });
  }

  function playCard(playerIndex, card) {
    const hand = state.hands[playerIndex];
    const idx = hand.findIndex((c) => c.s === card.s && c.r === card.r);
    if (idx === -1) return;
    hand.splice(idx, 1);
    state.trick.push(card);
    if (state.trick.length === NUM_PLAYERS) {
      const winner = trickWinner(state.trick, state.trickLeader);
      state.tricksWon[winner]++;
      state.leader = winner;
      state.currentPlayer = winner;
      state.trick = [];
      state.trickLeader = winner;
    } else {
      state.currentPlayer = (state.currentPlayer + 1) % NUM_PLAYERS;
    }
    renderPlayPhase();
  }

  function endRound() {
    state.phase = 'round_done';
    const n = getN();
    state.players.forEach((_, i) => {
      const bid = state.bids[i];
      const took = state.tricksWon[i];
      if (bid === took) state.scores[i] += 10 + took;
      else state.scores[i] -= Math.abs(bid - took);
    });
    hideAllPhases();
    if (roundDoneEl) roundDoneEl.hidden = false;
    roundScoresEl.innerHTML = '<ul class="pirat-round-score-list">' +
      state.players.map((p, i) => {
        const bid = state.bids[i];
        const took = state.tricksWon[i];
        const delta = bid === took ? 10 + took : -Math.abs(bid - took);
        return '<li>' + p + ': budt ' + bid + ', tog ' + took + ' → ' + (delta >= 0 ? '+' : '') + delta + '</li>';
      }).join('') + '</ul><p class="pirat-total-so-far">Samlet: ' + state.players.map((p, i) => p + ' ' + state.scores[i]).join(', ') + '</p>';
    updateScoresDisplay();
    nextRoundBtn.onclick = () => {
      state.roundIndex++;
      if (state.roundIndex >= CARDS_PER_ROUND.length) {
        state.phase = 'game_over';
        const maxScore = Math.max(...state.scores);
        const winners = state.players.filter((_, i) => state.scores[i] === maxScore);
        hideAllPhases();
        if (gameOverEl) gameOverEl.hidden = false;
        if (winnerEl) winnerEl.textContent = winners.join(', ') + ' med ' + maxScore + ' point';
      } else {
        startRound();
      }
    };
  }

  function startGame() {
    const names = nameInputs.map((el) => (el && el.value) ? el.value.trim() : '').filter(Boolean);
    if (names.length !== NUM_PLAYERS) {
      if (setupErrorEl) {
        setupErrorEl.textContent = 'Udfyld alle 4 spillernavne.';
        setupErrorEl.hidden = false;
      }
      return;
    }
    state.players = names;
    state.roundIndex = 0;
    state.scores = [0, 0, 0, 0];
    if (setupErrorEl) setupErrorEl.hidden = true;
    if (setupEl) setupEl.hidden = true;
    if (gameEl) gameEl.hidden = false;
    startRound();
  }

  function resetToSetup() {
    if (setupEl) setupEl.hidden = false;
    if (gameEl) gameEl.hidden = true;
    hideAllPhases();
  }

  startBtn.addEventListener('click', startGame);
  playAgainBtn.addEventListener('click', resetToSetup);

  if (document.getElementById('pirat-logout')) {
    document.getElementById('pirat-logout').addEventListener('click', () => {
      localStorage.removeItem('ontime_token');
      window.location.href = '/';
    });
  }
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
})();
