const token = localStorage.getItem('ontime_token');
if (!token) {
  window.location.href = '/';
}

const api = (path, opts = {}) =>
  fetch(path, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${token}` },
  });

async function ensureAdmin() {
  const res = await api('/api/auth/me');
  if (!res.ok) {
    localStorage.removeItem('ontime_token');
    window.location.href = '/';
    return;
  }
  const user = await res.json();
  if (!user.isAdmin) {
    window.location.href = '/app';
    return;
  }
  document.getElementById('admin-user').textContent = user.name;
}

async function loadClasses() {
  const res = await api('/api/admin/classes');
  if (!res.ok) return [];
  return res.json();
}

async function loadUsers(classId) {
  const url = classId ? `/api/admin/users?classId=${classId}` : '/api/admin/users';
  const res = await api(url);
  if (!res.ok) return [];
  return res.json();
}

function showMessage(elId, text, isError = false) {
  const el = document.getElementById(elId);
  el.textContent = text;
  el.hidden = false;
  el.className = 'message ' + (isError ? 'error' : 'success');
  setTimeout(() => { el.hidden = true; }, 4000);
}

async function fillClassSelects() {
  const classes = await loadClasses();
  const opts = classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const def = '<option value="">Vælg klasse</option>';
  document.getElementById('user-class').innerHTML = def + opts;
  const defAll = '<option value="">Alle klasser</option>';
  document.getElementById('filter-class').innerHTML = defAll + opts;
  const importSelect = document.getElementById('import-class');
  if (importSelect) importSelect.innerHTML = '<option value="">Vælg klasse</option>' + opts;
}

function renderUserList(users) {
  const tbody = document.getElementById('user-list');
  const countEl = document.getElementById('user-count');
  if (countEl) countEl.textContent = users.length;
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="muted">Ingen brugere</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u =>
    '<tr><td class="name">' + u.name + '</td><td class="email">' + u.email + '</td><td class="class">' + u.className + '</td><td>' + (u.isAdmin ? '<span class="badge">Admin</span>' : '') + '</td></tr>'
  ).join('');
}

document.getElementById('form-csv').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('csv-file');
  const resultEl = document.getElementById('import-result');
  if (!fileInput.files || !fileInput.files[0]) {
    resultEl.innerHTML = '<p class="error">Vælg en fil.</p>';
    resultEl.hidden = false;
    return;
  }
  const importClass = document.getElementById('import-class').value;
  if (!importClass) {
    resultEl.innerHTML = '<p class="error">Vælg en klasse.</p>';
    resultEl.hidden = false;
    return;
  }
  const fd = new FormData();
  fd.append('csv', fileInput.files[0]);
  fd.append('classId', importClass);
  resultEl.innerHTML = '<p>Importerer…</p>';
  resultEl.hidden = false;
  const res = await fetch('/api/admin/import-csv', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    resultEl.innerHTML = '<p class="error">' + (data.error || 'Import fejlede') + '</p>';
    return;
  }
  let html = '<p class="success">Oprettet: ' + data.created + ', opdateret: ' + data.updated;
  if (data.errors && data.errors.length) html += ', fejl: ' + data.errors.length + '</p><ul class="import-errors">' + data.errors.slice(0, 20).map(err => '<li>Række ' + err.row + (err.email ? ' ' + err.email : '') + ': ' + (err.message || '') + '</li>').join('') + '</ul>';
  else html += '.</p>';
  resultEl.innerHTML = html;
  fileInput.value = '';
  fillClassSelects();
  renderUserList(await loadUsers());
});

document.getElementById('form-class').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('class-name').value.trim();
  const res = await api('/api/admin/classes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showMessage('class-message', data.error || 'Kunne ikke oprette klasse', true);
    return;
  }
  showMessage('class-message', `Klasse "${data.name}" oprettet.`);
  document.getElementById('class-name').value = '';
  fillClassSelects();
});

document.getElementById('form-user').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('user-name').value.trim();
  const email = document.getElementById('user-email').value.trim();
  const password = document.getElementById('user-password').value;
  const classId = document.getElementById('user-class').value;
  if (!classId) {
    showMessage('user-message', 'Vælg en klasse', true);
    return;
  }
  const res = await api('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password, classId: parseInt(classId, 10) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showMessage('user-message', data.error || 'Kunne ikke oprette bruger', true);
    return;
  }
  showMessage('user-message', `Bruger ${data.email} oprettet.`);
  document.getElementById('user-name').value = '';
  document.getElementById('user-email').value = '';
  document.getElementById('user-password').value = '';
  const filter = document.getElementById('filter-class').value;
  renderUserList(await loadUsers(filter || undefined));
});

document.getElementById('filter-class').addEventListener('change', async () => {
  const classId = document.getElementById('filter-class').value;
  const users = await loadUsers(classId ? parseInt(classId, 10) : undefined);
  renderUserList(users);
});

document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem('ontime_token');
  window.location.href = '/';
});

async function init() {
  await ensureAdmin();
  await fillClassSelects();
  renderUserList(await loadUsers());
}
init();
