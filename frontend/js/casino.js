const token = localStorage.getItem('ontime_token');
if (!token) {
  window.location.href = '/';
}

const api = (path, opts = {}) =>
  fetch(path, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${token}` },
  });

const reel1 = document.getElementById('reel1');
const reel2 = document.getElementById('reel2');
const reel3 = document.getElementById('reel3');
const reelsEl = document.getElementById('slot-reels');
const leverBtn = document.getElementById('slot-lever');
const messageEl = document.getElementById('slot-message');
const badgeEl = document.getElementById('slot-badge');
const balanceEl = document.getElementById('casino-balance');

function setReels(s1, s2, s3) {
  if (reel1) reel1.querySelector('.reel-symbol').textContent = s1 ?? '?';
  if (reel2) reel2.querySelector('.reel-symbol').textContent = s2 ?? '?';
  if (reel3) reel3.querySelector('.reel-symbol').textContent = s3 ?? '?';
}

function setSpinning(on) {
  if (reelsEl) reelsEl.classList.toggle('spinning', on);
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

leverBtn.addEventListener('click', async () => {
  if (leverBtn.disabled) return;
  leverBtn.disabled = true;
  setReels('?', '?', '?');
  setSpinning(true);
  if (messageEl) messageEl.hidden = true;
  if (badgeEl) badgeEl.hidden = true;

  const res = await api('/api/casino/spin', { method: 'POST' });
  const data = await res.json().catch(() => ({}));

  setSpinning(false);

  if (!res.ok) {
    if (messageEl) {
      messageEl.hidden = false;
      messageEl.className = 'slot-message lose';
      messageEl.textContent = data.error || 'Noget gik galt.';
    }
    loadStatus();
    return;
  }

  setReels(data.symbols?.[0], data.symbols?.[1], data.symbols?.[2]);
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

setReels('?', '?', '?');
loadStatus();
