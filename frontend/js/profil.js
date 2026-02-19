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

function getUserIdFromPath() {
  const m = /^\/profil\/(\d+)$/.exec(window.location.pathname);
  return m ? m[1] : null;
}

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

document.getElementById('logout')?.addEventListener('click', () => {
  localStorage.removeItem('ontime_token');
  window.location.href = '/';
});

async function loadProfile() {
  const userId = getUserIdFromPath();
  const loadingEl = document.getElementById('profile-loading');
  const errorEl = document.getElementById('profile-error');
  const cardEl = document.getElementById('profile-card');

  if (!userId) {
    if (loadingEl) loadingEl.hidden = true;
    if (errorEl) {
      errorEl.textContent = 'Ugyldig profil-URL.';
      errorEl.hidden = false;
    }
    return;
  }

  try {
    const res = await api('/api/leaderboard/profile/' + userId);
    const data = await res.json().catch(() => ({}));

    if (loadingEl) loadingEl.hidden = true;

    if (!res.ok) {
      if (errorEl) {
        errorEl.textContent = data.error || 'Kunne ikke hente profil.';
        errorEl.hidden = false;
      }
      return;
    }

    if (errorEl) errorEl.hidden = true;
    if (cardEl) cardEl.hidden = false;

    const nameEl = document.getElementById('profile-name');
    const classEl = document.getElementById('profile-class');
    const pointsEl = document.getElementById('profile-points');
    const rankEl = document.getElementById('profile-rank');
    const avatarEl = document.getElementById('profile-avatar');
    const badgesEl = document.getElementById('profile-badges');

    if (nameEl) nameEl.textContent = data.name || 'Ukendt';
    if (classEl) {
      classEl.textContent = data.className ? 'Klasse ' + data.className : '';
      classEl.hidden = !data.className;
    }
    if (pointsEl) pointsEl.textContent = (data.totalPoints ?? 0) + ' point denne måned';
    if (rankEl) {
      rankEl.textContent = data.rankInClass ? '# ' + data.rankInClass + ' i klassen' : '';
      rankEl.hidden = !data.rankInClass;
    }
    if (avatarEl) {
      const initial = (data.name || '?').charAt(0).toUpperCase();
      avatarEl.textContent = initial;
    }

    if (badgesEl) {
      const badges = Array.isArray(data.badges) ? data.badges : [];
      badgesEl.innerHTML = badges.length
        ? badges
            .map((b) => {
              const secret = !!b.secret;
              const icon = BADGE_ICONS[b.key] || '•';
              const title = secret ? b.name + ' – ' + (b.description || '') : (b.description || b.name);
              const nameHtml = '<span class="badge-name">' + escapeHtml(b.name) + '</span>';
              const dateHtml = b.earnedAt ? '<span class="badge-date">' + escapeHtml(b.earnedAt) + '</span>' : '';
              return (
                '<div class="badge-item earned badge--' +
                escapeHtml(b.key || '') +
                (secret ? ' badge-secret' : '') +
                '" title="' +
                escapeHtml(title) +
                '">' +
                '<span class="badge-icon">' + icon + '</span>' +
                nameHtml +
                dateHtml +
                '</div>'
              );
            })
            .join('')
        : '<p class="muted">Ingen badges endnu.</p>';
    }

    document.title = (data.name || 'Profil') + ' – OnTime';
  } catch (e) {
    if (loadingEl) loadingEl.hidden = true;
    if (errorEl) {
      errorEl.textContent = 'Kunne ikke hente profil.';
      errorEl.hidden = false;
    }
  }
}

(async function init() {
  await loadUser();
  await loadProfile();
})();
