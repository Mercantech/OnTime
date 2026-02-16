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
}

function renderUserList(users) {
  const ul = document.getElementById('user-list');
  if (!users.length) {
    ul.innerHTML = '<li class="muted">Ingen brugere</li>';
    return;
  }
  ul.innerHTML = users.map(u =>
    `<li><span class="name">${u.name}</span> <span class="email">${u.email}</span> <span class="class">${u.className}</span>${u.isAdmin ? ' <span class="badge">Admin</span>' : ''}</li>`
  ).join('');
}

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
