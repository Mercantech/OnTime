const token = localStorage.getItem('ontime_token');
if (!token) {
  window.location.href = '/';
}

const api = (path, opts = {}) =>
  fetch(path, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${token}` },
  });

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

  const greeting = document.getElementById('hero-greeting');
  if (greeting) greeting.textContent = 'Hej, ' + currentUser.name + '!';
}

async function loadTodayCheckin() {
  const res = await api('/api/checkin/today');
  const data = await res.json();
  hasCheckedInToday = !!data.checkedIn;
  const statusEl = document.getElementById('checkin-status');
  const msgEl = document.getElementById('hero-message');
  const btn = document.getElementById('checkin-btn');

  if (data.checkedIn) {
    if (msgEl) msgEl.textContent = 'Stemplet ind i dag ✓';
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = 'Kl. ' + new Date(data.checkedAt).toLocaleTimeString('da-DK') + ' – ' + data.points + ' point.';
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Allerede stemplet ind i dag';
      btn.className = 'btn-checkin not-ready';
    }
  } else {
    if (msgEl) msgEl.textContent = locationConfig && locationConfig.useWiFiCheck ? 'Forbind til skolens WiFi og stemple ind.' : 'Stempel ind når du er på skolen.';
    if (statusEl) statusEl.hidden = true;
    if (btn && locationConfig && locationConfig.useWiFiCheck) {
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
  const res = await api('/api/leaderboard/my-stats');
  const data = await res.json();
  const el = document.getElementById('stat-points');
  const maxEl = document.getElementById('stat-points-max');
  if (el) el.textContent = data.totalPoints;
  if (maxEl) maxEl.textContent = '/ ' + data.maxPossible + ' pt';
}

async function loadStreak() {
  const res = await api('/api/leaderboard/streak');
  const data = await res.json();
  const el = document.getElementById('stat-streak');
  if (el) el.textContent = data.currentStreak || 0;
}

async function loadLeaderboard() {
  const res = await api('/api/leaderboard/class');
  const data = await res.json();
  const totalEl = document.getElementById('leaderboard-total');
  const listEl = document.getElementById('leaderboard');
  if (totalEl) totalEl.innerHTML = `<strong>Klasse total:</strong> ${data.classTotal} / ${data.maxPossibleClass} point (${data.classPercentage}%)`;
  if (listEl) {
    listEl.innerHTML = '<ul class="leaderboard-list">' +
      data.students.map(s => `<li><span class="rank">${s.rank}</span><span class="name">${s.name}</span><span class="points">${s.totalPoints} pt (${s.percentage}%)</span></li>`).join('') +
      '</ul>';
  }
  const classPctEl = document.getElementById('stat-class-pct');
  if (classPctEl) classPctEl.textContent = data.classPercentage ?? '–';
}

function drawBurndownChart(canvas, data) {
  if (!data || !data.labels || !data.labels.length) return;
  const ctx = canvas.getContext('2d');
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

let lastBurndownData = null;
async function loadBurndown() {
  const res = await api('/api/leaderboard/burndown');
  const data = await res.json();
  lastBurndownData = data;
  const canvas = document.getElementById('burndown-chart');
  if (canvas && data.labels && data.labels.length) drawBurndownChart(canvas, data);
}

async function loadRecent() {
  const res = await api('/api/leaderboard/recent');
  const data = await res.json();
  const el = document.getElementById('recent-list');
  if (!el) return;
  if (!data.length) {
    el.innerHTML = '<li class="muted">Ingen indstemplinger denne måned</li>';
    return;
  }
  el.innerHTML = data.map(r => {
    const d = new Date(r.date);
    const t = new Date(r.time);
    const dateStr = d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });
    const timeStr = t.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
    return `<li><span class="recent-date">${dateStr} kl. ${timeStr}</span><span class="recent-points">${r.points} pt</span></li>`;
  }).join('');
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
    const key = date.toISOString().slice(0, 10);
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
  const res = await api('/api/leaderboard/calendar');
  const data = await res.json();
  const el = document.getElementById('calendar-heatmap');
  if (el) renderCalendarHeatmap(el, data);
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
  if (statusEl) {
    statusEl.hidden = false;
    statusEl.textContent = data.message;
    statusEl.classList.add('checkin-success');
    statusEl.classList.remove('error');
  }
  const msgEl = document.getElementById('hero-message');
  if (msgEl) msgEl.textContent = 'Stemplet ind i dag ✓';
  btn.textContent = 'Allerede stemplet ind i dag';
  btn.className = 'btn-checkin not-ready';
  loadMyStats();
  loadStreak();
  loadLeaderboard();
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

async function init() {
  await loadLocationConfig();
  await loadUser();
  await loadTodayCheckin();
  await loadMyStats();
  await loadStreak();
  await loadLeaderboard();
  await loadBurndown();
  await loadRecent();
  await loadCalendar();

  if (locationConfig.useWiFiCheck) {
    showWiFiMode();
  } else {
    showGeoMode();
    startLocationWatch();
  }

  window.addEventListener('resize', () => {
    const canvas = document.getElementById('burndown-chart');
    if (canvas && lastBurndownData) drawBurndownChart(canvas, lastBurndownData);
  });
}
init();
