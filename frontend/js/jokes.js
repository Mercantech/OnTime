const token = localStorage.getItem('ontime_token');
if (!token) {
  window.location.href = '/';
}

const api = (path, opts = {}) => {
  const headers = { ...opts.headers, Authorization: `Bearer ${token}` };
  if (opts.body != null) headers['Content-Type'] = 'application/json';
  return fetch(path, { ...opts, headers });
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

let currentUser = null;

(function initHeader() {
  const el = document.getElementById('user-name');
  if (el) {
    api('/api/auth/me')
      .then((res) => res.ok ? res.json() : null)
      .then((user) => {
        if (user) {
          if (user.name) el.textContent = user.name;
          currentUser = { id: user.id, isAdmin: !!user.isAdmin };
          const adminBar = document.getElementById('jokes-admin-bar');
          if (currentUser.isAdmin && adminBar) adminBar.hidden = false;
        }
        loadJokes(showAllCheckbox?.checked ?? false);
      })
      .catch(() => {});
  }
  document.getElementById('logout')?.addEventListener('click', () => {
    localStorage.removeItem('ontime_token');
    window.location.href = '/';
  });
})();

const jokesListEl = document.getElementById('jokes-list');
const adminBarEl = document.getElementById('jokes-admin-bar');
const showAllCheckbox = document.getElementById('jokes-show-all');
const formEl = document.getElementById('form-joke');
const alreadySubmittedEl = document.getElementById('jokes-already-submitted');
const submitMessageEl = document.getElementById('jokes-submit-message');

function setSubmitSection(hasSubmittedToday) {
  if (formEl) formEl.hidden = hasSubmittedToday;
  if (alreadySubmittedEl) alreadySubmittedEl.hidden = !hasSubmittedToday;
}

function renderJokes(jokes) {
  if (!jokesListEl) return;
  if (!jokes || jokes.length === 0) {
    jokesListEl.innerHTML = '<p class="jokes-empty">Ingen jokes i dag endnu. Vær den første!</p>';
    return;
  }

  const hasOwn = jokes.some((j) => j.isOwn);
  setSubmitSection(hasOwn);

  jokesListEl.innerHTML = jokes
    .map((j, index) => {
      const isFirst = index === 0;
      const classLabel = j.className ? `<span class="joke-row-class">${escapeHtml(j.className)}</span>` : '';
      const voteSection = j.isOwn
        ? '<span class="joke-row-own-label">Din joke</span>'
        : `<div class="joke-row-votes">
            <span class="joke-vote-count" aria-label="Antal stemmer" ${isFirst ? 'data-vote-bump' : ''}>${j.voteCount}</span>
            <button type="button" class="joke-vote-btn ${j.currentUserHasVoted ? 'voted' : ''}" data-id="${j.id}" data-voted="${j.currentUserHasVoted}">
              ${j.currentUserHasVoted ? 'Fjern stemme' : 'Stem'}
            </button>
          </div>`;
      const banBtn = currentUser?.isAdmin && !j.isOwn
        ? `<button type="button" class="joke-ban-btn" data-user-id="${j.userId}" data-user-name="${escapeHtml(j.userName || 'bruger')}">Ban bruger (1 uge)</button>`
        : '';
      return `
    <div class="joke-card ${j.isOwn ? 'joke-card-own' : ''} ${isFirst ? 'joke-card-winner' : ''}" data-joke-id="${j.id}" style="--i: ${index}">
      ${isFirst ? '<span class="joke-winner-badge" aria-hidden="true">1. plads</span>' : ''}
      ${classLabel}
      <div class="joke-card-body">${escapeHtml(j.body)}</div>
      <div class="joke-card-meta">
        ${j.userName ? `<span class="joke-card-by">Af ${escapeHtml(j.userName)}</span>` : ''}
        ${voteSection}
        ${banBtn}
      </div>
    </div>`;
    })
    .join('');

  jokesListEl.querySelectorAll('.joke-vote-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.getAttribute('data-id'));
      const voted = btn.getAttribute('data-voted') === 'true';
      toggleVote(id, voted, btn);
    });
  });

  jokesListEl.querySelectorAll('.joke-ban-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const userId = btn.getAttribute('data-user-id');
      const userName = btn.getAttribute('data-user-name') || 'brugeren';
      const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const dateStr = until.toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' });
      if (!confirm(`Udeluk ${userName} fra hele OnTime i 7 dage? Brugeren kan ikke logge ind før ${dateStr}.`)) return;
      btn.disabled = true;
      api(`/api/admin/users/${userId}/ban`, {
        method: 'POST',
        body: JSON.stringify({ durationDays: 7, reason: 'Offensiv joke (dagens joke)' }),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          return { res, data };
        })
        .then(({ res, data }) => {
          if (!res.ok) {
            alert(data.error || 'Kunne ikke udelukke bruger');
            btn.disabled = false;
            return;
          }
          loadJokes(showAllCheckbox?.checked ?? false);
        })
        .catch(() => {
          btn.disabled = false;
        });
    });
  });
}

function loadJokes(showAll) {
  if (!jokesListEl) return;
  jokesListEl.textContent = 'Indlæser…';
  const url = showAll ? '/api/jokes?all=1' : '/api/jokes';
  api(url)
    .then((res) => {
      if (!res.ok) throw new Error('Kunne ikke hente listen');
      return res.json();
    })
    .then((data) => renderJokes(data.jokes))
    .catch(() => {
      jokesListEl.innerHTML = '<p class="jokes-error">Kunne ikke indlæse jokes. Prøv igen.</p>';
    });
}

if (adminBarEl && showAllCheckbox) {
  showAllCheckbox.addEventListener('change', () => {
    loadJokes(showAllCheckbox.checked);
  });
}

function toggleVote(jokeId, currentlyVoted, btnEl) {
  const method = currentlyVoted ? 'DELETE' : 'POST';
  const path = `/api/jokes/${jokeId}/vote`;
  api(path, { method })
    .then((res) => {
      if (!res.ok) return res.json().then((d) => Promise.reject(new Error(d.error || 'Kunne ikke opdatere stemme')));
      loadJokes(showAllCheckbox?.checked ?? false);
    })
    .catch((err) => alert(err.message || 'Kunne ikke stemme'));
}

document.getElementById('form-joke')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const bodyEl = document.getElementById('joke-body');
  const body = bodyEl?.value?.trim() || '';
  if (!body) return;
  if (submitMessageEl) {
    submitMessageEl.textContent = 'Indsender…';
    submitMessageEl.hidden = false;
    submitMessageEl.className = 'message';
  }
  const res = await api('/api/jokes', {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (submitMessageEl) {
      submitMessageEl.textContent = data.error || 'Kunne ikke indsende joke';
      submitMessageEl.className = 'message error';
      submitMessageEl.hidden = false;
    }
    return;
  }
  if (submitMessageEl) submitMessageEl.hidden = true;
  if (bodyEl) bodyEl.value = '';
  updateCharCount();
  loadJokes(showAllCheckbox?.checked ?? false);
});

function updateCharCount() {
  const bodyEl = document.getElementById('joke-body');
  const countEl = document.getElementById('joke-char-count');
  if (countEl && bodyEl) countEl.textContent = bodyEl.value.length;
}

document.getElementById('joke-body')?.addEventListener('input', updateCharCount);

updateCharCount();
