const token = localStorage.getItem('ontime_token');
if (!token) {
  window.location.href = '/';
}

const api = (path, opts = {}) =>
  fetch(path, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${token}` },
  });

let cachedClasses = [];
let currentUserId = null;

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
  currentUserId = user.id != null ? user.id : null;
  if (Array.isArray(user.classes)) cachedClasses = user.classes;
}

async function loadClasses() {
  if (cachedClasses.length) return cachedClasses;
  try {
    const res = await api('/api/admin/classes');
    const data = await res.json().catch(() => null);
    if (!res.ok) return [];
    const list = Array.isArray(data) ? data : [];
    cachedClasses = list;
    return list;
  } catch (e) {
    console.error('loadClasses:', e);
    return [];
  }
}

async function loadUsers(classId) {
  const url = classId ? `/api/admin/users?classId=${classId}` : '/api/admin/users';
  const res = await api(url);
  if (!res.ok) return [];
  return res.json();
}

async function loadIpRanges() {
  const res = await api('/api/admin/ip-ranges');
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return data.ranges || [];
}

function renderIpRangeList(ranges) {
  const el = document.getElementById('ip-range-list');
  if (!el) return;
  if (!ranges.length) {
    el.innerHTML = '<li class="muted">Ingen adresser. Tilføj en (fx fra env ALLOWED_IP_RANGES eller her).</li>';
    return;
  }
  el.innerHTML = ranges.map(r => {
    const label = r.fromEnv ? r.range + ' <span class="muted">(fra server-config)</span>' : r.range;
    const action = r.fromEnv ? '' : ' <button type="button" class="btn-delete-ip" data-id="' + r.id + '">Fjern</button>';
    return '<li>' + label + action + '</li>';
  }).join('');
  el.querySelectorAll('.btn-delete-ip').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (!confirm('Fjern denne adresse fra whitelisten?')) return;
      const res = await api('/api/admin/ip-ranges/' + id, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Kunne ikke fjerne');
        return;
      }
      renderIpRangeList(await loadIpRanges());
    });
  });
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
  const opts = classes.map(c => `<option value="${String(c.id)}">${String(c.name || '')}</option>`).join('');
  const def = '<option value="">Vælg klasse</option>';
  const defAll = '<option value="">Alle klasser</option>';
  const elUserClass = document.getElementById('user-class');
  const elFilterClass = document.getElementById('filter-class');
  const elImportClass = document.getElementById('import-class');
  if (elUserClass) elUserClass.innerHTML = def + opts;
  if (elFilterClass) elFilterClass.innerHTML = defAll + opts;
  if (elImportClass) {
    elImportClass.innerHTML = def + opts;
    elImportClass.disabled = false;
    const status = document.getElementById('import-class-status');
    if (status) status.textContent = classes.length ? classes.length + ' klasse(r)' : 'Opret en klasse under "Ny klasse" først.';
  }
}

function renderUserList(users) {
  const tbody = document.getElementById('user-list');
  const countEl = document.getElementById('user-count');
  if (countEl) countEl.textContent = users.length;
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">Ingen brugere</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => {
    const isSelf = currentUserId != null && u.id === currentUserId;
    const deleteBtn = isSelf
      ? '<span class="muted">(dig)</span>'
      : '<button type="button" class="btn-delete-user" data-user-id="' + u.id + '" data-user-name="' + (u.name || '').replace(/"/g, '&quot;') + '">Slet</button>';
    let adminBtn = '';
    if (!isSelf) {
      adminBtn = u.isAdmin
        ? '<button type="button" class="btn-toggle-admin" data-user-id="' + u.id + '" data-is-admin="true">Fjern admin</button>'
        : '<button type="button" class="btn-toggle-admin" data-user-id="' + u.id + '" data-is-admin="false">Gør til admin</button>';
    } else {
      adminBtn = u.isAdmin ? '<span class="muted">(dig)</span>' : '';
    }
    return '<tr data-user-id="' + u.id + '"><td class="name">' + u.name + '</td><td class="email">' + u.email + '</td><td class="class">' + u.className + '</td><td>' + (u.isAdmin ? '<span class="badge">Admin</span>' : '') + '</td><td class="actions">' + adminBtn + ' ' + deleteBtn + '</td></tr>';
  }).join('');

  tbody.querySelectorAll('.btn-toggle-admin').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-user-id');
      const currentlyAdmin = btn.getAttribute('data-is-admin') === 'true';
      const newAdmin = !currentlyAdmin;
      if (newAdmin && !confirm('Giv denne bruger administrator-rettigheder?')) return;
      if (!newAdmin && !confirm('Fjern administrator-rettigheder fra denne bruger?')) return;
      btn.disabled = true;
      const res = await api('/api/admin/users/' + id + '/admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAdmin: newAdmin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Kunne ikke opdatere');
        btn.disabled = false;
        return;
      }
      const filter = document.getElementById('filter-class').value;
      const list = await loadUsers(filter ? parseInt(filter, 10) : undefined);
      renderUserList(list);
    });
  });

  tbody.querySelectorAll('.btn-delete-user').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-user-id');
      const name = btn.getAttribute('data-user-name') || 'brugeren';
      if (!confirm('Slet ' + name + ' permanent? Brugerens indstemplinger slettes også.')) return;
      btn.disabled = true;
      const res = await api('/api/admin/users/' + id, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Kunne ikke slette bruger');
        btn.disabled = false;
        return;
      }
      const filter = document.getElementById('filter-class').value;
      const list = await loadUsers(filter ? parseInt(filter, 10) : undefined);
      renderUserList(list);
    });
  });
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
  cachedClasses = [];
  await fillClassSelects();
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
  cachedClasses = [];
  await fillClassSelects();
});

document.getElementById('form-user').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('user-name').value.trim();
  const email = document.getElementById('user-email').value.trim();
  const password = document.getElementById('user-password').value;
  const classId = document.getElementById('user-class').value;
  const isAdmin = document.getElementById('user-is-admin').checked;
  if (!classId) {
    showMessage('user-message', 'Vælg en klasse', true);
    return;
  }
  const res = await api('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password, classId: parseInt(classId, 10), isAdmin }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showMessage('user-message', data.error || 'Kunne ikke oprette bruger', true);
    return;
  }
  showMessage('user-message', `Bruger ${data.email} oprettet.` + (data.isAdmin ? ' Som administrator.' : ''));
  document.getElementById('user-name').value = '';
  document.getElementById('user-email').value = '';
  document.getElementById('user-password').value = '';
  document.getElementById('user-is-admin').checked = false;
  const filter = document.getElementById('filter-class').value;
  renderUserList(await loadUsers(filter || undefined));
});

document.getElementById('filter-class').addEventListener('change', async () => {
  const classId = document.getElementById('filter-class').value;
  const users = await loadUsers(classId ? parseInt(classId, 10) : undefined);
  renderUserList(users);
});

document.getElementById('form-ip-range').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('ip-range-input');
  const range = input.value.trim();
  if (!range) return;
  const res = await api('/api/admin/ip-ranges', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ range }),
  });
  const data = await res.json().catch(() => ({}));
  const msgEl = document.getElementById('ip-range-message');
  if (!res.ok) {
    showMessage('ip-range-message', data.error || 'Kunne ikke tilføje', true);
    return;
  }
  showMessage('ip-range-message', 'Adresse tilføjet.');
  input.value = '';
  renderIpRangeList(await loadIpRanges());
});

document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem('ontime_token');
  window.location.href = '/';
});

let adminGridInstance = null;

function saveAdminGridLayout(grid) {
  const g = grid || adminGridInstance;
  if (!g) return;
  const el = document.getElementById('admin-grid');
  if (!el) return;
  try {
    const nodes = el.querySelectorAll('.grid-stack-item');
    const data = [];
    nodes.forEach((node) => {
      const id = node.getAttribute('data-gs-id');
      if (!id) return;
      data.push({
        id,
        x: parseInt(node.getAttribute('data-gs-x') || '0', 10),
        y: parseInt(node.getAttribute('data-gs-y') || '0', 10),
        w: parseInt(node.getAttribute('data-gs-w') || '1', 10),
        h: parseInt(node.getAttribute('data-gs-h') || '1', 10),
      });
    });
    localStorage.setItem('ontime_admin_grid', JSON.stringify(data));
    console.log('[OnTime Admin] Layout gemt i localStorage:', data);
  } catch (e) {
    console.warn('[OnTime Admin] Kunne ikke gemme layout:', e);
  }
}

function initAdminGrid() {
  const el = document.getElementById('admin-grid');
  if (!el || typeof GridStack === 'undefined') return;

  const grid = GridStack.init({
    column: 12,
    cellHeight: 110,
    margin: 10,
    float: true,
    animate: true,
    draggable: { handle: '.card h2' },
    minRow: 10,
  }, el);
  adminGridInstance = grid;

  const saved = localStorage.getItem('ontime_admin_grid');
  if (saved) {
    try {
      const layout = JSON.parse(saved);
      console.log('[OnTime Admin] Indlæser gemt layout fra localStorage:', layout);
      if (Array.isArray(layout) && layout.length > 0) {
        grid.load(layout, false);
      }
    } catch (e) {
      console.warn('[OnTime Admin] Kunne ikke indlæse layout:', e);
    }
  }

  grid.on('change', () => saveAdminGridLayout(grid));
  grid.on('dragstop', () => saveAdminGridLayout(grid));
  grid.on('resizestop', () => saveAdminGridLayout(grid));
  window.addEventListener('beforeunload', () => saveAdminGridLayout());
  document.querySelector('a.admin-link[href="/app"]')?.addEventListener('click', () => saveAdminGridLayout());

  window.addEventListener('pageshow', (e) => {
    if (e.persisted && adminGridInstance) {
      const s = localStorage.getItem('ontime_admin_grid');
      if (s) {
        try {
          const layout = JSON.parse(s);
          adminGridInstance.load(layout, false);
          console.log('[OnTime Admin] Layout genanvendt efter pageshow (bfcache)');
        } catch (err) {}
      }
    }
  });
}

async function init() {
  initAdminGrid();
  await ensureAdmin();
  await fillClassSelects();
  renderUserList(await loadUsers());
  renderIpRangeList(await loadIpRanges());
}
init();
