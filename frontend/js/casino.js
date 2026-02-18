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
    const res = await api('/api/casino/status');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) {
        window.location.href = '/';
        return;
      }
      if (balanceEl) balanceEl.textContent = '–';
      if (leverBtn) leverBtn.disabled = true;
      return;
    }
    if (balanceEl) balanceEl.textContent = data.balance ?? '–';
    if (leverBtn) leverBtn.disabled = !data.canSpin;
    if (messageEl) {
      if (data.alreadySpunToday) {
        messageEl.hidden = false;
        messageEl.className = 'slot-message lose';
        messageEl.textContent = 'Du har allerede spillet i dag. Kom tilbage i morgen!';
      } else {
        messageEl.hidden = true;
      }
    }
    if (badgeEl) badgeEl.hidden = true;
  } catch (e) {
    console.error('loadStatus:', e);
    if (balanceEl) balanceEl.textContent = '–';
    if (leverBtn) leverBtn.disabled = true;
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

setReels('?', '?', '?');
loadStatus();
