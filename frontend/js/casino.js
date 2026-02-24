const token = localStorage.getItem('ontime_token');
if (!token) {
  window.location.href = '/';
}

const api = (path, opts = {}) =>
  fetch(path, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${token}` },
  });

const SYMBOLS = ['🍒', '🍋', '🍊', '⭐', '7️⃣', '💎'];
const REEL_SPIN_INTERVAL_MS = 90;
const REEL1_STOP_MS = 1400;
const REEL2_STOP_MS = 2600;
const REEL3_STOP_MS = 3800;
const MESSAGE_SHOW_MS = 4200;

const reel1 = document.getElementById('reel1');
const reel2 = document.getElementById('reel2');
const reel3 = document.getElementById('reel3');
const reelsEl = document.getElementById('slot-reels');
const leverBtn = document.getElementById('slot-lever');
const messageEl = document.getElementById('slot-message');
const badgeEl = document.getElementById('slot-badge');
const balanceEl = document.getElementById('casino-balance');
const coinEl = document.getElementById('coin');
const flipBtn = document.getElementById('flip-btn');
const flipMessageEl = document.getElementById('flip-message');

function setReel(reelEl, symbol) {
  if (!reelEl) return;
  const sym = reelEl.querySelector('.reel-symbol');
  if (sym) sym.textContent = symbol ?? '?';
}

function setReels(s1, s2, s3) {
  setReel(reel1, s1);
  setReel(reel2, s2);
  setReel(reel3, s3);
}

function randomSymbol() {
  return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
}

function reelLand(reelEl) {
  if (!reelEl) return;
  reelEl.classList.add('reel-land');
  setTimeout(() => reelEl.classList.remove('reel-land'), 280);
}

async function loadStatus() {
  try {
    const [slotRes, coinRes, rouletteRes, blackjackRes] = await Promise.all([
      api('/api/casino/status'),
      api('/api/games/coinflip/status'),
      api('/api/casino/roulette/status'),
      api('/api/casino/blackjack/status'),
    ]);
    const slotData = await slotRes.json().catch(() => ({}));
    const coinData = await coinRes.json().catch(() => ({}));
    const rouletteData = await rouletteRes.json().catch(() => ({}));
    const blackjackData = await blackjackRes.json().catch(() => ({}));

    if (slotRes.status === 401 || coinRes.status === 401) {
      window.location.href = '/';
      return;
    }

    const balance = slotData.balance ?? coinData.balance ?? rouletteData.balance ?? blackjackData.balance ?? '–';
    if (balanceEl) balanceEl.textContent = balance;

    if (leverBtn) leverBtn.disabled = !slotData.canSpin;
    if (messageEl) {
      if (slotData.alreadySpunToday) {
        messageEl.hidden = false;
        messageEl.className = 'slot-message lose';
        messageEl.textContent = 'Du har allerede spillet i dag. Kom tilbage i morgen!';
      } else {
        messageEl.hidden = true;
      }
    }
    if (badgeEl) badgeEl.hidden = true;

    if (flipBtn) flipBtn.disabled = !coinData.canFlip;
    const flipsLeftEl = document.getElementById('coinflip-flips-left');
    if (flipsLeftEl) {
      const remaining = coinData.flipsRemainingToday ?? 0;
      const max = coinData.maxFlipsPerDay ?? 100;
      flipsLeftEl.textContent = remaining > 0 ? `${remaining} flips tilbage i dag (max ${max})` : `Du har brugt alle ${max} flips i dag.`;
      flipsLeftEl.hidden = false;
    }
    if (flipMessageEl) flipMessageEl.hidden = true;

    const rouletteCanSpin = rouletteData.canSpin ?? false;
    const rouletteBetRed = document.getElementById('roulette-bet-red');
    const rouletteBetBlack = document.getElementById('roulette-bet-black');
    const rouletteBetGreen = document.getElementById('roulette-bet-green');
    if (rouletteBetRed) rouletteBetRed.disabled = !rouletteCanSpin;
    if (rouletteBetBlack) rouletteBetBlack.disabled = !rouletteCanSpin;
    if (rouletteBetGreen) rouletteBetGreen.disabled = !rouletteCanSpin;
    const rouletteSpinsLeftEl = document.getElementById('roulette-spins-left');
    if (rouletteSpinsLeftEl) {
      const rem = rouletteData.spinsRemainingToday ?? 0;
      const max = rouletteData.maxSpinsPerDay ?? 3;
      rouletteSpinsLeftEl.textContent = rem > 0 ? `${rem} spin tilbage i dag (max ${max})` : `Du har brugt alle ${max} spin i dag.`;
    }

    const bjHandsLeftEl = document.getElementById('blackjack-hands-left');
    if (bjHandsLeftEl) {
      const rem = blackjackData.handsRemainingToday ?? 0;
      const max = blackjackData.maxHandsPerDay ?? 3;
      bjHandsLeftEl.textContent = rem > 0 ? `${rem} hænder tilbage i dag (max ${max})` : `Du har brugt alle ${max} hænder i dag.`;
    }
    const bjStartBtn = document.getElementById('blackjack-start');
    if (bjStartBtn && blackjackRes.ok) bjStartBtn.disabled = !blackjackData.canStart;

    loadCasinoHistory();
    loadCasinoStats();
  } catch (e) {
    console.error('loadStatus:', e);
    if (balanceEl) balanceEl.textContent = '–';
    if (leverBtn) leverBtn.disabled = true;
    if (flipBtn) flipBtn.disabled = true;
  }
}

function formatReason(reason) {
  const map = {
    'Casino spin': 'Enarmet bandit',
    'Casino gevinst': 'Enarmet bandit gevinst',
    'Roulette': 'Roulette',
    'Roulette gevinst': 'Roulette gevinst',
    'Blackjack': 'Blackjack',
    'Blackjack push': 'Blackjack push',
    'Blackjack gevinst': 'Blackjack gevinst',
    'Coinflip': 'Coinflip',
    'Coinflip gevinst': 'Coinflip gevinst',
    'Poker buy-in': 'Poker buy-in',
    'Poker refund': 'Poker refund',
    'Poker afsluttet': 'Poker afsluttet',
    'Poker afsluttet (admin)': 'Poker afsluttet',
  };
  return map[reason] || reason;
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const today = now.toDateString();
  if (d.toDateString() === today) {
    return d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
}

async function loadCasinoHistory() {
  const el = document.getElementById('casino-history');
  if (!el) return;
  try {
    const res = await api('/api/casino/history');
    const list = await res.json().catch(() => []);
    if (!Array.isArray(list) || list.length === 0) {
      el.innerHTML = '<li class="casino-history-item"><span class="casino-history-reason">Ingen transaktioner endnu</span></li>';
      return;
    }
    el.innerHTML = list.map((item) => {
      const delta = item.delta ?? 0;
      const sign = delta >= 0 ? 'plus' : 'minus';
      const text = delta >= 0 ? '+' + delta : String(delta);
      return '<li class="casino-history-item">' +
        '<span><span class="casino-history-reason">' + formatReason(item.reason) + '</span><span class="casino-history-time">' + formatTime(item.at) + '</span></span>' +
        '<span class="casino-history-delta ' + sign + '">' + text + ' pt</span></li>';
    }).join('');
  } catch (e) {
    el.innerHTML = '<li class="casino-history-item"><span class="casino-history-reason">Kunne ikke hente historik</span></li>';
  }
}

async function loadCasinoStats() {
  const el = document.getElementById('casino-stats');
  if (!el) return;
  try {
    const res = await api('/api/casino/stats');
    const data = await res.json().catch(() => ({}));
    const stats = data.stats || [];
    if (stats.length === 0) {
      el.innerHTML = '<p class="casino-stat-detail">Ingen spil denne måned</p>';
      return;
    }
    el.innerHTML = stats.map((s) => {
      const net = s.net ?? 0;
      const netClass = net > 0 ? 'positive' : (net < 0 ? 'negative' : 'zero');
      const netText = (net >= 0 ? '+' : '') + net + ' pt';
      const detail = [s.wins + ' vind', s.losses + ' tab'].filter(Boolean).join(' · ');
      return '<div class="casino-stat-row">' +
        '<span><span class="casino-stat-game">' + (s.game || s.key) + '</span><span class="casino-stat-detail">' + detail + '</span></span>' +
        '<span class="casino-stat-net ' + netClass + '">' + netText + '</span></div>';
    }).join('');
  } catch (e) {
    el.innerHTML = '<p class="casino-stat-detail">Kunne ikke hente statistik</p>';
  }
}

/** Kør slot-animation: reels cykler, stopper ét ad gangen med resultatet. */
function runSpinAnimation(finalSymbols, onComplete) {
  if (!reelsEl) {
    onComplete?.();
    return;
  }
  reelsEl.classList.add('spinning');
  const s1 = finalSymbols?.[0] ?? '?';
  const s2 = finalSymbols?.[1] ?? '?';
  const s3 = finalSymbols?.[2] ?? '?';

  let id1 = 0;
  let id2 = 0;
  let id3 = 0;

  function tickReel1() {
    setReel(reel1, randomSymbol());
  }
  function tickReel2() {
    setReel(reel2, randomSymbol());
  }
  function tickReel3() {
    setReel(reel3, randomSymbol());
  }

  id1 = setInterval(tickReel1, REEL_SPIN_INTERVAL_MS);
  id2 = setInterval(tickReel2, REEL_SPIN_INTERVAL_MS);
  id3 = setInterval(tickReel3, REEL_SPIN_INTERVAL_MS);

  setTimeout(() => {
    clearInterval(id1);
    setReel(reel1, s1);
    reelLand(reel1);
  }, REEL1_STOP_MS);

  setTimeout(() => {
    clearInterval(id2);
    setReel(reel2, s2);
    reelLand(reel2);
  }, REEL2_STOP_MS);

  setTimeout(() => {
    clearInterval(id3);
    setReel(reel3, s3);
    reelLand(reel3);
    reelsEl.classList.remove('spinning');
    setTimeout(() => onComplete?.(), 400);
  }, REEL3_STOP_MS);
}

leverBtn.addEventListener('click', async () => {
  if (leverBtn.disabled) return;
  leverBtn.disabled = true;
  setReels('?', '?', '?');
  if (messageEl) messageEl.hidden = true;
  if (badgeEl) badgeEl.hidden = true;

  const res = await api('/api/casino/spin', { method: 'POST' });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (messageEl) {
      messageEl.hidden = false;
      messageEl.className = 'slot-message lose';
      messageEl.textContent = data.error || 'Noget gik galt.';
    }
    loadStatus();
    return;
  }

  runSpinAnimation(data.symbols, () => {
    if (messageEl) {
      messageEl.hidden = false;
      messageEl.className = 'slot-message ' + (data.win > 0 ? 'win' : 'lose');
      messageEl.textContent = data.message || '';
    }
    if (data.badgeEarned && badgeEl) {
      badgeEl.hidden = false;
      badgeEl.textContent = '🎰 Du fik badge: Enarmet bandit!';
    }
    loadStatus();
  });
});

flipBtn?.addEventListener('click', async () => {
  if (flipBtn.disabled) return;
  flipBtn.disabled = true;
  if (flipMessageEl) flipMessageEl.hidden = true;
  if (coinEl) {
    coinEl.classList.remove('flip-result-win', 'flip-result-lose');
    coinEl.classList.add('flipping');
  }

  const res = await api('/api/games/coinflip/flip', { method: 'POST' });
  const data = await res.json().catch(() => ({}));

  const flipDurationMs = 1100;
  setTimeout(() => {
    if (coinEl) {
      coinEl.classList.remove('flipping');
      if (res.ok) {
        coinEl.classList.add(data.win ? 'flip-result-win' : 'flip-result-lose');
      }
    }
    if (!res.ok) {
      if (flipMessageEl) {
        flipMessageEl.hidden = false;
        flipMessageEl.className = 'flip-message lose';
        flipMessageEl.textContent = data.error || 'Noget gik galt.';
      }
      flipBtn.disabled = false;
      loadStatus();
      return;
    }
    if (flipMessageEl) {
      flipMessageEl.hidden = false;
      flipMessageEl.className = 'flip-message ' + (data.win ? 'win' : 'lose');
      flipMessageEl.textContent = data.win
        ? 'Krone! Du vandt 2 point.'
        : 'Plat. Prøv igen!';
    }
    loadStatus();
    if (coinEl) {
      setTimeout(() => coinEl.classList.remove('flip-result-win', 'flip-result-lose'), 600);
    }
  }, flipDurationMs);
});

const menuEl = document.getElementById('casino-menu');
const viewSlotEl = document.getElementById('casino-view-slot');
const viewCoinflipEl = document.getElementById('casino-view-coinflip');
const viewRouletteEl = document.getElementById('casino-view-roulette');
const viewBlackjackEl = document.getElementById('casino-view-blackjack');
const viewPokerEl = document.getElementById('casino-view-poker');

function showMenu() {
  if (menuEl) menuEl.hidden = false;
  if (viewSlotEl) viewSlotEl.hidden = true;
  if (viewCoinflipEl) viewCoinflipEl.hidden = true;
  if (viewRouletteEl) viewRouletteEl.hidden = true;
  if (viewBlackjackEl) viewBlackjackEl.hidden = true;
  if (viewPokerEl) viewPokerEl.hidden = true;
}

function showSlot() {
  if (menuEl) menuEl.hidden = true;
  if (viewSlotEl) viewSlotEl.hidden = false;
  if (viewCoinflipEl) viewCoinflipEl.hidden = true;
  if (viewRouletteEl) viewRouletteEl.hidden = true;
  if (viewBlackjackEl) viewBlackjackEl.hidden = true;
  if (viewPokerEl) viewPokerEl.hidden = true;
}

function showCoinflip() {
  if (menuEl) menuEl.hidden = true;
  if (viewSlotEl) viewSlotEl.hidden = true;
  if (viewCoinflipEl) viewCoinflipEl.hidden = false;
  if (viewRouletteEl) viewRouletteEl.hidden = true;
  if (viewBlackjackEl) viewBlackjackEl.hidden = true;
  if (viewPokerEl) viewPokerEl.hidden = true;
  loadStatus();
}

function showRoulette() {
  if (menuEl) menuEl.hidden = true;
  if (viewSlotEl) viewSlotEl.hidden = true;
  if (viewCoinflipEl) viewCoinflipEl.hidden = true;
  if (viewRouletteEl) viewRouletteEl.hidden = false;
  if (viewBlackjackEl) viewBlackjackEl.hidden = true;
  if (viewPokerEl) viewPokerEl.hidden = true;
  loadStatus();
  buildRouletteWheel();
  const resultEl = document.getElementById('roulette-result');
  const msgEl = document.getElementById('roulette-message');
  if (resultEl) resultEl.hidden = true;
  if (msgEl) msgEl.hidden = true;
}

// Roulettehjul: 37 segmenter (europæisk) – 1 grøn, 18 rød, 18 sort
const ROULETTE_SEGMENTS = ['green', 'red', 'black', 'red', 'black', 'red', 'black', 'red', 'black', 'red', 'black', 'red', 'black', 'red', 'black', 'red', 'black', 'red', 'black', 'red', 'black', 'red', 'black', 'red', 'black', 'red', 'black', 'red', 'black', 'red', 'black', 'red', 'black', 'red', 'black', 'red', 'black'];
let rouletteRotation = 0;

function buildRouletteWheel() {
  const wheelEl = document.getElementById('roulette-wheel');
  if (!wheelEl) return;
  const n = ROULETTE_SEGMENTS.length;
  const degPer = 360 / n;
  const colors = { red: '#dc2626', black: '#1f2937', green: '#16a34a' };
  const stops = ROULETTE_SEGMENTS.map((color, i) => `${colors[color]} ${i * degPer}deg ${(i + 1) * degPer}deg`);
  wheelEl.style.background = `conic-gradient(${stops.join(', ')})`;
}

function getRandomSegmentForResult(result) {
  const indices = ROULETTE_SEGMENTS.map((c, i) => (c === result ? i : -1)).filter(i => i >= 0);
  return indices[Math.floor(Math.random() * indices.length)];
}

function spinRouletteWheelToResult(result, onComplete) {
  const wheelEl = document.getElementById('roulette-wheel');
  if (!wheelEl) { onComplete?.(); return; }
  const n = ROULETTE_SEGMENTS.length;
  const segmentIndex = getRandomSegmentForResult(result);
  const segmentAngle = 360 / n;
  const extraSpins = 5;
  // Stop med segmentets midte ved pegeren (minus halv segment, så vi rammer farvens centrum)
  rouletteRotation += extraSpins * 360 - segmentIndex * segmentAngle - segmentAngle / 2;
  wheelEl.classList.add('spinning');
  wheelEl.style.transform = `rotate(${rouletteRotation}deg)`;
  setTimeout(() => {
    wheelEl.classList.remove('spinning');
    onComplete?.();
  }, 4500);
}

function showBlackjack() {
  if (menuEl) menuEl.hidden = true;
  if (viewSlotEl) viewSlotEl.hidden = true;
  if (viewCoinflipEl) viewCoinflipEl.hidden = true;
  if (viewRouletteEl) viewRouletteEl.hidden = true;
  if (viewBlackjackEl) viewBlackjackEl.hidden = false;
  if (viewPokerEl) viewPokerEl.hidden = true;
  loadStatus();
  const msgEl = document.getElementById('blackjack-message');
  if (msgEl) msgEl.hidden = true;
  const hitStandEl = document.getElementById('blackjack-hit-stand');
  if (hitStandEl) hitStandEl.hidden = true;
  const startBtn = document.getElementById('blackjack-start');
  if (startBtn) startBtn.hidden = false;
  document.getElementById('blackjack-dealer-cards').innerHTML = '';
  document.getElementById('blackjack-player-cards').innerHTML = '';
  const dealerValEl = document.getElementById('blackjack-dealer-value');
  const playerValEl = document.getElementById('blackjack-player-value');
  if (dealerValEl) { dealerValEl.hidden = true; dealerValEl.textContent = ''; }
  if (playerValEl) { playerValEl.hidden = true; playerValEl.textContent = ''; }
}

function showPoker() {
  if (menuEl) menuEl.hidden = true;
  if (viewSlotEl) viewSlotEl.hidden = true;
  if (viewCoinflipEl) viewCoinflipEl.hidden = true;
  if (viewRouletteEl) viewRouletteEl.hidden = true;
  if (viewBlackjackEl) viewBlackjackEl.hidden = true;
  if (viewPokerEl) viewPokerEl.hidden = false;
  loadStatus();
  const lobbyEl = document.getElementById('poker-lobby');
  const gameEl = document.getElementById('poker-game');
  const createdEl = document.getElementById('poker-created');
  const errEl = document.getElementById('poker-lobby-error');
  if (errEl) errEl.hidden = true;
  (async () => {
    try {
      const res = await api('/api/poker/my-table');
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.tableId) {
        pokerTableId = data.tableId;
        pokerInviteCode = data.inviteCode || '';
        pokerEnsureConnected();
        const doJoin = () => {
          pokerSocket.emit('poker:join_room', { tableId: data.tableId });
          if (lobbyEl) lobbyEl.hidden = true;
          if (gameEl) gameEl.hidden = false;
          if (createdEl) createdEl.hidden = true;
        };
        if (pokerSocket?.connected) doJoin();
        else pokerSocket?.once('connect', doJoin);
        return;
      }
    } catch (e) {}
    if (lobbyEl) lobbyEl.hidden = false;
    if (gameEl) gameEl.hidden = true;
    if (createdEl) createdEl.hidden = true;
  })();
  pokerEnsureConnected();
}

let pokerSocket = null;
let pokerTableId = null;
let pokerInviteCode = '';

function pokerEnsureConnected() {
  if (pokerSocket?.connected) return;
  if (typeof io === 'undefined') return;
  pokerSocket = io({ path: '/socket.io', auth: { token } });
  pokerSocket.on('connect', () => {});
  pokerSocket.on('connect_error', (err) => console.warn('Poker socket:', err.message));
  pokerSocket.on('poker:state', (state) => {
    updatePokerUI(state);
  });
  pokerSocket.on('poker:error', (data) => {
    const el = document.getElementById('poker-lobby-error');
    if (el) { el.hidden = false; el.textContent = data?.message || 'Fejl'; }
  });
  pokerSocket.on('poker:player_joined', () => {});
  pokerSocket.on('poker:game_ended', (data) => {
    const msg = data?.message || 'Spillet er afsluttet.';
    const chips = data?.chipsReceived;
    const gameEl = document.getElementById('poker-game');
    const lobbyEl = document.getElementById('poker-lobby');
    if (gameEl) gameEl.hidden = true;
    if (lobbyEl) lobbyEl.hidden = false;
    const errEl = document.getElementById('poker-lobby-error');
    if (errEl) { errEl.hidden = false; errEl.textContent = msg; errEl.style.color = '#22c55e'; }
    if (chips && typeof chips === 'object') loadStatus();
  });
}

function updatePokerUI(state) {
  if (!state) return;
  const gameEl = document.getElementById('poker-game');
  const lobbyEl = document.getElementById('poker-lobby');
  const createdEl = document.getElementById('poker-created');
  if (gameEl) gameEl.hidden = false;
  if (lobbyEl) lobbyEl.hidden = true;
  if (createdEl) createdEl.hidden = true;

  const potEl = document.getElementById('poker-pot');
  if (potEl) potEl.textContent = state.pot ?? 0;

  const communityEl = document.getElementById('poker-community');
  if (communityEl) {
    communityEl.innerHTML = '';
    (state.communityCards || []).forEach((c) => {
      communityEl.appendChild(renderBlackjackCard(c, false));
    });
  }

  const seatsEl = document.getElementById('poker-seats');
  if (seatsEl) {
    seatsEl.innerHTML = '';
    (state.players || []).forEach((p, i) => {
      const div = document.createElement('div');
      div.className = 'poker-seat' + (i === state.currentTurnIndex ? ' poker-seat-turn' : '') + (p.folded ? ' poker-seat-folded' : '');
      div.innerHTML = '<div class="poker-seat-name">' + (p.name || 'Plads ' + (i + 1)) + '</div><div class="poker-seat-chips">' + p.chipsInHand + ' pt</div>';
      if (p.currentBet > 0) div.innerHTML += '<div class="poker-seat-chips">Bet: ' + p.currentBet + '</div>';
      seatsEl.appendChild(div);
    });
  }

  const myCardsEl = document.getElementById('poker-my-cards');
  if (myCardsEl) {
    myCardsEl.innerHTML = '';
    const me = (state.players || []).find((p) => p.holeCards && p.holeCards.length && p.holeCards[0] !== '??');
    if (me && me.holeCards) {
      me.holeCards.forEach((c) => myCardsEl.appendChild(renderBlackjackCard(c, false)));
    }
  }

  const startBtn = document.getElementById('poker-start-hand');
  const betActions = document.getElementById('poker-bet-actions');
  const msgEl = document.getElementById('poker-message');
  const detailEl = document.getElementById('poker-showdown-detail');
  if (state.phase !== 'showdown' && detailEl) detailEl.hidden = true;

  const endGameRow = document.getElementById('poker-end-game-row');
  const endGameBtn = document.getElementById('poker-vote-end-game');
  const endGameStatus = document.getElementById('poker-end-game-status');
  const showEndGameRow = state.phase === 'waiting' || state.phase === 'showdown';
  if (endGameRow) endGameRow.hidden = !showEndGameRow;
  if (showEndGameRow && endGameStatus) {
    const voted = state.endGameVotes;
    const needed = state.endGameVotesNeeded;
    if (typeof voted === 'number' && typeof needed === 'number' && voted > 0) {
      endGameStatus.hidden = false;
      endGameStatus.textContent = voted + ' af ' + needed + ' har stemt for at afslutte.';
    } else {
      endGameStatus.hidden = true;
    }
  }
  if (showEndGameRow && endGameBtn) {
    if (!state.endGameVotes || state.endGameVotes === 0) {
      endGameBtn.disabled = false;
      endGameBtn.textContent = 'Afslut spil og behold point';
    }
  }

  if (state.phase === 'waiting') {
    if (startBtn) {
      startBtn.hidden = false;
      const n = (state.players || []).filter((p) => p.chipsInHand > 0).length;
      startBtn.disabled = n < 2;
    }
    if (betActions) betActions.hidden = true;
    if (msgEl) {
      msgEl.hidden = false;
      let txt = (state.players || []).length >= 2 ? 'Klik "Start hånd" for at starte.' : 'Vent på mindst 2 spillere.';
      if (pokerInviteCode) txt += ' Invitationskode: ' + pokerInviteCode;
      msgEl.textContent = txt;
    }
  } else if (state.phase === 'showdown') {
    const n = (state.players || []).length;
    if (startBtn) {
      startBtn.hidden = false;
      startBtn.disabled = n < 2;
    }
    if (betActions) betActions.hidden = true;
    if (detailEl) {
      const hands = state.showdownHands || [];
      if (hands.length) {
        detailEl.hidden = false;
        const winnerSet = new Set(state.winners || []);
        let html = '<h3 class="showdown-box-title">Hænder denne runde</h3><div class="showdown-list">';
        hands.forEach((h, idx) => {
          const p = (state.players || [])[h.playerIndex];
          const name = p?.name || 'Spiller ' + (h.playerIndex + 1);
          const isWinner = winnerSet.has(h.playerIndex);
          const handLine = h.description ? (h.handName + ' – ' + h.description) : h.handName;
          const badge = isWinner ? '✓' : (idx + 1);
          const badgeClass = 'showdown-badge' + (isWinner ? ' showdown-badge-winner' : '');
          html += '<div class="showdown-item' + (isWinner ? ' showdown-item-winner' : '') + '" data-hand-index="' + idx + '">';
          html += '<span class="' + badgeClass + '" aria-label="' + (isWinner ? 'Vinder' : 'Spiller ' + (idx + 1)) + '">' + badge + '</span>';
          html += '<div class="showdown-text"><strong class="showdown-player">' + escapeHtml(name) + '</strong><span class="showdown-hand">' + escapeHtml(handLine) + '</span></div>';
          html += '<div class="showdown-cards"></div>';
          if (isWinner) html += '<span class="showdown-winner-label">Vinder</span>';
          html += '</div>';
        });
        html += '</div>';
        detailEl.innerHTML = html;
        hands.forEach((h, idx) => {
          const cards = h.bestCards || [];
          if (cards.length === 0) return;
          const countingSet = (h.countingIndices && h.countingIndices.length) ? new Set(h.countingIndices) : null;
          const row = detailEl.querySelector('.showdown-item[data-hand-index="' + idx + '"]');
          const container = row?.querySelector('.showdown-cards');
          if (!container) return;
          cards.forEach((code, i) => {
            const cardEl = renderBlackjackCard(code, false);
            if (countingSet && countingSet.has(i)) cardEl.classList.add('hand-rank-card-counts');
            container.appendChild(cardEl);
          });
        });
      } else {
        detailEl.hidden = true;
      }
    }
    if (msgEl) {
      msgEl.hidden = false;
      const winners = state.winners || [];
      const names = winners.map((wi) => (state.players || [])[wi]?.name).filter(Boolean);
      msgEl.textContent = (names.length ? 'Vinder(e): ' + names.join(', ') + '. ' : '') + (n >= 2 ? 'Klik "Start hånd" for næste runde.' : (n === 1 ? 'Du er den sidste – du vandt!' : ''));
    }
  } else {
    if (startBtn) startBtn.hidden = true;
    const me = (state.players || []).find((p) => p.holeCards && p.holeCards.length && p.holeCards[0] !== '??');
    const myIndex = me ? state.players.indexOf(me) : -1;
    const isMyTurn = myIndex >= 0 && state.currentTurnIndex === myIndex && !me.folded && !me.isAllIn;
    if (betActions) {
      betActions.hidden = !isMyTurn;
      const toCall = (state.currentBetToCall || 0) - (me ? me.totalBetThisRound || 0 : 0);
      const foldBtn = document.getElementById('poker-fold');
      const checkCallBtn = document.getElementById('poker-check-call');
      if (foldBtn) foldBtn.disabled = false;
      if (checkCallBtn) {
        checkCallBtn.disabled = false;
        checkCallBtn.textContent = toCall > 0 ? 'Call ' + toCall : 'Check';
      }
      const raiseInput = document.getElementById('poker-raise-amount');
      if (raiseInput) raiseInput.value = Math.max(state.bigBlind || 2, toCall + (state.bigBlind || 2));
    }
    if (msgEl) { msgEl.hidden = false; msgEl.textContent = isMyTurn ? 'Din tur!' : state.phase; }
  }
}

document.getElementById('poker-create-table')?.addEventListener('click', async () => {
  const errEl = document.getElementById('poker-lobby-error');
  const createdEl = document.getElementById('poker-created');
  const inviteDisplay = document.getElementById('poker-invite-display');
  if (errEl) errEl.hidden = true;
  const res = await api('/api/poker/tables', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (errEl) { errEl.hidden = false; errEl.textContent = data.error || 'Kunne ikke oprette bord'; }
    return;
  }
  pokerTableId = data.tableId;
  pokerInviteCode = data.inviteCode || '';
  pokerEnsureConnected();
  pokerSocket.emit('poker:join_room', { tableId: data.tableId });
  if (createdEl) createdEl.hidden = false;
  if (inviteDisplay) inviteDisplay.textContent = pokerInviteCode;
});

document.getElementById('poker-copy-code')?.addEventListener('click', () => {
  const code = document.getElementById('poker-invite-display')?.textContent?.trim();
  if (code && navigator.clipboard) navigator.clipboard.writeText(code);
});

document.getElementById('poker-join-table')?.addEventListener('click', async () => {
  const codeInput = document.getElementById('poker-invite-code');
  const code = (codeInput?.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const errEl = document.getElementById('poker-lobby-error');
  if (errEl) errEl.hidden = true;
  if (!code) { if (errEl) { errEl.hidden = false; errEl.textContent = 'Indtast en kode'; } return; }
  const res = await api('/api/poker/tables/by-code/' + code);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { if (errEl) { errEl.hidden = false; errEl.textContent = data.error || 'Bord ikke fundet'; } return; }
  const joinRes = await api('/api/poker/tables/' + data.tableId + '/join', { method: 'POST' });
  const joinData = await joinRes.json().catch(() => ({}));
  if (!joinRes.ok) { if (errEl) { errEl.hidden = false; errEl.textContent = joinData.error || 'Kunne ikke joine'; } return; }
  pokerTableId = data.tableId;
  pokerInviteCode = data.inviteCode || '';
  pokerEnsureConnected();
  pokerSocket.emit('poker:join_room', { tableId: data.tableId });
});

document.getElementById('poker-start-hand')?.addEventListener('click', () => {
  if (pokerSocket?.connected) pokerSocket.emit('poker:start_hand');
});
document.getElementById('poker-vote-end-game')?.addEventListener('click', () => {
  if (!pokerSocket?.connected) return;
  pokerSocket.emit('poker:vote_end_game');
  const btn = document.getElementById('poker-vote-end-game');
  if (btn) { btn.disabled = true; btn.textContent = 'Du har stemt – vent på andre'; }
});

document.getElementById('poker-fold')?.addEventListener('click', () => {
  if (pokerSocket?.connected) pokerSocket.emit('poker:action', { action: 'fold' });
});
document.getElementById('poker-check-call')?.addEventListener('click', () => {
  if (!pokerSocket?.connected) return;
  const btn = document.getElementById('poker-check-call');
  const isCall = btn && btn.textContent.startsWith('Call');
  pokerSocket.emit('poker:action', { action: isCall ? 'call' : 'check' });
});
document.getElementById('poker-raise')?.addEventListener('click', () => {
  const amount = parseInt(document.getElementById('poker-raise-amount')?.value, 10) || 2;
  if (pokerSocket?.connected) pokerSocket.emit('poker:action', { action: 'raise', amount });
});

const SUIT_SYMBOLS = { H: '♥', D: '♦', C: '♣', S: '♠' };
const SUIT_RED = { H: true, D: true, C: false, S: false };

function escapeHtml(s) {
  if (s == null) return '';
  const t = String(s);
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderBlackjackCard(cardStr, hidden) {
  const span = document.createElement('span');
  span.className = 'blackjack-card';
  if (hidden) {
    span.classList.add('blackjack-card-hidden');
    span.setAttribute('aria-label', 'Skjult kort');
    span.innerHTML = '<span class="blackjack-card-back"></span>';
    return span;
  }
  const rank = cardStr.slice(0, -1);
  const suit = cardStr.slice(-1);
  const isRed = SUIT_RED[suit];
  span.classList.add(isRed ? 'blackjack-card-red' : 'blackjack-card-black');
  span.innerHTML = `<span class="blackjack-card-rank">${rank}</span><span class="blackjack-card-suit">${SUIT_SYMBOLS[suit]}</span>`;
  span.setAttribute('aria-label', `${rank} ${SUIT_SYMBOLS[suit]}`);
  return span;
}

function renderBlackjackHand(containerEl, hand, opts = {}) {
  if (!containerEl) return;
  containerEl.innerHTML = '';
  const secondHidden = opts.secondCardHidden;
  (hand || []).forEach((card, i) => {
    const isHidden = card == null || (secondHidden && i === 1);
    containerEl.appendChild(renderBlackjackCard(card || '??', isHidden));
  });
}

function updateBlackjackUI(data) {
  const dealerCardsEl = document.getElementById('blackjack-dealer-cards');
  const playerCardsEl = document.getElementById('blackjack-player-cards');
  const dealerValEl = document.getElementById('blackjack-dealer-value');
  const playerValEl = document.getElementById('blackjack-player-value');
  const hitStandEl = document.getElementById('blackjack-hit-stand');
  const startBtn = document.getElementById('blackjack-start');
  const msgEl = document.getElementById('blackjack-message');

  if (data.dealerHand) {
    renderBlackjackHand(dealerCardsEl, data.dealerHand);
    if (dealerValEl) {
      dealerValEl.hidden = false;
      dealerValEl.textContent = 'Dealer: ' + (data.dealerValue ?? '');
    }
  } else if (data.dealerVisible) {
    const hand = [...data.dealerVisible];
    if (data.dealerHidden) hand.push(null);
    renderBlackjackHand(dealerCardsEl, hand, { secondCardHidden: true });
    if (dealerValEl) dealerValEl.hidden = true;
  }

  if (data.playerHand) {
    renderBlackjackHand(playerCardsEl, data.playerHand);
    if (playerValEl) {
      playerValEl.hidden = false;
      playerValEl.textContent = 'Dig: ' + (data.playerValue ?? '');
    }
  }

  const hasResult = data.result !== undefined;
  if (hasResult) {
    if (startBtn) { startBtn.hidden = false; startBtn.disabled = false; }
    if (hitStandEl) hitStandEl.hidden = true;
    if (msgEl) {
      msgEl.hidden = false;
      msgEl.className = 'flip-message ' + (data.result === 'win' || data.result === 'blackjack' ? 'win' : data.result === 'push' ? '' : 'lose');
      msgEl.textContent = data.message || '';
    }
    loadStatus();
    return;
  }

  if (data.canHit !== undefined) {
    if (startBtn) startBtn.hidden = true;
    if (hitStandEl) {
      hitStandEl.hidden = false;
      const hitBtn = document.getElementById('blackjack-hit');
      const standBtn = document.getElementById('blackjack-stand');
      if (hitBtn) hitBtn.disabled = false;
      if (standBtn) standBtn.disabled = false;
    }
    if (msgEl) msgEl.hidden = true;
  }
}

async function spinRoulette(bet) {
  const btnRed = document.getElementById('roulette-bet-red');
  const btnBlack = document.getElementById('roulette-bet-black');
  const btnGreen = document.getElementById('roulette-bet-green');
  const resultEl = document.getElementById('roulette-result');
  const msgEl = document.getElementById('roulette-message');
  if (btnRed) btnRed.disabled = true;
  if (btnBlack) btnBlack.disabled = true;
  if (btnGreen) btnGreen.disabled = true;
  if (msgEl) { msgEl.hidden = false; msgEl.textContent = 'Spinner…'; msgEl.className = 'flip-message'; }
  if (resultEl) resultEl.hidden = true;

  const res = await api('/api/casino/roulette/spin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bet }),
  });
  const data = await res.json().catch(() => ({}));

    if (!res.ok) {
    if (resultEl) { resultEl.hidden = false; resultEl.className = 'roulette-result'; resultEl.textContent = ''; }
    if (msgEl) { msgEl.hidden = false; msgEl.className = 'flip-message lose'; msgEl.textContent = data.error || 'Noget gik galt.'; }
    await loadStatus();
    if (btnRed) btnRed.disabled = false;
    if (btnBlack) btnBlack.disabled = false;
    if (btnGreen) btnGreen.disabled = false;
    return;
  }

  spinRouletteWheelToResult(data.result, () => {
    if (resultEl) {
      resultEl.hidden = false;
      resultEl.className = 'roulette-result roulette-result-' + (data.result || '');
      resultEl.textContent = data.result === 'red' ? '🔴 Rød' : data.result === 'black' ? '⚫ Sort' : '🟢 Grøn (0)';
    }
    if (msgEl) {
      msgEl.hidden = false;
      msgEl.className = 'flip-message ' + (data.win ? 'win' : 'lose');
      msgEl.textContent = data.win ? 'Du vandt ' + (data.payout || 0) + ' point!' : 'Desværre – du tabte.';
    }
    loadStatus();
  });
}

document.getElementById('casino-go-coinflip')?.addEventListener('click', showCoinflip);
document.getElementById('casino-go-slot')?.addEventListener('click', showSlot);
document.getElementById('casino-go-roulette')?.addEventListener('click', showRoulette);
document.getElementById('casino-go-blackjack')?.addEventListener('click', showBlackjack);
document.getElementById('casino-go-poker')?.addEventListener('click', showPoker);
document.getElementById('casino-back-from-slot')?.addEventListener('click', (e) => { e.preventDefault(); showMenu(); });
document.getElementById('casino-back-from-coinflip')?.addEventListener('click', (e) => { e.preventDefault(); showMenu(); });
document.getElementById('casino-back-from-roulette')?.addEventListener('click', (e) => { e.preventDefault(); showMenu(); });
document.getElementById('casino-back-from-blackjack')?.addEventListener('click', (e) => { e.preventDefault(); showMenu(); });
document.getElementById('casino-back-from-poker')?.addEventListener('click', (e) => { e.preventDefault(); showMenu(); });
document.getElementById('roulette-bet-red')?.addEventListener('click', () => spinRoulette('red'));
document.getElementById('roulette-bet-black')?.addEventListener('click', () => spinRoulette('black'));
document.getElementById('roulette-bet-green')?.addEventListener('click', () => spinRoulette('green'));

document.getElementById('blackjack-start')?.addEventListener('click', async () => {
  const startBtn = document.getElementById('blackjack-start');
  const msgEl = document.getElementById('blackjack-message');
  if (startBtn?.disabled) return;
  startBtn.disabled = true;
  if (msgEl) { msgEl.hidden = true; msgEl.textContent = ''; }
  const res = await api('/api/casino/blackjack/start', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (msgEl) { msgEl.hidden = false; msgEl.className = 'flip-message lose'; msgEl.textContent = data.error || 'Noget gik galt.'; }
    loadStatus();
    startBtn.disabled = false;
    return;
  }
  updateBlackjackUI(data);
  loadStatus();
});

document.getElementById('blackjack-hit')?.addEventListener('click', async () => {
  const res = await api('/api/casino/blackjack/hit', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msgEl = document.getElementById('blackjack-message');
    if (msgEl) { msgEl.hidden = false; msgEl.className = 'flip-message lose'; msgEl.textContent = data.error || 'Noget gik galt.'; }
    loadStatus();
    return;
  }
  updateBlackjackUI(data);
});

document.getElementById('blackjack-stand')?.addEventListener('click', async () => {
  const hitBtn = document.getElementById('blackjack-hit');
  const standBtn = document.getElementById('blackjack-stand');
  if (hitBtn) hitBtn.disabled = true;
  if (standBtn) standBtn.disabled = true;
  const res = await api('/api/casino/blackjack/stand', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msgEl = document.getElementById('blackjack-message');
    if (msgEl) { msgEl.hidden = false; msgEl.className = 'flip-message lose'; msgEl.textContent = data.error || 'Noget gik galt.'; }
    loadStatus();
    if (hitBtn) hitBtn.disabled = false;
    if (standBtn) standBtn.disabled = false;
    return;
  }
  updateBlackjackUI(data);
});

setReels('?', '?', '?');
loadStatus();

function initHandRankingsVisual() {
  const section = document.getElementById('poker-hand-rankings-visual');
  if (!section) return;
  section.querySelectorAll('.hand-rank-item').forEach((row) => {
    const cardsStr = row.getAttribute('data-cards');
    const countingStr = row.getAttribute('data-counting');
    const cardsContainer = row.querySelector('.hand-rank-cards');
    if (!cardsStr || !cardsContainer) return;
    const countingIndices = countingStr ? new Set(countingStr.trim().split(/\s+/).map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n))) : null;
    cardsContainer.innerHTML = '';
    cardsStr.trim().split(/\s+/).forEach((code, i) => {
      const cardEl = renderBlackjackCard(code, false);
      if (countingIndices && countingIndices.has(i)) cardEl.classList.add('hand-rank-card-counts');
      cardsContainer.appendChild(cardEl);
    });
  });
}
initHandRankingsVisual();
