'use strict';

// ─────────────────────────────────────────────────────────────
// CyberLab Tracker — on-prem client
// Same UI as the AWS build, rewired to /api/* with session
// cookies + double-submit CSRF instead of Cognito.
// ─────────────────────────────────────────────────────────────

let ME = null;          // current signed-in user
let usr = '';           // selected checkout user (name string)
let imageFile = null;   // File chosen for scan
let aiSource = false;   // whether current verify card came from AI
let cacheLog = [];      // last fetched activity log

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── HTTP helpers ──────────────────────────────────────────────
function getCookie(name) {
  const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[2]) : null;
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const csrf = getCookie('csrf_token');
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const r = await fetch(path, { ...opts, headers, credentials: 'same-origin' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || r.statusText || 'Request failed');
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

function toast(msg, type) {
  const el = $('toast');
  el.textContent = msg;
  el.style.borderColor =
    type === 'red' ? 'var(--red)' :
    type === 'green' ? 'var(--green)' :
    type === 'yellow' ? 'var(--yellow)' : 'var(--border)';
  el.style.display = 'block';
  clearTimeout(window._tt);
  window._tt = setTimeout(() => (el.style.display = 'none'), 3200);
}

// ── Page switching ────────────────────────────────────────────
function swPage(p, fromPop) {
  $('backBtn').style.display = p === 'checkout' ? 'none' : 'inline-block';
  if (!fromPop) history.pushState({ page: p }, '', location.href);
  ['checkout', 'checkin', 'log'].forEach((x) => {
    $('pg-' + x).classList.toggle('on', x === p);
    $('bt-' + x).classList.toggle('on', x === p);
  });
  $('scr').scrollTop = 0;
  if (p === 'checkin') loadCI();
  if (p === 'log') loadLog();
}
window.swPage = swPage;

window.addEventListener('popstate', (e) => swPage((e.state && e.state.page) || 'checkout', true));

// ── Checkout: user chips ──────────────────────────────────────
function selU(el, name) {
  document.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
  el.classList.add('on');
  usr = name;
}
window.selU = selU;

function addU() {
  const v = $('nuInput').value.trim();
  if (!v) return;
  const c = document.createElement('div');
  c.className = 'chip';
  c.textContent = v;
  c.addEventListener('click', () => selU(c, v));
  $('chips').appendChild(c);
  $('nuInput').value = '';
  selU(c, v);
}
window.addU = addU;

// ── Checkout: entry mode ──────────────────────────────────────
function swMode(m) {
  $('scanMode').classList.toggle('hidden', m !== 'scan');
  $('manualMode').classList.toggle('hidden', m !== 'manual');
  $('mt-scan').classList.toggle('on', m === 'scan');
  $('mt-manual').classList.toggle('on', m === 'manual');
  $('vcard').classList.add('hidden');
}
window.swMode = swMode;

// ── Image picking + compression ───────────────────────────────
function compressImage(file, cb) {
  const r = new FileReader();
  r.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1200;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob((blob) => cb(blob, c.toDataURL('image/jpeg', 0.75)), 'image/jpeg', 0.75);
    };
    img.src = ev.target.result;
  };
  r.readAsDataURL(file);
}

function handleFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  compressImage(file, (blob, dataUrl) => {
    imageFile = new File([blob], 'scan.jpg', { type: 'image/jpeg' });
    const grid = $('imgGrid');
    grid.innerHTML = '';
    const img = document.createElement('img');
    img.src = dataUrl;
    grid.appendChild(img);
    $('imgPrev').classList.remove('hidden');
    $('dz').classList.add('hidden');
    $('vcard').classList.add('hidden');
  });
}
window.handleFile = handleFile;

function clearImg() {
  imageFile = null;
  $('imgGrid').innerHTML = '';
  $('imgPrev').classList.add('hidden');
  $('dz').classList.remove('hidden');
  $('vcard').classList.add('hidden');
  $('scanSpin').classList.add('hidden');
  $('scanbtn').disabled = false;
}
window.clearImg = clearImg;

// ── AI scan ───────────────────────────────────────────────────
async function doScan() {
  if (!imageFile) { toast('No image selected!', 'yellow'); return; }
  if (!usr) { toast('Select who is checking out!', 'yellow'); return; }
  $('scanSpin').classList.remove('hidden');
  $('scanbtn').disabled = true;
  $('scanMsg').textContent = 'Analyzing...';
  try {
    const fd = new FormData();
    fd.append('image', imageFile);
    const res = await api('/api/scan', { method: 'POST', body: fd });
    const r = res.result || {};
    popV({
      name: r.name || '',
      type: r.type || '',
      serial: r.serial || '',
      barcode: r.barcode || '',
      notes: '',
      confidence: typeof r.confidence === 'number' ? Math.round(r.confidence * 100) : null,
    }, true);
  } catch (err) {
    toast('Scan failed: ' + err.message, 'red');
  } finally {
    $('scanSpin').classList.add('hidden');
    $('scanbtn').disabled = false;
  }
}
window.doScan = doScan;

// ── Manual entry ──────────────────────────────────────────────
function prepManual() {
  if (!usr) { toast('Select who is checking out!', 'yellow'); return; }
  const n = $('m_name').value.trim();
  if (!n) { toast('Equipment name required!', 'yellow'); return; }
  popV({
    name: n,
    type: $('m_type').value.trim(),
    serial: $('m_serial').value.trim(),
    barcode: $('m_barcode').value.trim(),
    notes: $('m_notes').value.trim(),
    confidence: null,
  }, false);
}
window.prepManual = prepManual;

// ── Verify card ───────────────────────────────────────────────
function popV(d, fromAI) {
  $('v_name').value = d.name || '';
  $('v_type').value = d.type || '';
  $('v_serial').value = d.serial || '';
  $('v_barcode').value = d.barcode || '';
  $('v_notes').value = d.notes || '';
  $('v_user').textContent = usr;
  $('v_dt').textContent = new Date().toLocaleString();
  const cw = $('confW');
  if (fromAI && d.confidence != null) {
    cw.classList.remove('hidden');
    $('cfill').style.width = d.confidence + '%';
    $('clbl').textContent =
      d.confidence + '% — ' +
      (d.confidence >= 80 ? 'High confidence'
        : d.confidence >= 50 ? 'Medium — double check'
        : 'Low — verify carefully');
  } else {
    cw.classList.add('hidden');
  }
  aiSource = fromAI;
  const vc = $('vcard');
  vc.classList.remove('hidden');
  setTimeout(() => vc.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}

function cancelV() { $('vcard').classList.add('hidden'); }
window.cancelV = cancelV;

async function confirmCO() {
  const name = $('v_name').value.trim();
  if (!name) { toast('Equipment name required!', 'yellow'); return; }
  const payload = {
    name,
    type: $('v_type').value.trim(),
    serial_number: $('v_serial').value.trim(),
    barcode: $('v_barcode').value.trim(),
    notes: [$('v_notes').value.trim(), usr ? `for: ${usr}` : ''].filter(Boolean).join(' · '),
  };
  const btn = $('confbtn');
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Saving...';
  try {
    // Two-step: create inventory item, then check it out.
    const { item } = await api('/api/equipment', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await api(`/api/equipment/${item.id}/checkout`, {
      method: 'POST',
      body: JSON.stringify({ notes: payload.notes, source: aiSource ? 'Scan' : 'Manual' }),
    });
    toast('Checked out!', 'green');
    $('vcard').classList.add('hidden');
    clearImg();
    ['m_name', 'm_type', 'm_serial', 'm_barcode', 'm_notes'].forEach((id) => ($(id).value = ''));
  } catch (err) {
    toast('Error: ' + err.message, 'red');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}
window.confirmCO = confirmCO;

// ── Check-in list ─────────────────────────────────────────────
async function loadCI() {
  const l = $('ciList');
  l.innerHTML = '<div class="sw"><div class="sp"></div><span>Loading...</span></div>';
  try {
    const { items } = await api('/api/equipment?status=checked_out');
    renderCI(items || []);
  } catch (e) {
    l.innerHTML = `<div class="es"><div class="et">${esc(e.message)}</div></div>`;
  }
}
window.loadCI = loadCI;

function renderCI(items) {
  const l = $('ciList');
  if (!items.length) {
    l.innerHTML = '<div class="es"><div class="ei">✅</div><div class="et">All equipment is checked in!</div></div>';
    return;
  }
  l.innerHTML = '';
  items.forEach((e) => {
    const row = document.createElement('div');
    row.className = 'ci';
    const info = document.createElement('div');
    info.className = 'cin';
    const name = document.createElement('div');
    name.className = 'cname';
    name.textContent = e.name;
    const meta = document.createElement('div');
    meta.className = 'cmeta';
    const bits = [];
    if (e.type) bits.push(e.type);
    if (e.serial_number) bits.push('S/N: ' + e.serial_number);
    if (e.barcode) bits.push('BC: ' + e.barcode);
    if (e.checked_out_username) bits.push(e.checked_out_username);
    if (e.checked_out_at) bits.push(new Date(e.checked_out_at).toLocaleString());
    meta.textContent = bits.join(' · ');
    info.appendChild(name);
    info.appendChild(meta);
    const btn = document.createElement('button');
    btn.className = 'btn bg bsm';
    btn.textContent = '📥 In';
    btn.addEventListener('click', () => doCI(e.id, e.name));
    row.appendChild(info);
    row.appendChild(btn);
    l.appendChild(row);
  });
}

async function doCI(id, name) {
  try {
    await api(`/api/equipment/${id}/checkin`, {
      method: 'POST',
      body: JSON.stringify({ source: 'Manual' }),
    });
    toast(`"${name}" checked in!`, 'green');
    await loadCI();
  } catch (e) {
    toast(e.message, 'red');
  }
}
window.doCI = doCI;

// ── Activity log ──────────────────────────────────────────────
async function loadLog() {
  const w = $('logW');
  w.innerHTML = '<div class="sw"><div class="sp"></div><span>Fetching...</span></div>';
  try {
    const { entries } = await api('/api/equipment/log');
    cacheLog = entries || [];
    if (!cacheLog.length) {
      w.innerHTML = '<div class="es"><div class="ei">📋</div><div class="et">No entries yet.</div></div>';
      return;
    }
    let html = '<div class="ls"><table><thead><tr><th>Action</th><th>Equipment</th><th>S/N · BC</th><th>User</th><th>When</th></tr></thead><tbody>';
    cacheLog.forEach((e) => {
      const badge = e.action === 'checkout'
        ? '<span class="badge bout">OUT</span>'
        : '<span class="badge bin">IN</span>';
      const sn = e.serial_number ? 'S/N: ' + esc(e.serial_number) : '<span style="color:var(--muted)">—</span>';
      html += `<tr>
        <td>${badge}</td>
        <td><strong>${esc(e.equipment_name || '')}</strong></td>
        <td class="mono small">${sn}</td>
        <td class="accent bold">${esc(e.checkout_user || '')}</td>
        <td class="mono small" style="color:var(--muted)">${esc(new Date(e.created_at).toLocaleString())}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    w.innerHTML = html;
  } catch (e) {
    w.innerHTML = `<div class="es"><div class="et">${esc(e.message)}</div></div>`;
  }
}
window.loadLog = loadLog;

// ═══════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════
function showOnly(id) {
  ['lf', 'cf', 'vf', 'fp'].forEach((x) => $(x).classList.toggle('hidden', x !== id));
}
function showLogin() { $('lo').classList.remove('hidden'); showOnly('lf'); }
function hideLogin() { $('lo').classList.add('hidden'); }
function showLoginForm() { showOnly('lf'); $('le').textContent = ''; }
window.showLoginForm = showLoginForm;

async function doLogin() {
  const u = $('lu').value.trim();
  const p = $('lp').value;
  $('le').textContent = 'Signing in...';
  try {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: u, password: p }),
    });
    if (res.challenge === 'MFA_REQUIRED') {
      showOnly('vf');
      $('le').textContent = '';
      setTimeout(() => $('mc2').focus(), 80);
      return;
    }
    ME = res.user;
    if (res.mustChangePw) {
      showOnly('cf');
      $('le').textContent = '';
      return;
    }
    await onAuthed();
  } catch (err) {
    $('le').textContent = err.message || 'Login failed';
  }
}
window.doLogin = doLogin;

async function doForceChg() {
  const np = $('np1').value, np2 = $('np2').value;
  if (np !== np2) { $('ce').textContent = 'Passwords do not match'; return; }
  try {
    // Send current password = same as used at login? We don't have it cached.
    // Simpler: prompt them to type it once.
    const current = $('lp').value;
    await api('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: current, newPassword: np }),
    });
    // Server invalidated all sessions — log in again with the new password.
    $('ce').textContent = 'Password updated — signing you back in...';
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('lu').value.trim(), password: np }),
    });
    const me = await api('/api/auth/me');
    ME = me.user;
    await onAuthed();
  } catch (err) {
    $('ce').textContent = err.message || 'Failed';
  }
}
window.doForceChg = doForceChg;

async function doMfaLoginVerify() {
  const code = $('mc2').value.trim();
  if (code.length !== 6) { $('me2').textContent = 'Enter a 6-digit code'; return; }
  $('me2').textContent = 'Verifying...';
  try {
    const res = await api('/api/auth/mfa-verify', {
      method: 'POST',
      body: JSON.stringify({ token: code }),
    });
    ME = res.user;
    if (res.mustChangePw) { showOnly('cf'); return; }
    await onAuthed();
  } catch (err) {
    $('me2').textContent = err.message || 'Invalid code';
  }
}
window.doMfaLoginVerify = doMfaLoginVerify;

function showForgot() { showOnly('fp'); $('fpMsg').textContent = ''; }
window.showForgot = showForgot;

async function doForgot() {
  const email = $('fpEmail').value.trim();
  if (!email) { $('fpMsg').textContent = 'Enter your email'; return; }
  $('fpMsg').textContent = 'Sending...';
  try {
    const res = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    $('fpMsg').style.color = 'var(--green)';
    $('fpMsg').textContent = res.message || 'If that email is registered, a reset link has been sent.';
  } catch (err) {
    $('fpMsg').textContent = err.message || 'Failed';
  }
}
window.doForgot = doForgot;

async function doLogout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  ME = null;
  $('gearDrop').classList.remove('on');
  showLogin();
}
window.doLogout = doLogout;

async function onAuthed() {
  hideLogin();
  $('curUser').textContent = ME.username;
  usr = ME.username;
  // Seed the chips with the current user + any existing chips
  const chips = $('chips');
  chips.innerHTML = '';
  const c = document.createElement('div');
  c.className = 'chip on';
  c.textContent = ME.username;
  c.addEventListener('click', () => selU(c, ME.username));
  chips.appendChild(c);
  // Toggle admin gear entry
  $('miAdmin').classList.toggle('on', ME.role === 'admin');
}

// ═══════════════════════════════════════════════════════════
// GEAR MENU
// ═══════════════════════════════════════════════════════════
function toggleGear() {
  const d = $('gearDrop');
  d.classList.toggle('on');
}
window.toggleGear = toggleGear;

document.addEventListener('click', (e) => {
  const gw = $('gearWrap');
  if (gw && !gw.contains(e.target)) $('gearDrop').classList.remove('on');
});

// ── Change password (signed-in user) ──
function showChp() {
  $('gearDrop').classList.remove('on');
  $('chpOv').classList.remove('hidden');
}
window.showChp = showChp;

function hideChp() {
  $('chpOv').classList.add('hidden');
  ['cpOld', 'cpN1', 'cpN2'].forEach((x) => ($(x).value = ''));
  $('cpErr').textContent = '';
}
window.hideChp = hideChp;

async function doChgPass() {
  const old = $('cpOld').value, np = $('cpN1').value, np2 = $('cpN2').value;
  if (np !== np2) { $('cpErr').textContent = 'Passwords do not match'; return; }
  try {
    await api('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: old, newPassword: np }),
    });
    hideChp();
    toast('Password changed — sign in again', 'green');
    ME = null;
    showLogin();
  } catch (err) {
    $('cpErr').textContent = err.message || 'Failed';
  }
}
window.doChgPass = doChgPass;

// ── MFA setup ──
async function showMfa() {
  $('gearDrop').classList.remove('on');
  $('mfaErr').textContent = 'Loading QR code...';
  $('mfaOv').classList.remove('hidden');
  try {
    const { qr, secret } = await api('/api/auth/mfa/setup', { method: 'POST' });
    $('mfaQr').src = qr;
    $('mfaSecret').textContent = secret;
    $('mfaErr').textContent = '';
  } catch (err) {
    $('mfaErr').textContent = err.message || 'Failed to start MFA setup';
  }
}
window.showMfa = showMfa;

function hideMfa() {
  $('mfaOv').classList.add('hidden');
  $('mfaCode').value = '';
  $('mfaErr').textContent = '';
}
window.hideMfa = hideMfa;

async function doMfaEnable() {
  const code = $('mfaCode').value.trim();
  if (code.length !== 6) { $('mfaErr').textContent = 'Enter a 6-digit code'; return; }
  try {
    await api('/api/auth/mfa/enable', {
      method: 'POST',
      body: JSON.stringify({ token: code }),
    });
    hideMfa();
    toast('MFA enabled', 'green');
  } catch (err) {
    $('mfaErr').textContent = err.message || 'Invalid code';
  }
}
window.doMfaEnable = doMfaEnable;

// ═══════════════════════════════════════════════════════════
// ADMIN PANEL
// ═══════════════════════════════════════════════════════════
function showAdmin() {
  $('gearDrop').classList.remove('on');
  $('adminOv').classList.remove('hidden');
  swAdmin('users');
}
window.showAdmin = showAdmin;

function hideAdmin() { $('adminOv').classList.add('hidden'); }
window.hideAdmin = hideAdmin;

function swAdmin(tab) {
  document.querySelectorAll('.admin-tab').forEach((t) =>
    t.classList.toggle('on', t.dataset.tab === tab));
  document.querySelectorAll('.admin-pane').forEach((p) =>
    p.classList.toggle('on', p.id === 'adm-' + tab));
  if (tab === 'users') loadAdminUsers();
  if (tab === 'overdue') loadOverdue();
  if (tab === 'audit') loadAudit();
}
window.swAdmin = swAdmin;

async function loadAdminUsers() {
  const ul = $('adminUL');
  ul.innerHTML = '<div class="es"><div class="et">Loading...</div></div>';
  try {
    const { users } = await api('/api/admin/users');
    if (!users.length) {
      ul.innerHTML = '<div class="es"><div class="et">No users.</div></div>';
      return;
    }
    ul.innerHTML = '';
    users.forEach((u) => {
      const row = document.createElement('div');
      row.className = 'user-row';
      row.addEventListener('click', () => showUserDetail(u.id));

      const main = document.createElement('div');
      main.className = 'user-main';
      const nm = document.createElement('div');
      nm.className = 'user-name';
      nm.textContent = u.username;
      const em = document.createElement('div');
      em.className = 'user-email';
      em.textContent = u.email || '';
      main.appendChild(nm);
      main.appendChild(em);

      const meta = document.createElement('div');
      meta.className = 'user-meta';
      if (u.role === 'admin') {
        const b = document.createElement('span');
        b.className = 'user-badge admin';
        b.textContent = 'ADMIN';
        meta.appendChild(b);
      }
      if (u.mfa_enabled) {
        const b = document.createElement('span');
        b.className = 'user-badge mfa';
        b.textContent = 'MFA';
        meta.appendChild(b);
      }
      if (u.locked_until && new Date(u.locked_until) > new Date()) {
        const b = document.createElement('span');
        b.className = 'user-badge locked';
        b.textContent = 'LOCKED';
        meta.appendChild(b);
      }

      row.appendChild(main);
      row.appendChild(meta);
      ul.appendChild(row);
    });
  } catch (e) {
    ul.innerHTML = `<div class="es"><div class="et">${esc(e.message)}</div></div>`;
  }
}

async function adminCreateUser() {
  const username = $('nuName').value.trim();
  const email = $('nuEmail').value.trim();
  const password = $('nuPass').value;
  const role = $('nuRole').value;
  if (!username || !email || !password) {
    $('nuErr').textContent = 'All fields required';
    return;
  }
  try {
    await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username, email, password, role }),
    });
    $('nuName').value = '';
    $('nuEmail').value = '';
    $('nuPass').value = '';
    $('nuErr').textContent = '';
    toast('User created', 'green');
    loadAdminUsers();
  } catch (err) {
    $('nuErr').textContent = err.message || 'Failed';
  }
}
window.adminCreateUser = adminCreateUser;

async function showUserDetail(id) {
  const card = $('userDetail');
  card.classList.remove('hidden');
  $('udName').textContent = 'Loading...';
  $('udBody').innerHTML = '';
  try {
    const { user, currentCheckouts, history } = await api('/api/admin/users/' + id);
    $('udName').textContent = user.username + (user.role === 'admin' ? ' (admin)' : '');

    const body = $('udBody');
    body.innerHTML = '';

    // Actions row
    const actions = document.createElement('div');
    actions.className = 'brow';

    const btnReset = document.createElement('button');
    btnReset.className = 'btn bw bsm';
    btnReset.textContent = 'Reset PW';
    btnReset.addEventListener('click', () => adminResetPw(user.id, user.username));
    actions.appendChild(btnReset);

    const btnRole = document.createElement('button');
    btnRole.className = 'btn bo bsm';
    btnRole.textContent = user.role === 'admin' ? 'Revoke Admin' : 'Make Admin';
    btnRole.addEventListener('click', () => adminToggleRole(user.id, user.role));
    actions.appendChild(btnRole);

    if (user.locked_until) {
      const btnUnlock = document.createElement('button');
      btnUnlock.className = 'btn bg bsm';
      btnUnlock.textContent = 'Unlock';
      btnUnlock.addEventListener('click', () => adminUnlock(user.id));
      actions.appendChild(btnUnlock);
    }

    if (ME && user.id !== ME.id) {
      const btnDel = document.createElement('button');
      btnDel.className = 'btn br bsm';
      btnDel.textContent = '🗑 Delete';
      btnDel.addEventListener('click', () => {
        if (confirm('Permanently delete ' + user.username + '?')) adminDeleteUser(user.id);
      });
      actions.appendChild(btnDel);
    }
    body.appendChild(actions);

    // Current checkouts
    const h1 = document.createElement('div');
    h1.className = 'ctitle';
    h1.textContent = 'Currently Checked Out';
    body.appendChild(h1);

    if (!currentCheckouts || !currentCheckouts.length) {
      const e = document.createElement('div');
      e.className = 'es';
      e.innerHTML = '<div class="et">No items</div>';
      body.appendChild(e);
    } else {
      currentCheckouts.forEach((e) => {
        const row = document.createElement('div');
        row.className = 'overdue-row';
        const days = e.checked_out_at
          ? Math.floor((Date.now() - new Date(e.checked_out_at).getTime()) / 86400000)
          : 0;
        if (days >= 5) row.classList.add('alert');
        else if (days >= 3) row.classList.add('warn');
        const nm = document.createElement('div');
        nm.className = 'cname';
        nm.textContent = e.name;
        const meta = document.createElement('div');
        meta.className = 'overdue-days';
        meta.textContent = `${days} day${days === 1 ? '' : 's'} · ${new Date(e.checked_out_at).toLocaleDateString()}`;
        row.appendChild(nm);
        row.appendChild(meta);
        body.appendChild(row);
      });
    }

    // History
    const h2 = document.createElement('div');
    h2.className = 'ctitle';
    h2.style.marginTop = '1rem';
    h2.textContent = 'Recent Activity';
    body.appendChild(h2);

    if (!history || !history.length) {
      const e = document.createElement('div');
      e.className = 'es';
      e.innerHTML = '<div class="et">No activity</div>';
      body.appendChild(e);
    } else {
      history.slice(0, 20).forEach((h) => {
        const row = document.createElement('div');
        row.className = 'audit-row';
        const left = document.createElement('div');
        left.innerHTML = `<strong>${esc(h.action)}</strong> — ${esc(h.equipment_name || '')}`;
        const right = document.createElement('div');
        right.className = 'audit-when';
        right.textContent = new Date(h.created_at).toLocaleString();
        row.appendChild(left);
        row.appendChild(right);
        body.appendChild(row);
      });
    }
  } catch (err) {
    $('udBody').innerHTML = `<div class="es"><div class="et">${esc(err.message)}</div></div>`;
  }
}
window.showUserDetail = showUserDetail;

function hideUserDetail() { $('userDetail').classList.add('hidden'); }
window.hideUserDetail = hideUserDetail;

async function adminResetPw(id, username) {
  const np = prompt('New temporary password for ' + username + ' (min 10 chars, upper/lower/digit/special):');
  if (!np) return;
  try {
    await api('/api/admin/users/' + id, {
      method: 'PUT',
      body: JSON.stringify({ reset_password: np }),
    });
    toast('Password reset', 'green');
  } catch (err) {
    toast(err.message, 'red');
  }
}

async function adminToggleRole(id, currentRole) {
  const newRole = currentRole === 'admin' ? 'user' : 'admin';
  try {
    await api('/api/admin/users/' + id, {
      method: 'PUT',
      body: JSON.stringify({ role: newRole }),
    });
    toast('Role updated', 'green');
    showUserDetail(id);
    loadAdminUsers();
  } catch (err) {
    toast(err.message, 'red');
  }
}

async function adminUnlock(id) {
  try {
    await api('/api/admin/users/' + id, {
      method: 'PUT',
      body: JSON.stringify({ unlock: true }),
    });
    toast('Unlocked', 'green');
    showUserDetail(id);
  } catch (err) {
    toast(err.message, 'red');
  }
}

async function adminDeleteUser(id) {
  try {
    await api('/api/admin/users/' + id, { method: 'DELETE' });
    toast('User deleted', 'green');
    hideUserDetail();
    loadAdminUsers();
  } catch (err) {
    toast(err.message, 'red');
  }
}

async function loadOverdue() {
  const el = $('overdueList');
  el.innerHTML = '<div class="es"><div class="et">Loading...</div></div>';
  try {
    const { items } = await api('/api/admin/overdue?days=1');
    if (!items.length) {
      el.innerHTML = '<div class="es"><div class="ei">✅</div><div class="et">No overdue items!</div></div>';
      return;
    }
    el.innerHTML = '';
    items.forEach((i) => {
      const days = i.checked_out_at
        ? Math.floor((Date.now() - new Date(i.checked_out_at).getTime()) / 86400000)
        : 0;
      const row = document.createElement('div');
      row.className = 'overdue-row';
      if (days >= 5) row.classList.add('alert');
      else if (days >= 3) row.classList.add('warn');
      const name = document.createElement('div');
      name.className = 'cname';
      name.textContent = i.name;
      const meta = document.createElement('div');
      meta.className = 'overdue-days';
      meta.textContent = `${days} days · ${i.checked_out_username || ''} · ${new Date(i.checked_out_at).toLocaleDateString()}`;
      row.appendChild(name);
      row.appendChild(meta);
      el.appendChild(row);
    });
  } catch (err) {
    el.innerHTML = `<div class="es"><div class="et">${esc(err.message)}</div></div>`;
  }
}

async function loadAudit() {
  const el = $('auditList');
  el.innerHTML = '<div class="es"><div class="et">Loading...</div></div>';
  try {
    const { entries } = await api('/api/admin/audit?limit=100');
    if (!entries.length) {
      el.innerHTML = '<div class="es"><div class="et">No audit entries.</div></div>';
      return;
    }
    el.innerHTML = '';
    entries.forEach((e) => {
      const row = document.createElement('div');
      row.className = 'audit-row';
      const left = document.createElement('div');
      left.innerHTML = `<strong class="accent">${esc(e.action)}</strong> · ${esc(e.target || '')}`;
      const right = document.createElement('div');
      right.className = 'audit-when';
      right.textContent = new Date(e.created_at).toLocaleString();
      row.appendChild(left);
      row.appendChild(right);
      el.appendChild(row);
    });
  } catch (err) {
    el.innerHTML = `<div class="es"><div class="et">${esc(err.message)}</div></div>`;
  }
}

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
(async function boot() {
  // Enter key on login form
  $('lp').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('mc2').addEventListener('keydown', (e) => { if (e.key === 'Enter') doMfaLoginVerify(); });
  $('np2').addEventListener('keydown', (e) => { if (e.key === 'Enter') doForceChg(); });
  $('nuInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addU(); });

  try {
    const me = await api('/api/auth/me');
    if (me && me.user) {
      ME = me.user;
      await onAuthed();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
})();
