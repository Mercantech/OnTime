const qaToken = localStorage.getItem('ontime_token');
if (!qaToken) {
  window.location.href = '/';
}

const qaApi = (path, opts = {}) =>
  fetch(path, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${qaToken}` },
  });

let qaClasses = [];
let qaCurrentSessionId = null;

async function qaEnsureAdmin() {
  const res = await qaApi('/api/auth/me');
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
  const el = document.getElementById('quiz-admin-user');
  if (el) el.textContent = user.name;
  if (Array.isArray(user.classes)) qaClasses = user.classes;
}

async function qaLoadClasses() {
  if (qaClasses.length) return qaClasses;
  try {
    const res = await qaApi('/api/admin/classes');
    const data = await res.json().catch(() => null);
    if (!res.ok) return [];
    const list = Array.isArray(data) ? data : [];
    qaClasses = list;
    return list;
  } catch {
    return [];
  }
}

async function qaFillClassSelect() {
  const select = document.getElementById('quiz-admin-class');
  if (!select) return;
  const classes = await qaLoadClasses();
  const opts =
    '<option value="">Vælg klasse</option>' +
    classes
      .map((c) => `<option value="${String(c.id)}">${String(c.name || '')}</option>`)
      .join('');
  select.innerHTML = opts;
}

function qaEscapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

function qaShowMessage(text, isError = false) {
  const el = document.getElementById('quiz-admin-message');
  if (!el) return;
  el.hidden = false;
  el.className = 'message ' + (isError ? 'error' : 'success');
  el.textContent = text;
}

async function qaLoadTemplatesForClass(classId) {
  const listEl = document.getElementById('quiz-admin-list');
  if (!listEl) return;
  if (!classId) {
    listEl.innerHTML = '<p class="muted">Vælg en klasse for at se quizzer.</p>';
    return;
  }
  listEl.innerHTML = '<p class="muted">Indlæser…</p>';
  try {
    const res = await qaApi('/api/quizzes/templates?classId=' + encodeURIComponent(String(classId)));
    const data = await res.json().catch(() => []);
    if (!res.ok) {
      listEl.innerHTML =
        '<p class="muted">' +
        qaEscapeHtml((data && data.error) || 'Kunne ikke hente quizzer.') +
        '</p>';
      return;
    }
    const templates = Array.isArray(data) ? data : [];
    if (!templates.length) {
      listEl.innerHTML = '<p class="muted">Ingen quizzer for denne klasse endnu.</p>';
      return;
    }
    listEl.innerHTML =
      '<ul class="quiz-admin-list-ul">' +
      templates
        .map(
          (q) =>
            '<li><button type="button" class="quiz-list-item" data-id="' +
            q.id +
            '">' +
            qaEscapeHtml(q.title || '') +
            '</button></li>'
        )
        .join('') +
      '</ul>';
    listEl.querySelectorAll('.quiz-list-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-id') || '0', 10);
        if (!id) return;
        qaLoadTemplateIntoForm(id, classId, templates);
      });
    });
  } catch {
    listEl.innerHTML = '<p class="muted">Kunne ikke hente quizzer.</p>';
  }
}

function qaResetForm() {
  const idEl = document.getElementById('quiz-admin-id');
  const titleEl = document.getElementById('quiz-admin-title');
  const descEl = document.getElementById('quiz-admin-description');
  const questionsWrap = document.getElementById('quiz-admin-questions');
  const msgEl = document.getElementById('quiz-admin-message');
  if (idEl) idEl.value = '';
  if (titleEl) titleEl.value = '';
  if (descEl) descEl.value = '';
  if (questionsWrap) questionsWrap.innerHTML = '';
  if (msgEl) {
    msgEl.hidden = true;
    msgEl.textContent = '';
  }
}

function qaAddQuestionRow(text = '', options = ['', ''], correctIndex = 0, timeLimitSeconds = 20) {
  const wrap = document.getElementById('quiz-admin-questions');
  if (!wrap) return;
  const idx = wrap.children.length;
  const row = document.createElement('div');
  row.className = 'quiz-question-row';
  row.innerHTML =
    '<div class="quiz-q-header">' +
    '<span class="quiz-q-label">Spørgsmål ' +
    (idx + 1) +
    '</span>' +
    '<button type="button" class="quiz-q-remove">Fjern</button>' +
    '</div>' +
    '<input type="text" class="quiz-q-text" placeholder="Spørgsmålstekst" value="' +
    qaEscapeHtml(text) +
    '">' +
    '<div class="quiz-q-options">' +
    options
      .map(
        (opt, i) =>
          '<label class="quiz-q-option">' +
          '<input type="radio" name="quiz-q-correct-' +
          idx +
          '" ' +
          (i === correctIndex ? 'checked' : '') +
          '>' +
          '<input type="text" class="quiz-q-option-text" placeholder="Svarmulighed" value="' +
          qaEscapeHtml(opt) +
          '">' +
          '</label>'
      )
      .join('') +
    '</div>' +
    '<div class="quiz-q-meta">' +
    '<label>Tidsgrænse (sek.) <input type="number" class="quiz-q-time" min="5" max="300" value="' +
    String(timeLimitSeconds) +
    '"></label>' +
    '</div>';
  wrap.appendChild(row);
  const removeBtn = row.querySelector('.quiz-q-remove');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      row.remove();
    });
  }
}

function qaCollectForm() {
  const titleEl = document.getElementById('quiz-admin-title');
  const descEl = document.getElementById('quiz-admin-description');
  const idEl = document.getElementById('quiz-admin-id');
  const classEl = document.getElementById('quiz-admin-class');
  const questionsWrap = document.getElementById('quiz-admin-questions');
  if (!titleEl || !classEl || !questionsWrap) return null;
  const classId = parseInt(classEl.value || '0', 10);
  if (!classId) return null;
  const questions = [];
  questionsWrap.querySelectorAll('.quiz-question-row').forEach((row) => {
    const text = row.querySelector('.quiz-q-text')?.value.trim();
    const optEls = row.querySelectorAll('.quiz-q-option');
    const opts = [];
    let correctIndex = 0;
    optEls.forEach((optEl, i) => {
      const input = optEl.querySelector('.quiz-q-option-text');
      const radio = optEl.querySelector('input[type="radio"]');
      const val = input?.value.trim();
      if (val) {
        opts.push(val);
        if (radio && radio.checked) correctIndex = i;
      }
    });
    const timeInput = row.querySelector('.quiz-q-time');
    const tl = timeInput ? parseInt(timeInput.value || '20', 10) : 20;
    if (text && opts.length >= 2) {
      questions.push({
        text,
        options: opts,
        correctOptionIndex: correctIndex,
        timeLimitSeconds: tl,
      });
    }
  });
  if (!questions.length) return null;
  return {
    id: idEl ? parseInt(idEl.value || '0', 10) || null : null,
    classId,
    title: titleEl.value.trim(),
    description: descEl?.value.trim() || '',
    questions,
  };
}

function qaLoadTemplateIntoForm(id, classId, templates) {
  const tpl = Array.isArray(templates) ? templates.find((t) => t.id === id) : null;
  if (!tpl) return;
  const idEl = document.getElementById('quiz-admin-id');
  const titleEl = document.getElementById('quiz-admin-title');
  const descEl = document.getElementById('quiz-admin-description');
  const questionsWrap = document.getElementById('quiz-admin-questions');
  if (!idEl || !titleEl || !descEl || !questionsWrap) return;
  idEl.value = String(tpl.id);
  titleEl.value = tpl.title || '';
  descEl.value = tpl.description || '';
  questionsWrap.innerHTML =
    '<p class="muted">Eksisterende spørgsmål kan endnu ikke hentes automatisk – opbyg spørgsmålene her, og gem for at overskrive quizzen.</p>';
}

function qaBindLiveControls() {
  const infoEl = document.getElementById('quiz-admin-live-info');
  const metaWrap = document.getElementById('quiz-admin-live-meta');
  const statusEl = document.getElementById('quiz-admin-live-status');
  const qEl = document.getElementById('quiz-admin-live-question');
  const pinEl = document.getElementById('quiz-admin-live-pin');
  const btnStart = document.getElementById('quiz-admin-live-start');
  const btnNext = document.getElementById('quiz-admin-live-next');
  const btnEnd = document.getElementById('quiz-admin-live-end');

  async function refresh() {
    if (!qaCurrentSessionId) {
      if (infoEl)
        infoEl.textContent = 'Ingen aktiv session. Vælg en quiz og start en live-session, når eleverne er klar.';
      if (metaWrap) metaWrap.hidden = true;
      if (btnStart) btnStart.disabled = false;
      if (btnNext) btnNext.disabled = true;
      if (btnEnd) btnEnd.disabled = true;
      return;
    }
    try {
      const res = await qaApi('/api/quizzes/sessions/' + qaCurrentSessionId + '/state');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (infoEl) infoEl.textContent = 'Session kunne ikke hentes.';
        return;
      }
      const s = data.session || {};
      const q = data.currentQuestion || null;
      if (infoEl) {
        infoEl.textContent =
          'Quiz kører for klassen. Brug knapperne til at styre spørgsmålene.';
      }
      if (metaWrap) metaWrap.hidden = false;
      if (statusEl) statusEl.textContent = s.status || 'ukendt';
      if (qEl)
        qEl.textContent = q
          ? 'Spørgsmål #' + (Number(q.index || 0) + 1) + (q.text ? ': ' + q.text : '')
          : 'Ingen aktivt spørgsmål endnu';
      if (pinEl) pinEl.textContent = s.pin_code || s.pinCode || '—';
      if (btnStart) btnStart.disabled = s.status === 'running';
      if (btnNext) btnNext.disabled = !qaCurrentSessionId;
      if (btnEnd) btnEnd.disabled = !qaCurrentSessionId;
    } catch {
      if (infoEl) infoEl.textContent = 'Kunne ikke hente live-data.';
    }
  }

  if (btnStart) {
    btnStart.addEventListener('click', async () => {
      const idEl = document.getElementById('quiz-admin-id');
      const classEl = document.getElementById('quiz-admin-class');
      const tplId = idEl ? parseInt(idEl.value || '0', 10) : 0;
      const classId = classEl ? parseInt(classEl.value || '0', 10) : 0;
      if (!tplId || !classId) {
        if (infoEl) infoEl.textContent = 'Gem quiz og vælg klasse før du starter.';
        return;
      }
      try {
        const res = await qaApi('/api/quizzes/templates/' + tplId + '/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ classId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (infoEl) infoEl.textContent = data.error || 'Kunne ikke starte session.';
          return;
        }
        qaCurrentSessionId = data.id;
        if (infoEl)
          infoEl.textContent =
            'Quiz klar i lobby (PIN ' +
            (data.pin_code || data.pinCode || '–') +
            '). Elever ser “Aktiv quiz” på deres dashboard.';
        await refresh();
      } catch {
        if (infoEl) infoEl.textContent = 'Fejl ved start.';
      }
    });
  }

  if (btnNext) {
    btnNext.addEventListener('click', async () => {
      if (!qaCurrentSessionId) return;
      try {
        await qaApi('/api/quizzes/sessions/' + qaCurrentSessionId + '/next-question', {
          method: 'POST',
        });
        await refresh();
      } catch {
        if (infoEl) infoEl.textContent = 'Fejl ved næste spørgsmål.';
      }
    });
  }

  if (btnEnd) {
    btnEnd.addEventListener('click', async () => {
      if (!qaCurrentSessionId) return;
      try {
        await qaApi('/api/quizzes/sessions/' + qaCurrentSessionId + '/end', {
          method: 'POST',
        });
        if (infoEl) infoEl.textContent = 'Quiz afsluttet.';
        qaCurrentSessionId = null;
        await refresh();
      } catch {
        if (infoEl) infoEl.textContent = 'Fejl ved afslutning.';
      }
    });
  }

  refresh();
}

async function qaInit() {
  document.getElementById('quiz-admin-logout')?.addEventListener('click', () => {
    localStorage.removeItem('ontime_token');
    window.location.href = '/';
  });

  await qaEnsureAdmin();
  await qaFillClassSelect();

  const classSelect = document.getElementById('quiz-admin-class');
  const addBtn = document.getElementById('quiz-admin-add-question');
  const newBtn = document.getElementById('quiz-admin-new');
  const resetBtn = document.getElementById('quiz-admin-reset');
  const form = document.getElementById('quiz-admin-form');

  if (classSelect) {
    classSelect.addEventListener('change', () => {
      qaResetForm();
      const cid = classSelect.value;
      if (cid) qaLoadTemplatesForClass(parseInt(cid, 10));
    });
  }

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      qaAddQuestionRow('', ['', ''], 0, 20);
    });
  }

  if (newBtn) {
    newBtn.addEventListener('click', () => {
      qaResetForm();
      qaAddQuestionRow('', ['', ''], 0, 20);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      qaResetForm();
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = qaCollectForm();
      if (!data || !data.classId || !data.title || !data.questions.length) {
        qaShowMessage(
          'Udfyld titel, vælg klasse og tilføj mindst ét gyldigt spørgsmål med 2+ svarmuligheder.',
          true
        );
        return;
      }
      qaShowMessage('Gemmer…', false);
      try {
        const body = {
          classId: data.classId,
          title: data.title,
          description: data.description || undefined,
          questions: data.questions,
        };
        let res;
        if (data.id) {
          res = await qaApi('/api/quizzes/templates/' + data.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        } else {
          res = await qaApi('/api/quizzes/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        }
        const resp = await res.json().catch(() => ({}));
        if (!res.ok) {
          qaShowMessage(resp.error || 'Kunne ikke gemme quiz.', true);
          return;
        }
        if (!data.id && resp.id) {
          const idEl = document.getElementById('quiz-admin-id');
          if (idEl) idEl.value = String(resp.id);
        }
        qaShowMessage('Quiz gemt ✓', false);
        if (classSelect && classSelect.value) {
          await qaLoadTemplatesForClass(parseInt(classSelect.value, 10));
        }
      } catch {
        qaShowMessage('Fejl ved gemning.', true);
      }
    });
  }

  qaBindLiveControls();
}

qaInit();

