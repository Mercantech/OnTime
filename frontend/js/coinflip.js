const token = localStorage.getItem('ontime_token');
if (!token) {
  window.location.href = '/';
}

const api = (path, opts = {}) =>
  fetch(path, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${token}` },
  });

const coinEl = document.getElementById('coin');
const flipBtn = document.getElementById('flip-btn');
const messageEl = document.getElementById('flip-message');
const balanceEl = document.getElementById('coinflip-balance');

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

async function loadStatus() {
  try {
    const res = await api('/api/games/coinflip/status');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) {
        window.location.href = '/';
        return;
      }
      if (balanceEl) balanceEl.textContent = '–';
      if (flipBtn) flipBtn.disabled = true;
      return;
    }
    if (balanceEl) balanceEl.textContent = data.balance ?? '–';
    if (flipBtn) flipBtn.disabled = !data.canFlip;
    if (messageEl && data.alreadyFlippedToday) {
      messageEl.hidden = false;
      messageEl.className = 'flip-message lose';
      messageEl.textContent = 'Du har allerede flippet i dag. Kom tilbage i morgen!';
    }
  } catch (e) {
    console.error('loadStatus:', e);
    if (balanceEl) balanceEl.textContent = '–';
    if (flipBtn) flipBtn.disabled = true;
  }
}

document.getElementById('logout')?.addEventListener('click', () => {
  localStorage.removeItem('ontime_token');
  window.location.href = '/';
});

flipBtn?.addEventListener('click', async () => {
  if (flipBtn.disabled) return;
  flipBtn.disabled = true;
  if (messageEl) messageEl.hidden = true;
  if (coinEl) coinEl.classList.add('flipping');

  const res = await api('/api/games/coinflip/flip', { method: 'POST' });
  const data = await res.json().catch(() => ({}));

  setTimeout(() => {
    if (coinEl) coinEl.classList.remove('flipping');
    if (!res.ok) {
      if (messageEl) {
        messageEl.hidden = false;
        messageEl.className = 'flip-message lose';
        messageEl.textContent = data.error || 'Noget gik galt.';
      }
      loadStatus();
      return;
    }
    if (messageEl) {
      messageEl.hidden = false;
      messageEl.className = 'flip-message ' + (data.win ? 'win' : 'lose');
      messageEl.textContent = data.win
        ? 'Krone! Du vandt 2 point og får ikon på leaderboard.'
        : 'Plat. Bedre held næste gang!';
    }
    loadStatus();
  }, 800);
});

loadUser();
loadStatus();
