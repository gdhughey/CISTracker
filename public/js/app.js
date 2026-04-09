'use strict';

// Tiny client for the placeholder UI. Real frontend will replace this.

function getCookie(name) {
  return document.cookie.split('; ').find(c => c.startsWith(name + '='))?.split('=')[1];
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const csrf = getCookie('csrf_token');
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const r = await fetch(path, { ...opts, headers, credentials: 'same-origin' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { status: r.status, data });
  return data;
}

const $ = id => document.getElementById(id);

function show(section) {
  for (const id of ['login-section', 'mfa-section', 'dashboard-section']) {
    $(id).hidden = id !== section;
  }
}

function setMsg(id, text, kind) {
  const el = $(id);
  el.textContent = text || '';
  el.className = 'msg' + (kind ? ' ' + kind : '');
}

async function refreshSession() {
  try {
    const { user } = await api('/api/auth/me');
    if (user) {
      $('user-status').textContent = `signed in as ${user.username} (${user.role})`;
      show('dashboard-section');
    } else {
      $('user-status').textContent = 'not signed in';
      show('login-section');
    }
  } catch (err) {
    $('user-status').textContent = 'error: ' + err.message;
  }
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg('login-msg', '');
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('username').value, password: $('password').value }),
    });
    if (result.challenge === 'MFA_REQUIRED') {
      show('mfa-section');
      return;
    }
    await refreshSession();
  } catch (err) {
    setMsg('login-msg', err.message, 'error');
  }
});

$('mfa-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg('mfa-msg', '');
  try {
    await api('/api/auth/mfa-verify', {
      method: 'POST',
      body: JSON.stringify({ token: $('mfa-token').value }),
    });
    await refreshSession();
  } catch (err) {
    setMsg('mfa-msg', err.message, 'error');
  }
});

$('logout-btn').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {}
  await refreshSession();
});

refreshSession();
