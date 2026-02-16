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
      if (statStreak) statStreak.textContent = data.streak != null ? data.streak : 0;

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
      const listEl = document.getElementById('leaderboard');
      if (totalEl) totalEl.innerHTML = '<strong>Klasse total:</strong> ' + data.classTotal + ' / ' + data.maxPossibleClass + ' point (' + data.classPercentage + '%)';
      if (listEl) {
        const students = data.students || [];
        listEl.innerHTML = students.length
          ? '<ul class="leaderboard-list">' + students.map(s => '<li><span class="rank">' + s.rank + '</span><span class="name">' + s.name + '</span><span class="points">' + s.totalPoints + ' pt (' + s.percentage + '%)</span></li>').join('') + '</ul>'
          : '<p class="muted">Ingen data</p>';
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
