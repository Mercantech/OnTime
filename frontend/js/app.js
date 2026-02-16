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
  const user = await res.json();
  document.getElementById('user-name').textContent = user.name + ' · ' + user.className;
  const adminLink = document.getElementById('admin-link');
  if (adminLink && user.isAdmin) adminLink.hidden = false;
}

async function loadTodayCheckin() {
  const res = await api('/api/checkin/today');
  const data = await res.json();
  hasCheckedInToday = !!data.checkedIn;
  const statusEl = document.getElementById('checkin-status');
  const btn = document.getElementById('checkin-btn');

  if (data.checkedIn) {
    statusEl.hidden = false;
    statusEl.textContent = `Stemplet ind kl. ${new Date(data.checkedAt).toLocaleTimeString('da-DK')} – ${data.points} point.`;
    btn.disabled = true;
    btn.textContent = 'Allerede stemplet ind i dag';
    btn.className = 'btn-checkin not-ready';
  } else {
    statusEl.hidden = true;
    statusEl.textContent = '';
    if (locationConfig && !locationConfig.useWiFiCheck) {
      const ring = document.getElementById('location-ring');
      const isNear = ring && ring.classList.contains('near');
      btn.disabled = !isNear;
      btn.className = isNear ? 'btn-checkin ready' : 'btn-checkin not-ready';
      btn.textContent = isNear ? 'Stempel ind' : 'Du skal være på skolen';
    }
  }
}

async function loadMyStats() {
  const res = await api('/api/leaderboard/my-stats');
  const data = await res.json();
  const el = document.getElementById('my-stats');
  el.innerHTML = `${data.totalPoints} <span class="muted">/ ${data.maxPossible} point (${data.percentage}%)</span>`;
}

async function loadLeaderboard() {
  const res = await api('/api/leaderboard/class');
  const data = await res.json();
  const totalHtml = `<div class="leaderboard-total"><strong>Klasse total:</strong> ${data.classTotal} / ${data.maxPossibleClass} point (${data.classPercentage}%)</div>`;
  const listHtml = '<ul class="leaderboard-list">' +
    data.students.map(s => `<li><span class="rank">${s.rank}</span><span class="name">${s.name}</span><span class="points">${s.totalPoints} pt (${s.percentage}%)</span></li>`).join('') +
    '</ul>';
  document.getElementById('leaderboard').innerHTML = totalHtml + listHtml;
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
    document.getElementById('location-status').textContent = 'Din enhed understøtter ikke GPS.';
    return;
  }
  const opts = { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 };
  watchId = navigator.geolocation.watchPosition(
    (pos) => onPosition(pos.coords.latitude, pos.coords.longitude),
    (err) => {
      document.getElementById('location-status').textContent =
        err.code === 1 ? 'Placering er blokeret. Giv adgang i browserindstillinger.' :
        'Kunne ikke hente position. Tjek GPS/adgang.';
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
  statusEl.hidden = true;
  let body = {};
  if (!locationConfig.useWiFiCheck) {
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true });
      });
      body = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch (e) {
      statusEl.hidden = false;
      statusEl.textContent = 'Kunne ikke hente position. Prøv igen.';
      statusEl.classList.remove('checkin-success');
      statusEl.classList.add('error');
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
    statusEl.hidden = false;
    const msg = data.error || 'Kunne ikke stemple ind';
    statusEl.textContent = msg;
    statusEl.classList.remove('checkin-success');
    statusEl.classList.add('error');
    if (!locationConfig.useWiFiCheck && body.lat != null) onPosition(body.lat, body.lng);
    else if (locationConfig.useWiFiCheck) {
      btn.disabled = false;
      btn.className = 'btn-checkin ready';
      btn.textContent = 'Stempel ind';
    }
    return;
  }
  hasCheckedInToday = true;
  statusEl.hidden = false;
  statusEl.textContent = data.message;
  statusEl.classList.add('checkin-success');
  statusEl.classList.remove('error');
  btn.textContent = 'Allerede stemplet ind i dag';
  btn.className = 'btn-checkin not-ready';
  loadMyStats();
  loadLeaderboard();
});

document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem('ontime_token');
  window.location.href = '/';
});

function showWiFiMode() {
  document.getElementById('geo-intro').hidden = true;
  document.getElementById('wifi-intro').hidden = false;
  document.getElementById('geo-widget').hidden = true;
  document.getElementById('wifi-widget').hidden = false;
  const nameEl = document.getElementById('wifi-name');
  if (nameEl && locationConfig) nameEl.textContent = locationConfig.wifiName || 'MAGS-OLC';
}

function showGeoMode() {
  document.getElementById('geo-intro').hidden = false;
  document.getElementById('wifi-intro').hidden = true;
  document.getElementById('geo-widget').hidden = false;
  document.getElementById('wifi-widget').hidden = true;
}

async function init() {
  await loadLocationConfig();
  await loadUser();
  await loadTodayCheckin();
  await loadMyStats();
  await loadLeaderboard();

  if (locationConfig.useWiFiCheck) {
    showWiFiMode();
    const btn = document.getElementById('checkin-btn');
    if (!hasCheckedInToday) {
      btn.disabled = false;
      btn.className = 'btn-checkin ready';
      btn.textContent = 'Stempel ind';
    }
  } else {
    showGeoMode();
    startLocationWatch();
  }
}
init();
