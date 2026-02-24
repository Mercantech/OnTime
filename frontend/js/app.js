const token = localStorage.getItem('ontime_token');
if (!token) {
  window.location.href = '/';
}

const api = (path, opts = {}) =>
  fetch(path, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${token}` },
  });

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

let locationConfig = null;
let watchId = null;
let currentUser = null;

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function isWeekend() {
  const d = new Date();
  const day = d.getDay();
  return day === 0 || day === 6; // søndag=0, lørdag=6
}

async function loadLocationConfig() {
  if (locationConfig) return locationConfig;
  const res = await fetch('/api/config');
  locationConfig = await res.json();
  return locationConfig;
}

function updateLocationUI(distanceMeters, withinRange, checkedIn) {
  const ring = document.getElementById('location-ring');
  const status = document.getElementById('location-status');
  const btn = document.getElementById('checkin-btn');
  if (!ring || !status || !btn) return;

  if (isWeekend()) {
    ring.className = 'location-ring waiting';
    ring.innerHTML = '<span class="distance-value">–</span><span> m</span>';
    status.textContent = 'Indstempling kun på hverdage (lørdag og søndag tæller ikke).';
    status.className = 'location-status';
    btn.disabled = true;
    btn.className = 'btn-checkin not-ready';
    btn.textContent = 'Hviledag – ingen indstempling';
    return;
  }

  if (distanceMeters == null) {
    ring.className = 'location-ring waiting';
    ring.innerHTML = '<span class="distance-value">–</span><span> m</span>';
    status.textContent = 'Venter på GPS…';
    status.className = 'location-status';
    btn.disabled = true;
    btn.className = 'btn-checkin not-ready';
    btn.textContent = 'Stempel ind';
    return;
  }

  ring.querySelector('.distance-value').textContent = distanceMeters;
  ring.classList.remove('waiting', 'far', 'near');
  status.classList.remove('near', 'far');

  if (withinRange) {
    ring.classList.add('near');
    status.classList.add('near');
    status.textContent = 'Du er på skolen – du kan stemple ind!';
    if (checkedIn) {
      btn.disabled = true;
      btn.className = 'btn-checkin not-ready';
      btn.textContent = 'Allerede stemplet ind i dag';
    } else {
      btn.disabled = false;
      btn.className = 'btn-checkin ready';
      btn.textContent = 'Stempel ind';
    }
  } else {
    ring.classList.add('far');
    status.classList.add('far');
    status.textContent = `Du er ${distanceMeters} m fra skolen. Gå tættere på for at stemple ind.`;
    if (!checkedIn) {
      btn.disabled = true;
      btn.className = 'btn-checkin not-ready';
      btn.textContent = 'Du skal være på skolen';
    }
  }
}

let hasCheckedInToday = false;

async function loadUser() {
  const res = await api('/api/auth/me');
  if (!res.ok) {
    localStorage.removeItem('ontime_token');
    window.location.href = '/';
    return;
  }
  currentUser = await res.json();
  const nameEl = document.getElementById('user-name');
  if (nameEl) nameEl.textContent = currentUser.name + ' · ' + currentUser.className;
  const adminLink = document.getElementById('admin-link');
  if (adminLink && currentUser.isAdmin) adminLink.hidden = false;

  const classDashboardNavLink = document.getElementById('class-dashboard-link');
  if (classDashboardNavLink && currentUser.className) {
    classDashboardNavLink.href = '/klasse/' + encodeURIComponent(currentUser.className);
    classDashboardNavLink.hidden = false;
  }

  const greeting = document.getElementById('hero-greeting');
  if (greeting) greeting.textContent = 'Hej, ' + currentUser.name + '!';
  const classDashboardLink = document.getElementById('link-class-dashboard');
  if (classDashboardLink && currentUser.className) classDashboardLink.href = '/klasse/' + encodeURIComponent(currentUser.className);
}

async function loadTodayCheckin() {
  const res = await api('/api/checkin/today');
  const data = await res.json();
  hasCheckedInToday = !!data.checkedIn;
  const statusEl = document.getElementById('checkin-status');
  const msgEl = document.getElementById('hero-message');
  const btn = document.getElementById('checkin-btn');

  if (data.checkedIn) {
    const feedback = data.message || ('Stemplet ind i dag ✓ Kl. ' + new Date(data.checkedAt).toLocaleTimeString('da-DK') + ' – ' + data.points + ' point.');
    if (msgEl) msgEl.textContent = feedback;
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = feedback;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Allerede stemplet ind i dag';
      btn.className = 'btn-checkin not-ready';
    }
  } else {
    if (msgEl) {
      if (isWeekend()) {
        msgEl.textContent = 'I dag er en hviledag – indstempling kun på hverdage.';
      } else {
        msgEl.textContent = locationConfig && locationConfig.useWiFiCheck ? 'Forbind til WiFi-netværket MAGS-OLC for at stemple ind.' : 'Stempel ind når du er på skolen.';
      }
    }
    if (statusEl) statusEl.hidden = true;
    if (btn && isWeekend()) {
      btn.disabled = true;
      btn.className = 'btn-checkin not-ready';
      btn.textContent = 'Hviledag – ingen indstempling';
    } else if (btn && locationConfig && locationConfig.useWiFiCheck) {
      btn.disabled = false;
      btn.className = 'btn-checkin ready';
      btn.textContent = 'Stempel ind';
    } else if (btn && !locationConfig?.useWiFiCheck) {
      btn.disabled = true;
      btn.className = 'btn-checkin not-ready';
      btn.textContent = 'Du skal være på skolen';
    }
  }
}

async function loadMyStats() {
  try {
    const res = await api('/api/leaderboard/my-stats');
    const data = await res.json().catch(() => ({}));
    const el = document.getElementById('stat-points');
    const maxEl = document.getElementById('stat-points-max');
    if (el) el.textContent = data.totalPoints != null ? data.totalPoints : '–';
    if (maxEl) maxEl.textContent = (data.maxPossible != null ? '/ ' + data.maxPossible + ' pt' : '/ – pt');
  } catch (e) {
    const el = document.getElementById('stat-points');
    const maxEl = document.getElementById('stat-points-max');
    if (el) el.textContent = '–';
    if (maxEl) maxEl.textContent = '/ – pt';
  }
}

async function loadStreak() {
  try {
    const res = await api('/api/leaderboard/streak');
    const data = await res.json().catch(() => ({}));
    const streak = data.currentStreak != null ? data.currentStreak : 0;
    const el = document.getElementById('stat-streak');
    if (el) el.textContent = streak;
    const card = document.getElementById('stat-card-streak');
    if (card) card.classList.toggle('has-streak', streak > 0);
  } catch (e) {
    const el = document.getElementById('stat-streak');
    if (el) el.textContent = '0';
    const card = document.getElementById('stat-card-streak');
    if (card) card.classList.remove('has-streak');
  }
}

async function loadLeaderboard() {
  try {
    const res = await api('/api/leaderboard/class');
    const data = await res.json().catch(() => ({}));
    const totalEl = document.getElementById('leaderboard-total');
    const podiumEl = document.getElementById('leaderboard-podium');
    const listEl = document.getElementById('leaderboard');
    const students = Array.isArray(data.students) ? data.students : [];
    if (totalEl) {
      totalEl.innerHTML = `<strong>Klasse total:</strong> ${data.classTotal ?? '–'} / ${data.maxPossibleClass ?? '–'} point (${data.classPercentage ?? '–'}%)`;
    }
    const gameLabels = { wordle: 'Wordle', flag: 'Dagens flag', sudoku: 'Dagens Sudoku', coinflip: 'Coinflip', one_armed_bandit: 'Enarmet bandit', roulette: 'Roulette', blackjack: 'Blackjack', poker: 'Poker' };
    const gameIcons = (gamesToday, maxVisible = 5) => {
      const g = Array.isArray(gamesToday) ? gamesToday : [];
      const order = ['wordle', 'flag', 'sudoku', 'coinflip', 'one_armed_bandit', 'roulette', 'blackjack', 'poker'];
      const parts = [];
      order.forEach((key) => {
        if (!g.includes(key)) return;
        const label = gameLabels[key] || key;
        if (key === 'wordle') parts.push('<a href="/spil/wordle" class="lb-game-link" title="' + label + '">🟩</a>');
        else if (key === 'flag') parts.push('<a href="/spil/flag" class="lb-game-link" title="' + label + '">🏳️</a>');
        else if (key === 'sudoku') parts.push('<a href="/spil/sudoku" class="lb-game-link" title="' + label + '">🔢</a>');
        else if (key === 'coinflip') parts.push('<span class="lb-game-icon" title="' + label + '">🪙</span>');
        else if (key === 'one_armed_bandit') parts.push('<span class="lb-game-icon" title="' + label + '">🎰</span>');
        else if (key === 'roulette') parts.push('<span class="lb-game-icon" title="' + label + '">🎡</span>');
        else if (key === 'blackjack') parts.push('<span class="lb-game-icon" title="' + label + '">🃏</span>');
        else if (key === 'poker') parts.push('<span class="lb-game-icon" title="' + label + '">🎴</span>');
      });
      if (parts.length === 0) return '';
      if (parts.length <= maxVisible) return '<span class="lb-games" title="Spil i dag">' + parts.join('') + '</span>';
      const keysInOrder = order.filter((k) => g.includes(k));
      const visible = parts.slice(0, maxVisible).join('');
      const restLabels = keysInOrder.slice(maxVisible).map((k) => gameLabels[k] || k);
      const moreTitle = restLabels.length ? 'Flere: ' + restLabels.join(', ') : 'Flere spil';
      return '<span class="lb-games" title="Spil i dag">' + visible + '<span class="lb-games-more" title="' + moreTitle.replace(/"/g, '&quot;') + '">+' + (parts.length - maxVisible) + '</span></span>';
    };

    if (podiumEl) {
      const top3 = students.slice(0, 3);
      if (top3.length >= 3) {
        const order = [top3[1], top3[0], top3[2]];
        const places = ['place-2', 'place-1', 'place-3'];
        podiumEl.innerHTML = order.map((s, i) =>
          '<div class="podium-place ' + places[i] + '">' +
          '<span class="podium-avatar">' + s.rank + '</span>' +
          '<span class="podium-name"><a href="/profil/' + (s.userId || '') + '" class="podium-profile-link">' + escapeHtml(s.name) + '</a>' + gameIcons(s.gamesToday) + '</span>' +
          '<span class="podium-points">' + s.totalPoints + ' pt</span>' +
          '<div class="podium-step">' + s.rank + '. plads</div></div>'
        ).join('');
      } else {
        podiumEl.innerHTML = '';
      }
    }
    if (listEl) {
      const rest = students.slice(3);
      listEl.innerHTML = rest.length
        ? '<ul class="leaderboard-list">' + rest.map(s => `<li><span class="rank">${s.rank}</span><span class="name"><a href="/profil/${s.userId || ''}" class="leaderboard-profile-link">${escapeHtml(s.name)}</a>${gameIcons(s.gamesToday)}</span><span class="points">${s.totalPoints} pt (${s.percentage}%)</span></li>`).join('') + '</ul>'
        : students.length > 0 ? '<p class="muted">Kun top 3 i klassen.</p>' : '<p class="muted">Ingen data</p>';
    }
    const classPctEl = document.getElementById('stat-class-pct');
    if (classPctEl) classPctEl.textContent = data.classPercentage != null ? data.classPercentage : '–';
  } catch (e) {
    const totalEl = document.getElementById('leaderboard-total');
    const listEl = document.getElementById('leaderboard');
    if (totalEl) totalEl.textContent = '';
    if (listEl) listEl.innerHTML = '<p class="muted">Kunne ikke hente leaderboard</p>';
    const classPctEl = document.getElementById('stat-class-pct');
    if (classPctEl) classPctEl.textContent = '–';
  }
}

function drawBurndownChart(canvas, data) {
  if (!canvas || !data || !data.labels || !data.labels.length) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width;
  const h = rect.height;
  const pad = { top: 12, right: 12, bottom: 28, left: 36 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const maxVal = Math.max(...data.ideal, ...data.actual, 1);

  ctx.fillStyle = '#1a1a20';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#2e2e38';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + chartH);
  ctx.lineTo(pad.left + chartW, pad.top + chartH);
  ctx.stroke();

  const n = data.labels.length;
  const step = n > 1 ? chartW / (n - 1) : chartW;

  function y(val) {
    return pad.top + chartH - (val / maxVal) * chartH;
  }
  function x(i) {
    return pad.left + (n > 1 ? (i / (n - 1)) * chartW : pad.left);
  }

  ctx.strokeStyle = 'rgba(34, 197, 94, 0.6)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x(0), y(data.ideal[0]));
  for (let i = 1; i < n; i++) ctx.lineTo(x(i), y(data.ideal[i]));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x(0), y(data.actual[0]));
  for (let i = 1; i < n; i++) ctx.lineTo(x(i), y(data.actual[i]));
  ctx.stroke();

  ctx.fillStyle = '#9090a0';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i++) {
    const label = data.labels[i];
    if (i % Math.max(1, Math.floor(n / 8)) === 0 || i === n - 1) {
      ctx.fillText(label, x(i), pad.top + chartH + 16);
    }
  }
}

const BADGE_ICONS = {
  first_checkin: '⭐',
  streak_3: '🔥',
  streak_5: '🔥',
  streak_7: '😏',
  streak_10: '🏆',
  perfect_week: '✓',
  early_bird: '🌅',
  wordle_win: '🟩',
  flag_win: '🏳️',
  before_7: '⏰',
  exactly_8: '8️⃣',
  month_top: '👑',
  april_20: '🌿',
  midnight: '🌙',
  exactly_1234: '🔢',
  date_13: '🍀',
  pi_day: '🥧',
  agent_007: '🕵️',
  programmer_day: '💻',
  nytaarsdag: '🎉',
  syden: '🪄',
  hakke_stifter: '🍺',
  one_armed_bandit: '🎰',
};

async function loadBadges() {
  const el = document.getElementById('badges-row');
  if (!el) return;
  try {
    const res = await api('/api/badges/me');
    const data = await res.json().catch(() => ({}));
    const badges = Array.isArray(data.badges) ? data.badges : [];
    el.innerHTML = badges.length === 0
      ? '<p class="muted">Ingen badges endnu.</p>'
      : badges.map((b) => {
          const earned = !!b.earnedAt;
          const secret = !!b.secret;
          const icon = BADGE_ICONS[b.key] || '•';
          const title = secret ? (earned ? (b.name + ' – ' + (b.description || '')) : 'Shhh 🤫 det er en hemmelighed') : (b.description || '');
          const nameHtml = secret ? '' : ('<span class="badge-name">' + escapeHtml(b.name) + '</span>');
          const dateHtml = (!secret && earned) ? ('<span class="badge-date">' + (b.earnedAt || '') + '</span>') : '';
          return (
            '<div class="badge-item ' + (earned ? 'earned badge--' + b.key : 'locked') + (secret ? ' badge-secret' : '') + '" title="' + escapeHtml(title) + '">' +
            '<span class="badge-icon">' + icon + '</span>' +
            nameHtml +
            dateHtml +
            '</div>'
          );
        }).join('');
  } catch (e) {
    el.innerHTML = '<p class="muted">Kunne ikke hente badges.</p>';
  }
}

function drawPointsHistoryChart(canvas, data) {
  if (!canvas || !data || !data.labels || !data.labels.length) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width;
  const h = rect.height;
  const pad = { top: 12, right: 12, bottom: 28, left: 40 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const balance = data.balance || [];
  const minVal = Math.min(...balance, 0);
  const maxVal = Math.max(...balance, 1);
  const range = maxVal - minVal || 1;

  ctx.fillStyle = '#1a1a20';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#2e2e38';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + chartH);
  ctx.lineTo(pad.left + chartW, pad.top + chartH);
  ctx.stroke();

  const n = data.labels.length;
  function y(val) {
    return pad.top + chartH - ((val - minVal) / range) * chartH;
  }
  function x(i) {
    return pad.left + (n > 1 ? (i / (n - 1)) * chartW : 0);
  }

  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x(0), y(balance[0]));
  for (let i = 1; i < n; i++) ctx.lineTo(x(i), y(balance[i]));
  ctx.stroke();

  ctx.fillStyle = '#9090a0';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i++) {
    if (i % Math.max(1, Math.floor(n / 8)) === 0 || i === n - 1) {
      ctx.fillText(data.labels[i], x(i), pad.top + chartH + 16);
    }
  }
}

let lastBurndownData = null;
let lastPointsHistoryData = null;
async function loadPointsHistory() {
  try {
    const res = await api('/api/leaderboard/points-history');
    const data = await res.json().catch(() => ({}));
    lastPointsHistoryData = data;
    const canvas = document.getElementById('points-history-chart');
    if (canvas && data.labels && data.labels.length) drawPointsHistoryChart(canvas, data);
  } catch (e) {
    lastPointsHistoryData = null;
  }
}

async function loadBurndown() {
  try {
    const res = await api('/api/leaderboard/burndown');
    const data = await res.json().catch(() => ({}));
    lastBurndownData = data;
    const canvas = document.getElementById('burndown-chart');
    if (canvas && data.labels && data.labels.length) drawBurndownChart(canvas, data);
  } catch (e) {
    lastBurndownData = null;
  }
}

async function loadRecent() {
  const el = document.getElementById('recent-list');
  if (!el) return;
  try {
    const res = await api('/api/leaderboard/recent');
    const data = await res.json().catch(() => []);
    const list = Array.isArray(data) ? data : [];
    if (!list.length) {
      el.innerHTML = '<li class="muted">Ingen indstemplinger denne måned</li>';
      return;
    }
    el.innerHTML = list.map(r => {
      const t = new Date(r.time);
      const timeStr = t.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
      const dateStr = formatDateOnlyForDisplay(r.date);
      return `<li><span class="recent-date">${dateStr} kl. ${timeStr}</span><span class="recent-points">${r.points} pt</span></li>`;
    }).join('');
  } catch (e) {
    el.innerHTML = '<li class="muted">Kunne ikke hente</li>';
  }
}

function formatDateOnlyForDisplay(isoDateStr) {
  if (!isoDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(isoDateStr)) return isoDateStr || '';
  const [y, m, day] = isoDateStr.split('-').map(Number);
  const date = new Date(y, m - 1, day);
  return date.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });
}

function localDateKey(year, month, day) {
  return year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function renderCalendarHeatmap(container, checkInDates) {
  const set = new Set(checkInDates || []);
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const dayNames = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];
  let html = '<span class="day-label">' + first.toLocaleDateString('da-DK', { month: 'long', year: 'numeric' }) + '</span>';
  const startDow = (first.getDay() + 6) % 7;
  const daysInMonth = last.getDate();
  const empty = Array(startDow).fill('<div class="day-cell weekend"></div>').join('');
  const cells = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const key = localDateKey(year, month, d);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const hasCheckin = set.has(key);
    let cls = 'day-cell';
    if (isWeekend) cls += ' weekend';
    if (hasCheckin) cls += ' has-checkin';
    cells.push('<div class="' + cls + '" title="' + (hasCheckin ? key + ' ✓' : key) + '">' + d + '</div>');
  }
  html += empty + cells.join('');
  container.innerHTML = html;
}

async function loadCalendar() {
  const el = document.getElementById('calendar-heatmap');
  if (!el) return;
  try {
    const res = await api('/api/leaderboard/calendar');
    const data = await res.json().catch(() => []);
    renderCalendarHeatmap(el, Array.isArray(data) ? data : []);
  } catch (e) {
    renderCalendarHeatmap(el, []);
  }
}

function onPosition(lat, lng) {
  if (!locationConfig) return;
  const dist = haversineMeters(lat, lng, locationConfig.schoolLat, locationConfig.schoolLng);
  const within = dist <= locationConfig.radiusMeters;
  updateLocationUI(dist, within, hasCheckedInToday);
}

function startLocationWatch() {
  if (!navigator.geolocation) {
    updateLocationUI(null, false, hasCheckedInToday);
    const status = document.getElementById('location-status');
    if (status) status.textContent = 'Din enhed understøtter ikke GPS.';
    return;
  }
  const opts = { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 };
  watchId = navigator.geolocation.watchPosition(
    (pos) => onPosition(pos.coords.latitude, pos.coords.longitude),
    (err) => {
      const status = document.getElementById('location-status');
      if (status) status.textContent = err.code === 1 ? 'Placering er blokeret.' : 'Kunne ikke hente position.';
      updateLocationUI(null, false, hasCheckedInToday);
    },
    opts
  );
}

document.getElementById('checkin-btn').addEventListener('click', async () => {
  const btn = document.getElementById('checkin-btn');
  const statusEl = document.getElementById('checkin-status');
  btn.disabled = true;
  btn.textContent = 'Stempler…';
  if (statusEl) statusEl.hidden = true;
  let body = {};
  if (!locationConfig.useWiFiCheck) {
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true });
      });
      body = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch (e) {
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = 'Kunne ikke hente position. Prøv igen.';
        statusEl.classList.remove('checkin-success');
        statusEl.classList.add('error');
      }
      const ring = document.getElementById('location-ring');
      updateLocationUI(ring && ring.classList.contains('near') ? 0 : 999, ring && ring.classList.contains('near'), false);
      return;
    }
  }
  const res = await api('/api/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = data.error || 'Kunne ikke stemple ind';
      statusEl.classList.remove('checkin-success');
      statusEl.classList.add('error');
    }
    if (locationConfig.useWiFiCheck) {
      btn.disabled = false;
      btn.className = 'btn-checkin ready';
      btn.textContent = 'Stempel ind';
    } else if (body.lat != null) {
      onPosition(body.lat, body.lng);
    }
    return;
  }
  hasCheckedInToday = true;
  const feedback = data.message || 'Stemplet ind i dag ✓';
  if (statusEl) {
    statusEl.hidden = false;
    statusEl.textContent = feedback;
    statusEl.classList.add('checkin-success');
    statusEl.classList.remove('error');
  }
  const msgEl = document.getElementById('hero-message');
  if (msgEl) msgEl.textContent = feedback;
  btn.textContent = 'Allerede stemplet ind i dag';
  btn.className = 'btn-checkin not-ready';
  loadMyStats();
  loadStreak();
  loadLeaderboard();
  loadBadges();
  loadPointsHistory();
  loadBurndown();
  loadRecent();
  loadCalendar();
});

document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem('ontime_token');
  window.location.href = '/';
});

function showWiFiMode() {
  const geoIntro = document.getElementById('geo-intro');
  const wifiIntro = document.getElementById('wifi-intro');
  const geoWidget = document.getElementById('geo-widget');
  const wifiWidget = document.getElementById('wifi-widget');
  const locationCard = document.getElementById('location-card');
  if (geoIntro) geoIntro.hidden = true;
  if (wifiIntro) wifiIntro.hidden = false;
  if (geoWidget) geoWidget.hidden = true;
  if (wifiWidget) wifiWidget.hidden = false;
  if (locationCard) locationCard.hidden = true;
  const nameEl = document.getElementById('wifi-name');
  if (nameEl && locationConfig) nameEl.textContent = locationConfig.wifiName || 'MAGS-OLC';
}

function showGeoMode() {
  const geoIntro = document.getElementById('geo-intro');
  const wifiIntro = document.getElementById('wifi-intro');
  const geoWidget = document.getElementById('geo-widget');
  const wifiWidget = document.getElementById('wifi-widget');
  const locationCard = document.getElementById('location-card');
  if (geoIntro) geoIntro.hidden = false;
  if (wifiIntro) wifiIntro.hidden = true;
  if (geoWidget) geoWidget.hidden = false;
  if (wifiWidget) wifiWidget.hidden = false;
  if (locationCard) locationCard.hidden = false;
}

async function loadDailyQuote() {
  const el = document.getElementById('daily-quote');
  if (!el) return;
  const now = new Date();
  const key = (now.getMonth() + 1).toString().padStart(2, '0') + '-' + now.getDate().toString().padStart(2, '0');
  try {
    const res = await fetch('/daily-quotes.json');
    const data = await res.json().catch(() => ({}));
    const entry = data[key] || data.default || { quote: '', author: '' };
    if (entry.quote) {
      el.innerHTML = '<p class="daily-quote-text">' + escapeHtml(entry.quote) + '</p>' +
        (entry.author ? '<cite class="daily-quote-author">' + escapeHtml(entry.author) + '</cite>' : '');
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  } catch (e) {
    el.hidden = true;
  }
}

function getLocalISODate(d = new Date()) {
  return (
    d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function normalizeWordleWord(s) {
  return String(s || '').trim().toLocaleLowerCase('da-DK');
}

function scoreWordleGuess(guess, answer) {
  const g = guess.split('');
  const a = answer.split('');
  const res = Array(5).fill('absent');
  // Tæl hvor mange af hvert bogstav der er tilbage i svaret (bruges til grøn, derefter gul)
  const answerCount = {};
  for (let i = 0; i < 5; i++) {
    const c = a[i];
    answerCount[c] = (answerCount[c] || 0) + 1;
  }
  // Først: markér korrekte (grøn) og brug dem i tælleren
  for (let i = 0; i < 5; i++) {
    if (g[i] === a[i]) {
      res[i] = 'correct';
      answerCount[g[i]]--;
    }
  }
  // Derefter: markér kun så mange gule pr. bogstav som svaret har (resten grå)
  for (let i = 0; i < 5; i++) {
    if (res[i] === 'correct') continue;
    const letter = g[i];
    if ((answerCount[letter] || 0) > 0) {
      res[i] = 'present';
      answerCount[letter]--;
    }
  }
  return res;
}

function upgradeKeyState(prev, next) {
  const order = { correct: 3, present: 2, absent: 1, unknown: 0 };
  const p = prev || 'unknown';
  return order[next] > order[p] ? next : p;
}

async function loadWordle() {
  const wrap = document.getElementById('wordle');
  const boardEl = document.getElementById('wordle-board');
  const kbEl = document.getElementById('wordle-keyboard');
  const statusEl = document.getElementById('wordle-status');
  if (!wrap || !boardEl || !kbEl || !statusEl) return;

  const dateKey = getLocalISODate();
  const storageKey = 'ontime_wordle_' + dateKey;

  let answer = '';
  try {
    const res = await fetch('/wordle-answers-30d.json');
    const data = await res.json().catch(() => ({}));
    answer = normalizeWordleWord(data[dateKey] || data.default || '');
  } catch (e) {
    answer = '';
  }

  if (!answer || answer.length !== 5) {
    statusEl.textContent = 'Ingen Wordle-ord i dag.';
    return;
  }

  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; }
  })();

  const state = {
    dateKey,
    answer,
    current: '',
    guesses: Array.isArray(saved?.guesses) ? saved.guesses : [],
    status: saved?.status === 'won' || saved?.status === 'lost' ? saved.status : 'playing',
    keyStates: {},
    awarded: !!saved?.awarded,
  };

  const rows = [
    ['Q','W','E','R','T','Y','U','I','O','P','Å'],
    ['A','S','D','F','G','H','J','K','L','Æ','Ø'],
    ['ENTER','Z','X','C','V','B','N','M','⌫'],
  ];

  function persist() {
    localStorage.setItem(storageKey, JSON.stringify({
      guesses: state.guesses,
      status: state.status,
      awarded: state.awarded,
    }));
  }

  function rebuildKeyStates() {
    state.keyStates = {};
    for (const g of state.guesses) {
      const word = normalizeWordleWord(g.word || '');
      const score = Array.isArray(g.score) ? g.score : [];
      for (let i = 0; i < 5; i++) {
        const ch = word[i]?.toLocaleUpperCase('da-DK');
        if (!ch) continue;
        state.keyStates[ch] = upgradeKeyState(state.keyStates[ch], score[i] || 'absent');
      }
    }
  }

  async function awardIfWin() {
    if (state.status !== 'won' || state.awarded) return;
    state.awarded = true;
    persist();
    try {
      await api('/api/games/wordle/win', { method: 'POST' });
      loadBadges();
      loadMyStats();
      loadLeaderboard();
    } catch (e) {}
  }

  function render() {
    rebuildKeyStates();

    if (state.status === 'won') statusEl.textContent = 'Du vandt Wordle i dag. Flot!';
    else if (state.status === 'lost') statusEl.textContent = 'Øv. Du har brugt alle forsøg. Lev i evig undren!';
    else statusEl.textContent = 'Gæt dagens ord (' + state.dateKey + ').';

    const rowHtml = [];
    for (let r = 0; r < 6; r++) {
      let letters = '';
      let score = null;
      if (r < state.guesses.length) {
        letters = normalizeWordleWord(state.guesses[r].word || '');
        score = Array.isArray(state.guesses[r].score) ? state.guesses[r].score : null;
      } else if (r === state.guesses.length) {
        letters = normalizeWordleWord(state.current);
      }
      const tiles = [];
      for (let c = 0; c < 5; c++) {
        const ch = (letters[c] || '').toLocaleUpperCase('da-DK');
        let cls = 'wordle-tile';
        if (ch) cls += ' filled';
        if (score) cls += ' ' + (score[c] || 'absent');
        tiles.push('<div class="' + cls + '" role="gridcell" aria-label="' + escapeHtml(ch || 'tom') + '">' + escapeHtml(ch) + '</div>');
      }
      rowHtml.push('<div class="wordle-row" role="row">' + tiles.join('') + '</div>');
    }
    boardEl.innerHTML = rowHtml.join('');

    kbEl.innerHTML = rows.map((row) => {
      const keys = row.map((k) => {
        const stateCls = (k.length === 1 && state.keyStates[k]) ? ' ' + state.keyStates[k] : '';
        const wide = (k === 'ENTER' || k === '⌫') ? ' wide' : '';
        const label = k === '⌫' ? 'Slet' : (k === 'ENTER' ? 'Enter' : k);
        return '<button type="button" class="wordle-key' + wide + stateCls + '" data-key="' + escapeHtml(k) + '">' + escapeHtml(label) + '</button>';
      }).join('');
      return '<div class="wordle-keyboard-row">' + keys + '</div>';
    }).join('');

    kbEl.querySelectorAll('.wordle-key').forEach((btn) => {
      btn.addEventListener('click', () => handleKey(btn.getAttribute('data-key')));
    });
  }

  function handleKey(key) {
    if (state.status !== 'playing') return;
    if (!key) return;

    if (key === 'ENTER') {
      if (state.current.length !== 5) return;
      const guess = normalizeWordleWord(state.current);
      const score = scoreWordleGuess(guess, state.answer);
      state.guesses.push({ word: guess, score });
      state.current = '';
      if (guess === state.answer) {
        state.status = 'won';
        persist();
        render();
        awardIfWin();
        if (typeof playGameWin === 'function') playGameWin();
      } else if (state.guesses.length >= 6) {
        state.status = 'lost';
        persist();
        render();
        if (typeof playGameLose === 'function') playGameLose();
      } else {
        persist();
        render();
      }
      return;
    }

    if (key === '⌫') {
      state.current = state.current.slice(0, -1);
      render();
      return;
    }

    if (key.length === 1) {
      const ch = key.toLocaleLowerCase('da-DK');
      if (!/^[a-zæøå]$/i.test(ch)) return;
      if (state.current.length >= 5) return;
      state.current += ch;
      render();
    }
  }

  if (!document.body.dataset.wordleInit) {
    document.body.dataset.wordleInit = '1';
    document.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'Enter') { e.preventDefault(); handleKey('ENTER'); return; }
      if (k === 'Backspace') { e.preventDefault(); handleKey('⌫'); return; }
      if (k && k.length === 1) {
        const ch = k.toLocaleUpperCase('da-DK');
        if (/^[A-ZÆØÅ]$/.test(ch)) handleKey(ch);
      }
    });
  }

  render();
  if (state.status === 'won') awardIfWin();
}

async function loadVersion() {
  const el = document.getElementById('app-version');
  if (!el) return;
  try {
    const res = await fetch('/api/version');
    const data = await res.json().catch(() => ({}));
    if (data.version) el.textContent = data.version;
  } catch (_) {}
}

function betStatusText(status) {
  if (status === 'open') return 'Åben';
  if (status === 'locked') return 'Låst';
  if (status === 'resolved') return 'Afgjort';
  if (status === 'refunded') return 'Refunderet';
  return status || '–';
}

function formatPoints(n) {
  const x = Number(n || 0);
  return String(Math.round(x));
}

function potentialPayout(stake, totalPot, optionPot) {
  const s = Number(stake || 0);
  const t = Number(totalPot || 0);
  const o = Number(optionPot || 0);
  if (s <= 0 || t <= 0 || o <= 0) return 0;
  return Math.floor((s * t) / o);
}

async function loadBets() {
  const el = document.getElementById('bets-list');
  if (!el) return;
  try {
    const res = await api('/api/bets');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      el.innerHTML = '<p class="muted">' + escapeHtml(data.error || 'Kunne ikke hente bets.') + '</p>';
      return;
    }
    const bets = Array.isArray(data.bets) ? data.bets : [];
    if (!bets.length) {
      el.innerHTML = '<p class="muted">Ingen bets lige nu.</p>';
      return;
    }

    el.innerHTML = bets.map((b) => {
      const options = Array.isArray(b.options) ? b.options : [];
      const my = b.myWager;
      const status = String(b.status || '');
      const isOpen = status === 'open';
      const isResolved = status === 'resolved';
      const winnerId = b.winnerOptionId;
      const winner = winnerId ? options.find((o) => o.id === winnerId) : null;

      const optionsHtml = options.map((o) => {
        const isWinner = winnerId && o.id === winnerId;
        const myStake = (my && my.optionId === o.id) ? my.points : 0;
        const maybe = myStake ? potentialPayout(myStake, b.totalPot, o.pot) : 0;
        const extra = myStake ? ('<span class="bet-option-maybe">· hvis den vinder: ~' + formatPoints(maybe) + ' pt</span>') : '';
        return (
          '<div class="bet-option ' + (isWinner ? 'winner' : '') + '">' +
          '<span class="bet-option-label">' + escapeHtml(o.label) + (isWinner ? ' <span class="bet-winner-badge">Vinder</span>' : '') + '</span>' +
          '<span class="bet-option-pot">' + formatPoints(o.pot) + ' pt</span>' +
          extra +
          '</div>'
        );
      }).join('');

      const myHtml = my
        ? '<div class="bet-my">Din indsats: <strong>' + formatPoints(my.points) + ' pt</strong> på <strong>' + escapeHtml((options.find(o => o.id === my.optionId)?.label) || '—') + '</strong></div>'
        : '<div class="bet-my muted">Du har ikke satset endnu.</div>';

      const formDisabled = !isOpen ? 'disabled' : '';
      const btnText = isOpen ? (my ? 'Opdater indsats' : 'Sæt indsats') : 'Låst';
      const infoLine = isResolved && winner ? ('Vinder: ' + escapeHtml(winner.label)) : '';

      return (
        '<div class="bet-item bet-status-' + escapeHtml(status) + '" data-bet-id="' + b.id + '">' +
          '<div class="bet-head">' +
            '<div>' +
              '<div class="bet-title">' + escapeHtml(b.title || '') + '</div>' +
              '<div class="bet-meta">Status: <strong>' + escapeHtml(betStatusText(status)) + '</strong> · Pulje: <strong>' + formatPoints(b.totalPot) + ' pt</strong>' + (infoLine ? ' · ' + infoLine : '') + '</div>' +
              (b.description ? '<div class="bet-desc">' + escapeHtml(b.description) + '</div>' : '') +
            '</div>' +
          '</div>' +
          myHtml +
          '<div class="bet-options">' + optionsHtml + '</div>' +
          '<form class="bet-form" data-bet-id="' + b.id + '">' +
            '<label>Mulighed</label>' +
            '<select name="optionId" ' + formDisabled + '>' +
              options.map((o) => '<option value="' + o.id + '"' + (my && my.optionId === o.id ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>').join('') +
            '</select>' +
            '<label>Point</label>' +
            '<input name="points" type="number" min="1" max="10000" value="' + escapeHtml(String(my ? my.points : 10)) + '" ' + formDisabled + '>' +
            '<button type="submit" ' + (isOpen ? '' : 'disabled') + '>' + escapeHtml(btnText) + '</button>' +
            (!isOpen ? '<p class="muted bet-locked-hint">Dette bet er ikke åbent (låst/afgjort/refunderet).</p>' : '<p class="bet-inline-message" hidden></p>') +
          '</form>' +
        '</div>'
      );
    }).join('');

    el.querySelectorAll('.bet-form').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const betId = form.getAttribute('data-bet-id');
        const msg = form.querySelector('.bet-inline-message');
        const optionId = form.querySelector('select[name="optionId"]').value;
        const points = form.querySelector('input[name="points"]').value;
        if (msg) {
          msg.hidden = false;
          msg.className = 'bet-inline-message';
          msg.textContent = 'Gemmer…';
        }
        const res = await api('/api/bets/' + betId + '/wager', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ optionId: parseInt(optionId, 10), points: parseInt(points, 10) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (msg) {
            msg.hidden = false;
            msg.className = 'bet-inline-message error';
            msg.textContent = data.error || 'Kunne ikke gemme indsats.';
          }
          return;
        }
        if (msg) {
          msg.hidden = false;
          msg.className = 'bet-inline-message success';
          msg.textContent = 'Gemte indsats ✓';
          setTimeout(() => { if (msg) msg.hidden = true; }, 2000);
        }
        loadMyStats();
        loadLeaderboard();
        loadBets();
      });
    });
  } catch (e) {
    console.error('loadBets:', e);
    el.innerHTML = '<p class="muted">Kunne ikke hente bets.</p>';
  }
}

function openBetModal() {
  const overlay = document.getElementById('bet-modal-overlay');
  const modal = document.getElementById('bet-modal');
  if (!overlay || !modal) return;
  overlay.hidden = false;
  overlay.setAttribute('aria-hidden', 'false');
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('bet-modal-open');
  loadBets();
}

function closeBetModal() {
  const overlay = document.getElementById('bet-modal-overlay');
  const modal = document.getElementById('bet-modal');
  if (overlay) overlay.hidden = true;
  if (overlay) overlay.setAttribute('aria-hidden', 'true');
  if (modal) modal.hidden = true;
  if (modal) modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('bet-modal-open');
}

function setupBetModal() {
  const trigger = document.getElementById('bet-trigger');
  const overlay = document.getElementById('bet-modal-overlay');
  const closeBtn = document.getElementById('bet-modal-close');
  if (trigger) trigger.addEventListener('click', openBetModal);
  if (overlay) overlay.addEventListener('click', closeBetModal);
  if (closeBtn) closeBtn.addEventListener('click', closeBetModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('bet-modal-open')) closeBetModal();
  });
}

/** Vis Bet-knappen KUN når der findes mindst ét aktivt bet (open eller locked). */
async function updateBetTriggerVisibility() {
  const trigger = document.getElementById('bet-trigger');
  const overlay = document.getElementById('bet-modal-overlay');
  const modal = document.getElementById('bet-modal');
  if (!trigger) return;
  try {
    const res = await api('/api/bets');
    const data = await res.json().catch(() => ({}));
    const bets = Array.isArray(data.bets) ? data.bets : [];
    const hasActiveBet = bets.some((b) => b.status === 'open' || b.status === 'locked');
    trigger.hidden = !hasActiveBet;
    if (!hasActiveBet) {
      if (overlay) overlay.hidden = true;
      if (modal) modal.hidden = true;
      document.body.classList.remove('bet-modal-open');
    }
  } catch (e) {
    trigger.hidden = true;
    if (overlay) overlay.hidden = true;
    if (modal) modal.hidden = true;
    document.body.classList.remove('bet-modal-open');
  }
}

async function init() {
  try {
    await loadLocationConfig();
    await loadUser();
    await loadTodayCheckin();
    loadDailyQuote();
    await loadMyStats();
    await loadStreak();
    await loadLeaderboard();
    await loadBadges();
    await loadPointsHistory();
    await loadBurndown();
    await loadRecent();
    await loadCalendar();
    loadVersion();
    setupBetModal();
    await updateBetTriggerVisibility();

    if (locationConfig && locationConfig.useWiFiCheck) {
      showWiFiMode();
    } else {
      showGeoMode();
      startLocationWatch();
    }

    window.addEventListener('resize', () => {
      const canvas = document.getElementById('burndown-chart');
      if (canvas && lastBurndownData) drawBurndownChart(canvas, lastBurndownData);
    });
  } catch (e) {
    console.error('Init fejl:', e);
    const msg = document.getElementById('hero-message');
    if (msg) msg.textContent = 'Kunne ikke indlæse dashboard. Prøv at logge ind igen.';
  }
}
init();
