(function () {
  const pathMatch = window.location.pathname.match(/^\/klasse\/(.+)$/);
  const className = pathMatch ? decodeURIComponent(pathMatch[1].replace(/\/$/, '')) : '';
  if (!className) {
    document.getElementById('hero-title').textContent = 'Klasse ikke angivet';
    document.getElementById('hero-sub').textContent = 'Brug URL som /klasse/2b for at se klassedashboard.';
    return;
  }

  function drawBurndownChart(canvas, data) {
    if (!canvas || !data || !data.labels || !data.labels.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
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
    function y(val) { return pad.top + chartH - (val / maxVal) * chartH; }
    function x(i) { return pad.left + (n > 1 ? (i / (n - 1)) * chartW : 0); }

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
      if (i % Math.max(1, Math.floor(n / 8)) === 0 || i === n - 1)
        ctx.fillText(data.labels[i], x(i), pad.top + chartH + 16);
    }
  }

  function formatDate(iso) {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  fetch('/api/public/class/' + encodeURIComponent(className))
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        document.getElementById('hero-title').textContent = 'Klasse ikke fundet';
        document.getElementById('hero-sub').textContent = data.error;
        return;
      }

      document.getElementById('hero-title').textContent = 'Klasse ' + data.className;
      document.getElementById('hero-sub').textContent = data.numStudents + ' elever · ' + data.classPercentage + '% af max point denne måned';
      document.getElementById('class-name-header').textContent = data.className;

      const statPoints = document.getElementById('stat-points');
      const statPointsMax = document.getElementById('stat-points-max');
      if (statPoints) statPoints.textContent = data.classTotal;
      if (statPointsMax) statPointsMax.textContent = ' / ' + data.maxPossibleClass + ' pt';

      const statStreak = document.getElementById('stat-streak');
      const streakVal = data.streak != null ? data.streak : 0;
      if (statStreak) statStreak.textContent = streakVal;
      const streakCard = document.querySelector('.stat-card-streak');
      if (streakCard) streakCard.classList.toggle('has-streak', streakVal > 0);

      const statPerfect = document.getElementById('stat-perfect');
      const perfectDays = Array.isArray(data.perfectDays) ? data.perfectDays : [];
      if (statPerfect) statPerfect.textContent = perfectDays.length;

      const canvas = document.getElementById('burndown-chart');
      if (canvas && data.burndown && data.burndown.labels && data.burndown.labels.length)
        drawBurndownChart(canvas, data.burndown);

      const perfectListEl = document.getElementById('perfect-days-list');
      if (perfectListEl) {
        if (perfectDays.length === 0)
          perfectListEl.textContent = 'Ingen dage endnu hvor alle kom til tiden.';
        else
          perfectListEl.textContent = perfectDays.map(formatDate).join(' · ');
      }

      const totalEl = document.getElementById('leaderboard-total');
      const podiumEl = document.getElementById('leaderboard-podium');
      const listEl = document.getElementById('leaderboard');
      const students = data.students || [];
      function gameIcons(gamesToday) {
        const g = Array.isArray(gamesToday) ? gamesToday : [];
        const parts = [];
        if (g.includes('wordle')) parts.push('🟩');
        if (g.includes('flag')) parts.push('🏳️');
        return parts.length ? '<span class="lb-games" title="Løst spil i dag">' + parts.join('') + '</span>' : '';
      }
      if (totalEl) totalEl.innerHTML = '<strong>Klasse total:</strong> ' + data.classTotal + ' / ' + data.maxPossibleClass + ' point (' + data.classPercentage + '%)';
      if (podiumEl) {
        const top3 = students.slice(0, 3);
        if (top3.length >= 3) {
          const order = [top3[1], top3[0], top3[2]];
          const places = ['place-2', 'place-1', 'place-3'];
          podiumEl.innerHTML = order.map((s, i) =>
            '<div class="podium-place ' + places[i] + '">' +
            '<span class="podium-avatar">' + s.rank + '</span>' +
            '<span class="podium-name"><a href="/profil/' + (s.userId || '') + '" class="podium-profile-link">' + escapeHtml(s.name) + '</a>' + gameIcons(s.gamesToday) + '</span>' +
            '<span class="podium-points">' + s.totalPoints + ' pt</span>' +
            '<div class="podium-step">' + s.rank + '. plads</div></div>'
          ).join('');
        } else {
          podiumEl.innerHTML = '';
        }
      }
      if (listEl) {
        const rest = students.slice(3);
        listEl.innerHTML = rest.length
          ? '<ul class="leaderboard-list">' + rest.map(s => '<li><span class="rank">' + s.rank + '</span><span class="name"><a href="/profil/' + (s.userId || '') + '" class="leaderboard-profile-link">' + escapeHtml(s.name) + '</a>' + gameIcons(s.gamesToday) + '</span><span class="points">' + s.totalPoints + ' pt (' + s.percentage + '%)</span></li>').join('') + '</ul>'
          : students.length > 0 ? '<p class="muted">Kun top 3 i klassen.</p>' : '<p class="muted">Ingen data</p>';
      }

      const highlights = data.highlights || {};
      const highlightsSection = document.getElementById('class-highlights');
      const highlightsGrid = document.getElementById('highlights-grid');
      if (highlightsSection && highlightsGrid) {
        const cards = [];
        if (highlights.bestStreak) {
          cards.push('<div class="highlight-card highlight-streak"><span class="highlight-label">Største streak</span><span class="highlight-name">' + escapeHtml(highlights.bestStreak.name) + '</span><span class="highlight-value">' + highlights.bestStreak.value + ' dage</span></div>');
        }
        if (highlights.weekTop) {
          cards.push('<div class="highlight-card highlight-week"><span class="highlight-label">Ugens højeste point</span><span class="highlight-name">' + escapeHtml(highlights.weekTop.name) + '</span><span class="highlight-value">' + highlights.weekTop.value + ' pt</span></div>');
        }
        if (highlights.earliestToday) {
          const t = new Date(highlights.earliestToday.time);
          const timeStr = t.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
          cards.push('<div class="highlight-card highlight-early"><span class="highlight-label">Tidligst inde i dag</span><span class="highlight-name">' + escapeHtml(highlights.earliestToday.name) + '</span><span class="highlight-value">kl. ' + timeStr + '</span></div>');
        }
        if (cards.length > 0) {
          highlightsSection.hidden = false;
          highlightsGrid.innerHTML = cards.join('');
        }
      }

      window.addEventListener('resize', () => {
        if (canvas && data.burndown) drawBurndownChart(canvas, data.burndown);
      });
    })
    .catch(() => {
      document.getElementById('hero-title').textContent = 'Fejl';
      document.getElementById('hero-sub').textContent = 'Kunne ikke hente klassedata.';
    });
})();
