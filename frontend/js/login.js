if (localStorage.getItem('ontime_token')) {
  window.location.replace('/app');
} else {
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('login-error');
  errEl.hidden = true;
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    errEl.textContent = data.error || 'Login fejlede';
    errEl.hidden = false;
    return;
  }
  localStorage.setItem('ontime_token', data.token);
  window.location.href = '/app';
});
}
