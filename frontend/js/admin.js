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
  const elBetClass = document.getElementById('bet-class');
  const elBetFilterClass = document.getElementById('bet-filter-class');
  const elResetPointsClass = document.getElementById('reset-points-class');
  if (elUserClass) elUserClass.innerHTML = def + opts;
  if (elFilterClass) elFilterClass.innerHTML = defAll + opts;
  if (elImportClass) {
    elImportClass.innerHTML = def + opts;
    elImportClass.disabled = false;
    const status = document.getElementById('import-class-status');
    if (status) status.textContent = classes.length ? classes.length + ' klasse(r)' : 'Opret en klasse under "Ny klasse" først.';
  }
  if (elBetClass) {
    elBetClass.innerHTML = def + opts;
    elBetClass.disabled = false;
  }
  if (elBetFilterClass) {
    elBetFilterClass.innerHTML = def + opts;
    elBetFilterClass.disabled = false;
  }
  if (elResetPointsClass) {
    elResetPointsClass.innerHTML = def + opts;
    elResetPointsClass.disabled = false;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
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

async function loadBetsAdmin(classId) {
  const el = document.getElementById('bet-admin-list');
  if (!el) return;
  if (!classId) {
    el.textContent = 'Vælg en klasse…';
    return;
  }
  try {
    const res = await api('/api/bets?classId=' + encodeURIComponent(String(classId)));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      el.innerHTML = '<p class="muted">' + escapeHtml(data.error || 'Kunne ikke hente bets.') + '</p>';
      return;
    }
    const bets = Array.isArray(data.bets) ? data.bets : [];
    if (!bets.length) {
      el.innerHTML = '<p class="muted">Ingen bets for denne klasse.</p>';
      return;
    }

    el.innerHTML = bets.map((b) => {
      const options = Array.isArray(b.options) ? b.options : [];
      const status = String(b.status || '');
      const isOpen = status === 'open';
      const isLocked = status === 'locked';
      const isFinal = status === 'resolved' || status === 'refunded';
      const winnerId = b.winnerOptionId;
      const winner = winnerId ? options.find((o) => o.id === winnerId) : null;
      const info = winner ? ('Vinder: ' + escapeHtml(winner.label)) : '';

      const optionsHtml = options.map((o) => {
        const isWinner = winnerId && o.id === winnerId;
        return (
          '<div class="bet-option ' + (isWinner ? 'winner' : '') + '">' +
            '<span class="bet-option-label">' + escapeHtml(o.label) + (isWinner ? ' <span class="bet-winner-badge">Vinder</span>' : '') + '</span>' +
            '<span class="bet-option-pot">' + formatPoints(o.pot) + ' pt</span>' +
          '</div>'
        );
      }).join('');

      return (
        '<div class="bet-item bet-admin-item" data-bet-id="' + b.id + '">' +
          '<div class="bet-head">' +
            '<div>' +
              '<div class="bet-title">' + escapeHtml(b.title || '') + '</div>' +
              '<div class="bet-meta">Status: <strong>' + escapeHtml(betStatusText(status)) + '</strong> · Pulje: <strong>' + formatPoints(b.totalPot) + ' pt</strong>' + (info ? ' · ' + info : '') + '</div>' +
              (b.description ? '<div class="bet-desc">' + escapeHtml(b.description) + '</div>' : '') +
            '</div>' +
          '</div>' +
          '<div class="bet-options">' + optionsHtml + '</div>' +
          '<div class="bet-admin-actions">' +
            (isOpen ? '<button type="button" class="btn-bet-lock" data-action="lock">Lås</button>' : '') +
            (isLocked ? '<button type="button" class="btn-bet-lock" data-action="unlock">Åbn igen</button>' : '') +
            (!isFinal ? (
              '<div class="bet-resolve">' +
                '<label>Vinder</label>' +
                '<select class="bet-winner-select">' +
                  options.map((o) => '<option value="' + o.id + '">' + escapeHtml(o.label) + '</option>').join('') +
                '</select>' +
                '<button type="button" class="btn-bet-resolve"' + (isLocked ? '' : ' title="Tip: Lås bettet først"') + '>Afgør</button>' +
                '<button type="button" class="btn-bet-refund danger">Refundér alle</button>' +
              '</div>'
            ) : '') +
            '<p class="bet-inline-message" hidden></p>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    el.querySelectorAll('.bet-admin-item').forEach((wrap) => {
      const betId = wrap.getAttribute('data-bet-id');
      const msg = wrap.querySelector('.bet-inline-message');
      const showInline = (text, isError) => {
        if (!msg) return;
        msg.hidden = false;
        msg.className = 'bet-inline-message ' + (isError ? 'error' : 'success');
        msg.textContent = text;
      };

      const lockBtn = wrap.querySelector('.btn-bet-lock');
      if (lockBtn) {
        lockBtn.addEventListener('click', async () => {
          const action = lockBtn.getAttribute('data-action');
          const locked = action === 'lock';
          lockBtn.disabled = true;
          showInline('Opdaterer…', false);
          const res = await api('/api/bets/' + betId + '/lock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locked }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            lockBtn.disabled = false;
            showInline(data.error || 'Kunne ikke opdatere', true);
            return;
          }
          showInline('OK ✓', false);
          loadBetsAdmin(classId);
        });
      }

      const resolveBtn = wrap.querySelector('.btn-bet-resolve');
      if (resolveBtn) {
        resolveBtn.addEventListener('click', async () => {
          const sel = wrap.querySelector('.bet-winner-select');
          const winnerOptionId = sel ? sel.value : '';
          if (!winnerOptionId) return;
          if (!confirm('Afgør dette bet og udbetal puljen?')) return;
          resolveBtn.disabled = true;
          showInline('Afgør…', false);
          const res = await api('/api/bets/' + betId + '/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ winnerOptionId: parseInt(winnerOptionId, 10) }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            resolveBtn.disabled = false;
            showInline(data.error || 'Kunne ikke afgøre', true);
            return;
          }
          showInline('Afgjort ✓', false);
          loadBetsAdmin(classId);
        });
      }

      const refundBtn = wrap.querySelector('.btn-bet-refund');
      if (refundBtn) {
        refundBtn.addEventListener('click', async () => {
          if (!confirm('Refundér alle indsatser på dette bet?')) return;
          refundBtn.disabled = true;
          showInline('Refunderer…', false);
          const res = await api('/api/bets/' + betId + '/refund', { method: 'POST' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            refundBtn.disabled = false;
            showInline(data.error || 'Kunne ikke refundere', true);
            return;
          }
          showInline('Refunderet ✓', false);
          loadBetsAdmin(classId);
        });
      }
    });
  } catch (e) {
    console.error('loadBetsAdmin:', e);
    el.innerHTML = '<p class="muted">Kunne ikke hente bets.</p>';
  }
}

function renderUserList(users) {
  const tbody = document.getElementById('user-list');
  const countEl = document.getElementById('user-count');
  const givePointsSelect = document.getElementById('give-points-user');
  if (countEl) countEl.textContent = users.length;
  if (givePointsSelect) {
    givePointsSelect.innerHTML = '<option value="">Vælg elev…</option>' +
      users.map(u => '<option value="' + u.id + '">' + (u.name || '') + ' (' + (u.className || '') + ')</option>').join('');
  }
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

document.getElementById('form-reset-class-points').addEventListener('submit', async (e) => {
  e.preventDefault();
  const classId = document.getElementById('reset-points-class').value;
  const msgEl = document.getElementById('reset-points-message');
  if (!classId) {
    showMessage('reset-points-message', 'Vælg en klasse', true);
    return;
  }
  const className = document.getElementById('reset-points-class').selectedOptions[0]?.textContent || 'klassen';
  if (!confirm('Er du sikker? Alle elevers point i ' + className + ' sættes til 0 for nuværende måned. Handlingen kan ikke fortrydes.')) {
    return;
  }
  const res = await api('/api/admin/classes/' + classId + '/reset-points', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showMessage('reset-points-message', data.error || 'Kunne ikke nulstille', true);
    return;
  }
  showMessage('reset-points-message', 'Nulstilling gennemført. ' + data.resetCount + ' bruger(e) sat til 0 point.');
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

function setGivePointsDateToToday() {
  const el = document.getElementById('give-points-date');
  if (!el) return;
  const d = new Date();
  el.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

document.getElementById('form-give-points').addEventListener('submit', async (e) => {
  e.preventDefault();
  const userId = document.getElementById('give-points-user').value;
  const date = document.getElementById('give-points-date').value;
  const points = document.getElementById('give-points-points').value;
  if (!userId) {
    showMessage('give-points-message', 'Vælg en elev.', true);
    return;
  }
  const res = await api('/api/admin/give-points', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: parseInt(userId, 10), date: date || undefined, points: parseInt(points, 10) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showMessage('give-points-message', data.error || 'Kunne ikke give point', true);
    return;
  }
  const msg = data.delta != null && data.delta < 0
    ? (Math.abs(data.delta) + ' point trukket. Står nu på ' + data.points + ' point for ' + (data.date || date) + '.')
    : (data.points + ' point for ' + (data.date || date) + '.');
  showMessage('give-points-message', msg);
  setGivePointsDateToToday();
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

document.getElementById('form-bet-create').addEventListener('submit', async (e) => {
  e.preventDefault();
  const classId = document.getElementById('bet-class').value;
  const title = document.getElementById('bet-title').value.trim();
  const description = document.getElementById('bet-desc').value.trim();
  const optionsRaw = document.getElementById('bet-options').value;
  const options = optionsRaw.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!classId) {
    showMessage('bet-message', 'Vælg en klasse.', true);
    return;
  }
  if (!title) {
    showMessage('bet-message', 'Titel kræves.', true);
    return;
  }
  if (options.length < 2) {
    showMessage('bet-message', 'Angiv mindst 2 valgmuligheder (én pr. linje).', true);
    return;
  }
  const res = await api('/api/bets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ classId: parseInt(classId, 10), title, description: description || undefined, options }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showMessage('bet-message', data.error || 'Kunne ikke oprette bet', true);
    return;
  }
  showMessage('bet-message', 'Bet oprettet ✓');
  document.getElementById('bet-title').value = '';
  document.getElementById('bet-desc').value = '';
  document.getElementById('bet-options').value = '';

  const filter = document.getElementById('bet-filter-class').value;
  if (filter) loadBetsAdmin(parseInt(filter, 10));
});

document.getElementById('bet-filter-class').addEventListener('change', async () => {
  const classId = document.getElementById('bet-filter-class').value;
  await loadBetsAdmin(classId ? parseInt(classId, 10) : null);
});

document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem('ontime_token');
  window.location.href = '/';
});

async function init() {
  await ensureAdmin();
  await fillClassSelects();
  renderUserList(await loadUsers());
  renderIpRangeList(await loadIpRanges());
  setGivePointsDateToToday();
  const betFilter = document.getElementById('bet-filter-class');
  if (betFilter && betFilter.value) {
    await loadBetsAdmin(parseInt(betFilter.value, 10));
  }
}
init();
