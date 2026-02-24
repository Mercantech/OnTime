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

// ---------- Bruger i header + log ud ----------
(function initHeader() {
  const el = document.getElementById('user-name');
  if (el) {
    api('/api/auth/me')
      .then((res) => res.ok ? res.json() : null)
      .then((user) => { if (user && user.name) el.textContent = user.name; })
      .catch(() => {});
  }
  document.getElementById('logout')?.addEventListener('click', () => {
    localStorage.removeItem('ontime_token');
    window.location.href = '/';
  });
})();

// ---------- Liste over forespørgsler ----------
const requestsListEl = document.getElementById('requests-list');

function renderRequests(requests) {
  if (!requestsListEl) return;
  if (!requests || requests.length === 0) {
    requestsListEl.innerHTML = '<p class="sangønsker-empty">Ingen sangønsker endnu. Brug søgen ovenfor til at tilføje et ønske.</p>';
    return;
  }
  requestsListEl.innerHTML = requests
    .map(
      (r) => `
    <div class="sangønsker-row" data-id="${r.id}">
      <div class="sangønsker-row-cover">
        ${r.albumArtUrl ? `<img src="${escapeHtml(r.albumArtUrl)}" alt="" width="56" height="56">` : '<span class="sangønsker-row-no-art">♪</span>'}
      </div>
      <div class="sangønsker-row-info">
        <span class="sangønsker-row-title">${escapeHtml(r.trackName)}</span>
        <span class="sangønsker-row-artist">${escapeHtml(r.artistName)}</span>
        ${r.requestedByName ? `<span class="sangønsker-row-by">Ønsket af ${escapeHtml(r.requestedByName)}</span>` : ''}
      </div>
      <div class="sangønsker-row-votes">
        <span class="sangønsker-vote-count" aria-label="Antal stemmer">${r.voteCount}</span>
        <button type="button" class="sangønsker-vote-btn ${r.currentUserHasVoted ? 'voted' : ''}" data-id="${r.id}" data-voted="${r.currentUserHasVoted}">
          ${r.currentUserHasVoted ? 'Fjern stemme' : 'Stem op'}
        </button>
      </div>
      ${r.previewUrl ? `<a href="${escapeHtml(r.previewUrl)}" target="_blank" rel="noopener noreferrer" class="sangønsker-preview-link">Lyt 30s</a>` : ''}
      <a href="https://open.spotify.com/track/${escapeHtml(r.spotifyTrackId)}" target="_blank" rel="noopener noreferrer" class="sangønsker-spotify-link">Åbn i Spotify</a>
    </div>`
    )
    .join('');

  requestsListEl.querySelectorAll('.sangønsker-vote-btn').forEach((btn) => {
    btn.addEventListener('click', () => toggleVote(Number(btn.getAttribute('data-id')), btn.getAttribute('data-voted') === 'true'));
  });
}

function loadRequests() {
  requestsListEl.textContent = 'Indlæser…';
  api('/api/song-requests')
    .then((res) => {
      if (!res.ok) throw new Error('Kunne ikke hente listen');
      return res.json();
    })
    .then((data) => renderRequests(data.requests))
    .catch(() => {
      requestsListEl.innerHTML = '<p class="sangønsker-error">Kunne ikke indlæse sangønsker. Prøv igen.</p>';
    });
}

function toggleVote(requestId, currentlyVoted) {
  const method = currentlyVoted ? 'DELETE' : 'POST';
  const path = `/api/song-requests/${requestId}/vote`;
  api(path, { method })
    .then((res) => {
      if (!res.ok) throw new Error('Kunne ikke opdatere stemme');
      loadRequests();
    })
    .catch(() => {});
}

// ---------- Søg og tilføj ønske ----------
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const searchResults = document.getElementById('search-results');

function showSearchResults(tracks) {
  if (!searchResults) return;
  if (!tracks || tracks.length === 0) {
    searchResults.innerHTML = '<p class="sangønsker-search-none">Ingen resultater. Prøv et andet søgeord.</p>';
    searchResults.hidden = false;
    return;
  }
  searchResults.innerHTML = tracks
    .map(
      (t) => `
    <button type="button" class="sangønsker-search-item" data-id="${escapeHtml(t.id)}" data-name="${escapeHtml(t.name)}" data-artists="${escapeHtml(t.artists)}" data-art="${escapeHtml(t.albumArtUrl || '')}" data-preview="${escapeHtml(t.previewUrl || '')}">
      ${t.albumArtUrl ? `<img src="${escapeHtml(t.albumArtUrl)}" alt="" width="40" height="40">` : '<span class="sangønsker-search-no-art">♪</span>'}
      <span class="sangønsker-search-item-title">${escapeHtml(t.name)}</span>
      <span class="sangønsker-search-item-artist">${escapeHtml(t.artists)}</span>
    </button>`
    )
    .join('');
  searchResults.hidden = false;

  searchResults.querySelectorAll('.sangønsker-search-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name');
      const artists = btn.getAttribute('data-artists');
      const art = btn.getAttribute('data-art');
      const preview = btn.getAttribute('data-preview');
      addRequest({ spotify_track_id: id, track_name: name, artist_name: artists, album_art_url: art || undefined, preview_url: preview || undefined });
    });
  });
}

function doSearch() {
  const q = searchInput?.value?.trim();
  if (!q) return;
  searchResults.hidden = true;
  searchResults.innerHTML = '<p class="sangønsker-search-loading">Søger…</p>';
  searchResults.hidden = false;

  api(`/api/song-requests/search?${new URLSearchParams({ q })}`)
    .then((res) => {
      if (!res.ok) return res.json().then((d) => Promise.reject(new Error(d.error || 'Søgning fejlede')));
      return res.json();
    })
    .then((data) => showSearchResults(data.tracks))
    .catch((err) => {
      searchResults.innerHTML = `<p class="sangønsker-search-error">${escapeHtml(err.message || 'Kunne ikke søge')}</p>`;
      searchResults.hidden = false;
    });
}

function addRequest(body) {
  searchResults.hidden = true;
  searchInput.value = '';
  api('/api/song-requests', {
    method: 'POST',
    body: JSON.stringify(body),
  })
    .then((res) => {
      if (!res.ok) return res.json().then((d) => Promise.reject(new Error(d.error || 'Kunne ikke tilføje')));
      loadRequests();
    })
    .catch((err) => {
      searchResults.innerHTML = `<p class="sangønsker-search-error">${escapeHtml(err.message || 'Kunne ikke tilføje ønske')}</p>`;
      searchResults.hidden = false;
    });
}

searchBtn?.addEventListener('click', doSearch);
searchInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

// ---------- Init ----------
loadRequests();
