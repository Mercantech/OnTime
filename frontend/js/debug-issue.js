(function () {
  const ISSUE_URL = 'https://github.com/Mercantech/OnTime/issues/new';

  function buildBody() {
    const lines = [
      '**Beskriv fejlen her**',
      '',
      '_Evt. tilføj et screenshot (Print Screen og indsæt med Ctrl+V i issue-teksten)._',
      '',
      '---',
      '**Side:** ' + window.location.href,
      '**Sti:** ' + window.location.pathname,
      '**Tidspunkt:** ' + new Date().toISOString(),
      '**Browser:** ' + navigator.userAgent,
    ];
    return lines.join('\n');
  }

  function openIssue() {
    const title = 'Fejlrapport: ' + (document.title || window.location.pathname || 'OnTime');
    const body = buildBody();
    const url = ISSUE_URL + '?title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function injectButton() {
    if (document.getElementById('debug-issue-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'debug-issue-btn';
    btn.type = 'button';
    btn.className = 'debug-issue-btn';
    btn.setAttribute('aria-label', 'Rapportér fejl – åbn ny GitHub issue');
    btn.title = 'Rapportér fejl';
    btn.textContent = '🐛';
    btn.addEventListener('click', openIssue);
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectButton);
  } else {
    injectButton();
  }
})();
