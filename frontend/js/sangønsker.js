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
          if (currentUser.isAdmin && adminBarEl) adminBarEl.hidden = false;
        }
        loadRequests(showAllCheckbox?.checked ?? false);
      })
      .catch(() => {});
  }
  document.getElementById('logout')?.addEventListener('click', () => {
    localStorage.removeItem('ontime_token');
    window.location.href = '/';
  });
})();

// ---------- Liste over forespørgsler ----------
const requestsListEl = document.getElementById('requests-list');
const adminBarEl = document.getElementById('sangønsker-admin-bar');
const showAllCheckbox = document.getElementById('sangønsker-show-all');

function renderRequests(requests) {
  if (!requestsListEl) return;
  if (!requests || requests.length === 0) {
    requestsListEl.innerHTML = '<p class="sangønsker-empty">Ingen sangønsker endnu. Brug søgen ovenfor til at tilføje et ønske.</p>';
    return;
  }
  const canDelete = (r) => currentUser && (currentUser.isAdmin || r.requestedBy === currentUser.id);

  requestsListEl.innerHTML = requests
    .map(
      (r) => {
        const showDelete = canDelete(r);
        const classLabel = r.className ? `<span class="sangønsker-row-class">${escapeHtml(r.className)}</span>` : '';
        return `
    <div class="sangønsker-row" data-id="${r.id}">
      <div class="sangønsker-row-cover">
        ${r.albumArtUrl ? `<img src="${escapeHtml(r.albumArtUrl)}" alt="" width="56" height="56">` : '<span class="sangønsker-row-no-art">♪</span>'}
      </div>
      <div class="sangønsker-row-info">
        ${classLabel}
        <span class="sangønsker-row-title">${escapeHtml(r.trackName)}</span>
        <span class="sangønsker-row-artist">${escapeHtml(r.artistName)}</span>
        ${r.requestedByName ? `<span class="sangønsker-row-by">Ønsket af ${escapeHtml(r.requestedByName)}</span>` : ''}
      </div>
      <div class="sangønsker-row-actions">
        <div class="sangønsker-row-votes">
          <span class="sangønsker-vote-count" aria-label="Antal stemmer">${r.voteCount}</span>
          <button type="button" class="sangønsker-vote-btn ${r.currentUserHasVoted ? 'voted' : ''}" data-id="${r.id}" data-voted="${r.currentUserHasVoted}">
            ${r.currentUserHasVoted ? 'Fjern stemme' : 'Stem op'}
          </button>
        </div>
        ${r.previewUrl ? `<a href="${escapeHtml(r.previewUrl)}" target="_blank" rel="noopener noreferrer" class="sangønsker-preview-link">Lyt 30s</a>` : ''}
        <a href="https://open.spotify.com/track/${escapeHtml(r.spotifyTrackId)}" target="_blank" rel="noopener noreferrer" class="sangønsker-spotify-link">Åbn i Spotify</a>
        ${showDelete ? `<button type="button" class="sangønsker-delete-btn" data-id="${r.id}" title="Fjern fra listen">Slet</button>` : ''}
      </div>
    </div>`;
      }
    )
    .join('');

  requestsListEl.querySelectorAll('.sangønsker-vote-btn').forEach((btn) => {
    btn.addEventListener('click', () => toggleVote(Number(btn.getAttribute('data-id')), btn.getAttribute('data-voted') === 'true'));
  });
  requestsListEl.querySelectorAll('.sangønsker-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => deleteRequest(Number(btn.getAttribute('data-id'))));
  });
}

function loadRequests(showAll) {
  if (!requestsListEl) return;
  requestsListEl.textContent = 'Indlæser…';
  const url = showAll ? '/api/song-requests?all=1' : '/api/song-requests';
  api(url)
    .then((res) => {
      if (!res.ok) throw new Error('Kunne ikke hente listen');
      return res.json();
    })
    .then((data) => {
      renderRequests(data.requests);
      if (spotifyPlayQueue.length === 0) updateSpotifyQueueFromRequests(data.requests);
      else renderSpotifyQueue();
    })
    .catch(() => {
      requestsListEl.innerHTML = '<p class="sangønsker-error">Kunne ikke indlæse sangønsker. Prøv igen.</p>';
      updateSpotifyQueueFromRequests([]);
    });
}

/** Periodisk opdatering af ønskeliste og kø (nye ønsker + stemmer) uden at vise "Indlæser…". */
const SANGØNSKER_POLL_INTERVAL_MS = 15000; // 15 sekunder
let sangønskerPollTimer = null;
function startSangønskerPolling() {
  if (sangønskerPollTimer) return;
  sangønskerPollTimer = setInterval(() => {
    const showAll = showAllCheckbox?.checked ?? false;
    const url = showAll ? '/api/song-requests?all=1' : '/api/song-requests';
    api(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.requests) {
          renderRequests(data.requests);
          updateSpotifyQueueFromRequests(data.requests);
        }
      })
      .catch(() => {});
  }, SANGØNSKER_POLL_INTERVAL_MS);
}
function stopSangønskerPolling() {
  if (sangønskerPollTimer) {
    clearInterval(sangønskerPollTimer);
    sangønskerPollTimer = null;
  }
}

if (adminBarEl && showAllCheckbox) {
  showAllCheckbox.addEventListener('change', () => {
    loadRequests(showAllCheckbox.checked);
  });
}

function deleteRequest(requestId) {
  api(`/api/song-requests/${requestId}`, { method: 'DELETE' })
    .then((res) => {
      if (!res.ok) return res.json().then((d) => Promise.reject(new Error(d.error || 'Kunne ikke slette')));
      loadRequests(showAllCheckbox?.checked ?? false);
    })
    .catch(() => {});
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

// ---------- Søg og tilføj ønske (live-søgning) ----------
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const searchResults = document.getElementById('search-results');

const SEARCH_DEBOUNCE_MS = 350;
const MIN_SEARCH_LENGTH = 2;

let searchDebounceTimer = null;
let searchAbortController = null;

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
  if (!searchResults) return;

  if (!q || q.length < MIN_SEARCH_LENGTH) {
    searchResults.hidden = true;
    searchResults.innerHTML = '';
    return;
  }

  if (searchAbortController) searchAbortController.abort();
  searchAbortController = new AbortController();
  const signal = searchAbortController.signal;

  searchResults.innerHTML = '<p class="sangønsker-search-loading">Søger…</p>';
  searchResults.hidden = false;

  api(`/api/song-requests/search?${new URLSearchParams({ q })}`, { signal })
    .then((res) => {
      if (!res.ok) return res.json().then((d) => Promise.reject(new Error(d.error || 'Søgning fejlede')));
      return res.json();
    })
    .then((data) => showSearchResults(data.tracks))
    .catch((err) => {
      if (err.name === 'AbortError') return;
      searchResults.innerHTML = `<p class="sangønsker-search-error">${escapeHtml(err.message || 'Kunne ikke søge')}</p>`;
      searchResults.hidden = false;
    });
}

function scheduleLiveSearch() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  const q = searchInput?.value?.trim();
  if (!q || q.length < MIN_SEARCH_LENGTH) {
    searchResults.hidden = true;
    searchResults.innerHTML = '';
    return;
  }
  searchDebounceTimer = setTimeout(() => doSearch(), SEARCH_DEBOUNCE_MS);
}

function addRequest(body) {
  searchResults.hidden = true;
  searchResults.innerHTML = '';
  searchInput.value = '';
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
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
searchInput?.addEventListener('input', scheduleLiveSearch);
searchInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    doSearch();
  }
});

// ---------- Spotify: Afspil i samme vindue ----------
const spotifyConnectBtn = document.getElementById('spotify-connect-btn');
const spotifyConnectedLabel = document.getElementById('spotify-connected-label');
const spotifyDisconnectBtn = document.getElementById('spotify-disconnect-btn');
const spotifyConnectFooter = document.getElementById('spotify-connect-footer');
const spotifyPlayArea = document.getElementById('spotify-play-area');
const spotifyPlayTopBtn = document.getElementById('spotify-play-top-btn');
const spotifyPlayerUi = document.getElementById('spotify-player-ui');
const spotifyNowArtImg = document.getElementById('spotify-now-art-img');
const spotifyNowTitle = document.getElementById('spotify-now-title');
const spotifyNowArtist = document.getElementById('spotify-now-artist');
const spotifyProgress = document.getElementById('spotify-progress');
const spotifyTimePos = document.getElementById('spotify-time-pos');
const spotifyTimeDur = document.getElementById('spotify-time-dur');
const spotifyBtnPrev = document.getElementById('spotify-btn-prev');
const spotifyBtnPlay = document.getElementById('spotify-btn-play');
const spotifyBtnNext = document.getElementById('spotify-btn-next');
const spotifyQueueList = document.getElementById('spotify-queue-list');
const spotifyQueueSubtitle = document.getElementById('spotify-queue-subtitle');

let spotifyPlayer = null;
let spotifyDeviceId = null;
let trackIdToRequestId = {};
let spotifyPlayQueue = []; // { spotifyTrackId, trackName, artistName, albumArtUrl } – resten af køen
let spotifyProgressInterval = null;
let spotifyPlaybackSessionActive = false;
let spotifyInitialTrackId = null;
let spotifyInitialTrackDeleted = false;
let spotifyQueueRefreshTimer = null;
/** Track-ids der er afspillet eller skippet denne session – så de ikke tilføjes til køen igen ved refresh. */
let spotifyPlayedOrSkippedIds = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRequestsUrl() {
  return showAllCheckbox?.checked ? '/api/song-requests?all=1' : '/api/song-requests';
}

function scheduleSpotifyQueueRefresh() {
  if (!spotifyPlaybackSessionActive) return;
  if (spotifyQueueRefreshTimer) clearTimeout(spotifyQueueRefreshTimer);
  spotifyQueueRefreshTimer = setTimeout(() => {
    refreshSpotifyQueueFromWishlist().catch(() => {});
  }, 800);
}

/**
 * Tilføjer kun NYE sange fra ønskelisten til Spotify-køen via "Add to Queue".
 * Vi kalder aldrig PUT /play her – så afspilningen hopper ikke eller starter forfra.
 */
async function refreshSpotifyQueueFromWishlist() {
  if (!spotifyPlaybackSessionActive || !spotifyPlayer) return;

  const state = await spotifyPlayer.getCurrentState();
  const currentId = state?.track_window?.current_track
    ? String(state.track_window.current_track.uri || '').split(':')[2]
    : null;

  const alreadyInQueue = new Set(spotifyPlayQueue.map((q) => q.spotifyTrackId));
  if (currentId) alreadyInQueue.add(currentId);

  const reqRes = await api(getRequestsUrl());
  if (!reqRes.ok) return;
  const data = await reqRes.json();
  const requests = data.requests || [];
  if (!requests.length) return;

  // Opdater mapping for alle ønsker (så nye kan slettes når de afspilles).
  requests.forEach((r) => { trackIdToRequestId[r.spotifyTrackId] = r.id; });

  // Tilføj ikke sange der allerede er afspillet/skippet denne session (så de ikke dukker op i køen igen).
  const toAdd = requests.filter(
    (r) => !alreadyInQueue.has(r.spotifyTrackId) && !spotifyPlayedOrSkippedIds.has(r.spotifyTrackId)
  );
  if (!toAdd.length) {
    // Synk visningen af "kommer næste" med ønskelisten (efter current), uden afspillede/skippede.
    if (currentId) {
      const idx = requests.findIndex((r) => r.spotifyTrackId === currentId);
      if (idx >= 0) {
        spotifyPlayQueue = requests
          .slice(idx + 1)
          .filter((r) => !spotifyPlayedOrSkippedIds.has(r.spotifyTrackId))
          .map((r) => ({
            spotifyTrackId: r.spotifyTrackId,
            trackName: r.trackName,
            artistName: r.artistName,
            albumArtUrl: r.albumArtUrl || null,
          }));
        renderSpotifyQueue();
      }
    }
    return;
  }

  const token = await getSpotifyToken();
  const headers = { Authorization: `Bearer ${token}` };

  for (const r of toAdd) {
    const uri = `spotify:track:${r.spotifyTrackId}`;
    const addUrl = `https://api.spotify.com/v1/me/player/queue?${new URLSearchParams({ uri })}`;
    const res = await fetch(addUrl, { method: 'POST', headers });
    if (res.status !== 204 && res.status !== 200) break;
    spotifyPlayQueue.push({
      spotifyTrackId: r.spotifyTrackId,
      trackName: r.trackName,
      artistName: r.artistName,
      albumArtUrl: r.albumArtUrl || null,
    });
  }
  renderSpotifyQueue();
}

function showSpotifyConnected(connected) {
  if (spotifyConnectBtn) spotifyConnectBtn.hidden = connected;
  if (spotifyPlayArea) spotifyPlayArea.hidden = !connected;
  if (spotifyConnectFooter) spotifyConnectFooter.hidden = !connected;
}

function checkSpotifyConnected() {
  api('/api/spotify/connected')
    .then((res) => res.ok ? res.json() : { connected: false })
    .then((data) => showSpotifyConnected(!!data.connected))
    .catch(() => showSpotifyConnected(false));
}

spotifyConnectBtn?.addEventListener('click', () => {
  api('/api/spotify/auth-url')
    .then((res) => res.ok ? res.json() : Promise.reject(new Error('Kunne ikke hente link')))
    .then((data) => { window.location.href = data.url; })
    .catch((err) => { alert(err.message || 'Kunne ikke forbinde til Spotify'); });
});

spotifyDisconnectBtn?.addEventListener('click', () => {
  api('/api/spotify/disconnect', { method: 'DELETE' })
    .then((res) => { if (res.ok) showSpotifyConnected(false); })
    .catch(() => {});
});

function getSpotifyToken() {
  return api('/api/spotify/token').then((res) => {
    if (!res.ok) return res.json().then((d) => Promise.reject(new Error(d.error || 'Ingen token')));
    return res.json().then((data) => data.access_token);
  });
}

function formatSpotifyTime(ms) {
  if (ms == null || !Number.isFinite(ms)) return '0:00';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function clearSpotifyProgressInterval() {
  if (spotifyProgressInterval) {
    clearInterval(spotifyProgressInterval);
    spotifyProgressInterval = null;
  }
}

const SANGØNSKER_DEFAULT_TITLE = 'OnTime – Sangønsker';

function updateSpotifyNowPlaying(state) {
  if (!spotifyPlayerUi) return;
  const track = state?.track_window?.current_track;
  if (!track) {
    spotifyPlayerUi.hidden = true;
    document.title = SANGØNSKER_DEFAULT_TITLE;
    return;
  }
  spotifyPlayerUi.hidden = false;
  const artUrl = track.album?.images?.[0]?.url;
  if (spotifyNowArtImg) {
    spotifyNowArtImg.src = artUrl || '';
    spotifyNowArtImg.style.display = artUrl ? '' : 'none';
  }
  if (spotifyNowTitle) spotifyNowTitle.textContent = track.name || '';
  const artistStr = (track.artists || []).map((a) => a.name).join(', ') || '';
  if (spotifyNowArtist) spotifyNowArtist.textContent = artistStr;
  document.title = track.name ? `▶ ${track.name}${artistStr ? ` – ${artistStr}` : ''} | OnTime` : SANGØNSKER_DEFAULT_TITLE;
  const pos = state.position != null ? state.position : 0;
  const dur = state.duration || 0;
  if (spotifyTimePos) spotifyTimePos.textContent = formatSpotifyTime(pos);
  if (spotifyTimeDur) spotifyTimeDur.textContent = formatSpotifyTime(dur);
  const pct = dur > 0 ? Math.min(1000, Math.round((pos / dur) * 1000)) : 0;
  if (spotifyProgress) {
    spotifyProgress.value = pct;
  }
  if (spotifyBtnPlay) spotifyBtnPlay.textContent = state.paused ? '▶' : '❚❚';
  if (state.paused) clearSpotifyProgressInterval();
  else if (!spotifyProgressInterval) {
    spotifyProgressInterval = setInterval(() => {
      if (!spotifyPlayer) return;
      spotifyPlayer.getCurrentState().then((s) => {
        if (s) updateSpotifyNowPlaying(s);
      });
    }, 1000);
  }
}

/** Opdaterer kø-panelet med den live ønskeliste (sorteret efter stemmer). Bruges når der ikke afspilles. */
function updateSpotifyQueueFromRequests(requests) {
  if (!spotifyQueueList) return;
  if (spotifyQueueSubtitle) spotifyQueueSubtitle.textContent = '(ønskeliste – opdateres ved stemmer)';
  if (!requests || requests.length === 0) {
    spotifyQueueList.innerHTML = '<li class="spotify-queue-empty">Ingen sangønsker endnu</li>';
    return;
  }
  spotifyQueueList.innerHTML = requests
    .map(
      (r, i) =>
        `<li class="spotify-queue-item" data-id="${r.id}">
          ${r.albumArtUrl ? `<img src="${escapeHtml(r.albumArtUrl)}" alt="" width="36" height="36">` : '<span class="spotify-queue-no-art">♪</span>'}
          <span class="spotify-queue-item-title">${escapeHtml(r.trackName)}</span>
          <span class="spotify-queue-item-meta">${escapeHtml(r.artistName)} · ${r.voteCount ?? 0} stemmer</span>
        </li>`
    )
    .join('');
}

/** Viser den faktiske afspilningskø (kommer næste) – matcher hvad der spilles i Spotify. */
function renderSpotifyQueue() {
  if (!spotifyQueueList) return;
  if (spotifyQueueSubtitle) spotifyQueueSubtitle.textContent = '(kommer næste)';
  if (spotifyPlayQueue.length === 0) {
    spotifyQueueList.innerHTML = '<li class="spotify-queue-empty">Ingen flere sange i køen</li>';
    return;
  }
  spotifyQueueList.innerHTML = spotifyPlayQueue
    .map(
      (q, i) =>
        `<li class="spotify-queue-item" data-index="${i}">
          ${q.albumArtUrl ? `<img src="${escapeHtml(q.albumArtUrl)}" alt="" width="36" height="36">` : '<span class="spotify-queue-no-art">♪</span>'}
          <span class="spotify-queue-item-title">${escapeHtml(q.trackName)}</span>
          <span class="spotify-queue-item-meta">${escapeHtml(q.artistName)}</span>
        </li>`
    )
    .join('');
}

function waitForSpotifySDK() {
  if (window.Spotify) return Promise.resolve();
  return new Promise((resolve) => {
    window.onSpotifyWebPlaybackSDKReady = resolve;
  });
}

function ensureSpotifyPlayer(token) {
  return waitForSpotifySDK().then(() =>
    new Promise((resolve, reject) => {
      if (spotifyPlayer && spotifyDeviceId) {
        resolve({ player: spotifyPlayer, deviceId: spotifyDeviceId });
        return;
      }
    const player = new window.Spotify.Player({
      name: 'OnTime Sangønsker',
      getOAuthToken: (cb) => cb(token),
      volume: 0.8,
    });

    player.addListener('ready', ({ device_id }) => {
      spotifyDeviceId = device_id;
      spotifyPlayer = player;
      resolve({ player, deviceId: device_id });
    });
    player.addListener('not_ready', () => {});
    player.addListener('player_state_changed', (state) => {
      if (!state || !state.track_window) return;
      const prev = state.track_window.previous_tracks;
      if (prev && prev.length > 0) {
        const lastPlayed = prev[0];
        const uri = lastPlayed.uri || '';
        const trackId = uri.split(':')[2];
        if (trackId) spotifyPlayedOrSkippedIds.add(trackId);
        spotifyPlayQueue = spotifyPlayQueue.filter((q) => q.spotifyTrackId !== trackId);
        if (trackId && trackIdToRequestId[trackId]) {
          const requestId = trackIdToRequestId[trackId];
          delete trackIdToRequestId[trackId];
          api(`/api/song-requests/${requestId}`, { method: 'DELETE' })
            .then(() => loadRequests(showAllCheckbox?.checked ?? false))
            .catch(() => {});
        }

        // Når en sang er færdig, opdaterer vi Spotify-køen ud fra ny ønskeliste,
        // så nye ønsker kommer med i Spotify uden manuel "Afspil fra toppen".
        scheduleSpotifyQueueRefresh();
      }
      const current = state.track_window.current_track;
      if (current) {
        const currentId = (current.uri || '').split(':')[2];
        spotifyPlayQueue = spotifyPlayQueue.filter((q) => q.spotifyTrackId !== currentId);
        // Første sang ligger ikke i previous_tracks, så vi sletter KUN den første sang når den faktisk starter.
        if (
          spotifyPlaybackSessionActive &&
          !spotifyInitialTrackDeleted &&
          spotifyInitialTrackId &&
          currentId === spotifyInitialTrackId &&
          trackIdToRequestId[currentId]
        ) {
          spotifyInitialTrackDeleted = true;
          if (currentId) spotifyPlayedOrSkippedIds.add(currentId);
          const requestId = trackIdToRequestId[currentId];
          delete trackIdToRequestId[currentId];
          api(`/api/song-requests/${requestId}`, { method: 'DELETE' })
            .then(() => loadRequests(showAllCheckbox?.checked ?? false))
            .catch(() => {});
        }
      }
      updateSpotifyNowPlaying(state);
      renderSpotifyQueue();
    });

    player.connect().catch(reject);
  }));
}

function spotifyTransferAndPlay(token, deviceId, uris) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  return fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
  }).then((res) => {
    if (res.status === 204 || res.status === 200) return;
    return res.text().then((t) => Promise.reject(new Error(t || 'Kunne ikke vælge enhed')));
  }).then(async () => {
    // Giv Spotify Connect et øjeblik til at skifte aktiv device, ellers kan første play give 404.
    await sleep(350);
    const playUrl = `https://api.spotify.com/v1/me/player/play?${new URLSearchParams({ device_id: deviceId })}`;

    for (let attempt = 1; attempt <= 3; attempt++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(playUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ uris }),
      });
      if (res.status === 204 || res.status === 200) return;

      // 404 sker typisk hvis device endnu ikke er aktiv. Prøv igen kort efter.
      if (res.status === 404 && attempt < 3) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(500);
        continue;
      }

      const text = await res.text().catch(() => '');
      try {
        const d = text ? JSON.parse(text) : null;
        throw new Error(d?.error?.message || text || 'Kunne ikke starte afspilning');
      } catch {
        throw new Error(text || 'Kunne ikke starte afspilning');
      }
    }
  });
}

spotifyPlayTopBtn?.addEventListener('click', () => {
  const url = showAllCheckbox?.checked ? '/api/song-requests?all=1' : '/api/song-requests';
  spotifyPlayTopBtn.disabled = true;
  api(url)
    .then((res) => res.ok ? res.json() : Promise.reject(new Error('Kunne ikke hente listen')))
    .then((data) => {
      const requests = data.requests || [];
      if (requests.length === 0) {
        alert('Ingen sange på listen. Tilføj ønsker først.');
        spotifyPlayTopBtn.disabled = false;
        return;
      }
      spotifyPlayQueue = requests.map((r) => ({
        spotifyTrackId: r.spotifyTrackId,
        trackName: r.trackName,
        artistName: r.artistName,
        albumArtUrl: r.albumArtUrl || null,
      }));
      return getSpotifyToken().then((token) =>
        ensureSpotifyPlayer(token).then(({ player, deviceId }) => {
          trackIdToRequestId = {};
          spotifyPlayedOrSkippedIds = new Set();
          requests.forEach((r) => { trackIdToRequestId[r.spotifyTrackId] = r.id; });
          spotifyInitialTrackId = requests[0]?.spotifyTrackId || null;
          spotifyInitialTrackDeleted = false;
          const uris = requests.map((r) => `spotify:track:${r.spotifyTrackId}`);
          // Kræves i nogle browsere for at Web Playback må afspille efter et klik.
          player.activateElement?.().catch(() => {});
          return spotifyTransferAndPlay(token, deviceId, uris).then(() => {
            spotifyPlaybackSessionActive = true;
          });
        })
      ).then(() => {
        if (spotifyPlayerUi) spotifyPlayerUi.hidden = false;
        renderSpotifyQueue();
      });
    })
    .then(() => {
      spotifyPlayTopBtn.disabled = false;
    })
    .catch((err) => {
      spotifyPlayTopBtn.disabled = false;
      alert(err.message || 'Afspilning kunne ikke startes. Har du Spotify Premium og forbundet enhed?');
    });
});

spotifyBtnPlay?.addEventListener('click', () => {
  if (!spotifyPlayer) return;
  spotifyPlayer.togglePlay();
});
spotifyBtnPrev?.addEventListener('click', () => {
  if (!spotifyPlayer) return;
  spotifyPlayer.previousTrack();
});
spotifyBtnNext?.addEventListener('click', () => {
  if (!spotifyPlayer) return;
  spotifyPlayer.nextTrack();
});

spotifyProgress?.addEventListener('input', (e) => {
  const pct = Number(e.target.value);
  if (!spotifyPlayer || !Number.isFinite(pct)) return;
  spotifyPlayer.getCurrentState().then((state) => {
    if (!state || !state.duration) return;
    const posMs = Math.round((pct / 1000) * state.duration);
    spotifyPlayer.seek(posMs);
  });
});

// URL-parametre efter Spotify OAuth redirect
(function checkSpotifyRedirectParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('connected') === '1') {
    const label = spotifyConnectedLabel;
    if (label) label.textContent = 'Spotify forbundet!';
    checkSpotifyConnected();
    window.history.replaceState({}, '', window.location.pathname);
  } else if (params.get('error')) {
    const msg = params.get('error');
    alert('Spotify: ' + (msg === 'missing_params' ? 'Manglende parametre.' : decodeURIComponent(msg)));
    window.history.replaceState({}, '', window.location.pathname);
  }
})();

// ---------- Init ----------
loadRequests();
checkSpotifyConnected();
startSangønskerPolling();
