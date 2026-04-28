'use strict';
// ═══════════════════════════════════════════════════════════════════════
// CISTracker v2 — Sidebar UI, Queue, Tickets
// ═══════════════════════════════════════════════════════════════════════

let ME = null;           // current user
let ITEMS = [];          // all equipment
let CSRF = '';           // CSRF token
let currentView = 'inventory';
let statusFilter = 'all';
let catFilter = 'All';
let locFilter = 'All';
let ticketFilter = 'all';
let _pendingPrint = null; // label queued for printing from add-item modal

// ── UTC helper ─────────────────────────────────────────────────────────
function utc(d) {
  if (!d) return new Date(NaN);
  const s = String(d).trim();
  if (/[Zz+\-]\d{2}:?\d{2}$/.test(s) || s.endsWith('Z')) return new Date(s);
  return new Date(s.replace(' ', 'T') + 'Z');
}
function fmtDate(d) {
  const dt = utc(d);
  if (isNaN(dt)) return '—';
  return dt.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}
function fmtDateTime(d) {
  const dt = utc(d);
  if (isNaN(dt)) return '—';
  return dt.toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}
function daysAgo(d) {
  const dt = utc(d);
  if (isNaN(dt)) return 0;
  return Math.floor((Date.now() - dt.getTime()) / 86400000);
}

// ── API helper ─────────────────────────────────────────────────────────
async function api(url, opts = {}) {
  const headers = { ...opts.headers };
  if (opts.body && typeof opts.body === 'object') {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  if (CSRF) headers['x-csrf-token'] = CSRF;
  const res = await fetch(url, { ...opts, headers, credentials: 'same-origin' });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  // Grab CSRF from response cookie
  const csrfCookie = document.cookie.split(';').find(c => c.trim().startsWith('csrf_token='));
  if (csrfCookie) CSRF = csrfCookie.split('=')[1];
  if (!res.ok) throw { status: res.status, ...(typeof data === 'object' ? data : { error: data }) };
  return data;
}

// ── Toast ──────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 3500);
}

// ── Init ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Login form
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('changePwForm').addEventListener('submit', handleChangePw);
  // Check session
  try {
    const { user } = await api('/api/auth/me');
    if (user) {
      ME = user;
      if (user.mustChangePw) { showChangePw(); return; }
      showApp();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
});

// ── Auth ───────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('loginPage').classList.remove('hidden');
  document.getElementById('changePwPage').classList.add('hidden');
  document.getElementById('appLayout').classList.add('hidden');
}
function showChangePw() {
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('changePwPage').classList.remove('hidden');
  document.getElementById('appLayout').classList.add('hidden');
}

let mfaPending = false;
async function handleLogin(e) {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.style.display = 'none';
  try {
    const body = { username: document.getElementById('loginUser').value, password: document.getElementById('loginPass').value };
    if (mfaPending) body.token = document.getElementById('loginMfa').value;
    const endpoint = mfaPending ? '/api/auth/mfa-verify' : '/api/auth/login';
    const data = await api(endpoint, { method: 'POST', body });
    if (data.challenge === 'MFA_REQUIRED') {
      mfaPending = true;
      document.getElementById('mfaGroup').classList.remove('hidden');
      document.getElementById('loginMfa').focus();
      return;
    }
    ME = data.user;
    mfaPending = false;
    if (data.mustChangePw) { showChangePw(); return; }
    showApp();
  } catch (err) {
    errEl.textContent = err.error || 'Login failed';
    errEl.style.display = 'block';
  }
}

async function handleChangePw(e) {
  e.preventDefault();
  const errEl = document.getElementById('changePwError');
  errEl.style.display = 'none';
  const newPw = document.getElementById('cpNew').value;
  if (newPw !== document.getElementById('cpConfirm').value) {
    errEl.textContent = 'Passwords do not match';
    errEl.style.display = 'block';
    return;
  }
  try {
    await api('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword: document.getElementById('cpCurrent').value, newPassword: newPw },
    });
    toast('Password changed! Please log in again.', 'success');
    showLogin();
  } catch (err) {
    errEl.textContent = err.error || 'Failed to change password';
    errEl.style.display = 'block';
  }
}

async function doLogout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  ME = null;
  showLogin();
}

// ── App init ───────────────────────────────────────────────────────────
async function showApp() {
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('changePwPage').classList.add('hidden');
  document.getElementById('appLayout').classList.remove('hidden');
  // Set user info in sidebar
  document.getElementById('userName').textContent = ME.username;
  document.getElementById('userRole').textContent = ME.role;
  document.getElementById('userAvatar').textContent = ME.username[0].toUpperCase();
  // Admin features
  if (ME.role === 'admin') {
    document.getElementById('adminNav').style.display = '';
    document.getElementById('addItemBtn').style.display = '';
  }
  // Load data
  await Promise.all([loadItems(), loadOverdueCount(), loadTicketCounts()]);
  switchView('inventory');
}

// ── View switching ─────────────────────────────────────────────────────
function switchView(view) {
  // Stop any active QR scan when leaving the checkinout view
  if (view !== 'checkinout' && window._stopScan) { window._stopScan(); window._stopScan = null; }
  currentView = view;
  // Hide all views
  document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById('view-' + view);
  if (target) target.classList.remove('hidden');
  // Update nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  // Close mobile sidebar
  closeMobileSidebar();
  // Load view data
  if (view === 'inventory') loadItems();
  if (view === 'checkinout') loadCheckinout();
  if (view === 'overdue') loadOverdue();
  if (view === 'tickets') loadTickets();
  if (view === 'users') loadUsers();
  if (view === 'audit') loadAudit();
}

function toggleMobileSidebar() {
  const open = document.getElementById('sidebar').classList.toggle('mobile-open');
  document.getElementById('sidebarBackdrop').classList.toggle('visible', open);
}
function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebarBackdrop').classList.remove('visible');
}

// ═══════════════════════════════════════════════════════════════════════
//  INVENTORY
// ═══════════════════════════════════════════════════════════════════════

async function loadItems() {
  try {
    const data = await api('/api/equipment');
    ITEMS = data.items || [];
    buildCatChips();
    buildLocChips();
    renderItems();
  } catch (err) {
    console.error('Failed to load items', err);
  }
}

function computeStats(items) {
  items = items || ITEMS;
  let available = 0, out = 0, overdue = 0;
  for (const item of items) {
    const st = getItemStatus(item);
    if (st === 'available') available++;
    else if (st === 'overdue') overdue++;
    else if (st === 'checked_out') out++;
  }
  document.getElementById('statTotal').textContent = items.length;
  document.getElementById('statAvailable').textContent = available;
  document.getElementById('statOut').textContent = out;
  document.getElementById('statOverdue').textContent = overdue;
}

function buildCatChips() {
  const cats = new Set(['All']);
  for (const item of ITEMS) if (item.category) cats.add(item.category);
  const container = document.getElementById('catChips');
  container.innerHTML = '';
  for (const c of cats) {
    const chip = document.createElement('div');
    chip.className = 'chip' + (c === catFilter ? ' active' : '');
    chip.textContent = c;
    chip.onclick = () => { catFilter = c; buildCatChips(); renderItems(); };
    container.appendChild(chip);
  }
}

function buildLocChips() {
  const locs = new Set(['All']);
  for (const item of ITEMS) if (item.location) locs.add(item.location);
  const container = document.getElementById('locChips');
  container.innerHTML = '';
  if (locs.size <= 1) return; // no locations set, hide the row
  for (const l of locs) {
    const chip = document.createElement('div');
    chip.className = 'chip' + (l === locFilter ? ' active' : '');
    chip.textContent = l;
    chip.onclick = () => { locFilter = l; buildLocChips(); renderItems(); };
    container.appendChild(chip);
  }
}

function getItemStatus(item) {
  if (item.status === 'available') return 'available';
  if (item.status === 'checked_out') {
    if (item.due_date) {
      // due_date is YYYY-MM-DD UTC — treat end of that day as deadline
      const due = new Date(item.due_date + 'T23:59:59Z');
      if (Date.now() > due.getTime()) return 'overdue';
    } else if (daysAgo(item.checked_out_at) >= 3) {
      return 'overdue';
    }
  }
  return item.status === 'checked_out' ? 'checked_out' : item.status;
}

function fmtDue(due_date) {
  if (!due_date) return '';
  const d = new Date(due_date + 'T12:00:00Z');
  return 'due ' + d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
}

function setStatusFilter(s) {
  statusFilter = s;
  document.querySelectorAll('#statusChips .chip').forEach(el => {
    el.classList.toggle('active', el.dataset.status === s);
  });
  renderItems();
}

function filterItems() { renderItems(); }

function renderItems() {
  const q = (document.getElementById('searchInput').value || '').toLowerCase();
  const tbody = document.getElementById('itemsBody');
  tbody.innerHTML = '';
  let count = 0;
  const visible = [];
  for (const item of ITEMS) {
    const st = getItemStatus(item);
    // Status filter
    if (statusFilter !== 'all' && st !== statusFilter) continue;
    // Category filter
    if (catFilter !== 'All' && item.category !== catFilter) continue;
    // Location filter
    if (locFilter !== 'All' && item.location !== locFilter) continue;
    // Search
    if (q) {
      const hay = `${item.name} ${item.barcode} ${item.serial_number} ${item.category} ${item.type} ${item.location}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    visible.push(item);
    count++;
    const tr = document.createElement('tr');
    tr.onclick = () => openDetail(item.id);
    const statusLabel = st === 'available' ? 'Available' : st === 'checked_out' ? 'Checked Out' : 'Overdue';
    let subLine = '';
    if (st !== 'available' && item.checked_out_username) {
      const due = item.due_date ? fmtDue(item.due_date) : fmtDate(item.checked_out_at);
      subLine = `<div class="cell-sub">— ${esc(item.checked_out_username)} · <span style="color:${st==='overdue'?'var(--red)':'var(--text-muted)'}">${due}</span></div>`;
    }
    let queueLine = '';
    if (item.queue_length > 0) {
      queueLine = `<div class="cell-queue">⏳ ${item.queue_length} in queue</div>`;
    }
    tr.innerHTML = `
      <td class="cell-id">${esc(item.barcode || 'CIS-' + String(item.id).padStart(6,'0'))}</td>
      <td><div class="cell-name">${esc(item.name)}</div>${subLine}${queueLine}</td>
      <td>${esc(item.category || '—')}</td>
      <td>${esc(item.location || '—')}</td>
      <td><span class="status-badge status-${st}"><span class="dot"></span>${statusLabel}</span></td>
      <td>
        ${st === 'available'
          ? `<button class="btn-outline btn-sm" onclick="event.stopPropagation();openCheckoutModal(${item.id})">Check Out</button>`
          : `<button class="btn-outline btn-sm btn-green" onclick="event.stopPropagation();openReturnModal(${item.id})">Return</button>`}
      </td>
    `;
    tbody.appendChild(tr);
  }
  document.getElementById('itemCount').textContent = `${count} item${count !== 1 ? 's' : ''}`;
  computeStats(visible);
}

// ── Detail panel ───────────────────────────────────────────────────────
async function openDetail(id) {
  const item = ITEMS.find(i => i.id === id);
  if (!item) return;
  const st = getItemStatus(item);
  const panel = document.getElementById('detailPanel');
  // Load queue
  let queueHtml = '';
  try {
    const { queue } = await api(`/api/queue/${id}`);
    if (queue && queue.length > 0) {
      queueHtml = `
        <div class="queue-section">
          <div class="queue-header">
            <h4>Waitlist (${queue.length})</h4>
            ${st !== 'available' ? `<button class="btn-outline btn-sm btn-purple" onclick="joinQueue(${id})">Join Queue</button>` : ''}
          </div>
          <div class="queue-list">
            ${queue.map((q, i) => `
              <div class="queue-item">
                <div class="queue-pos">${i + 1}</div>
                <span>${esc(q.username)}</span>
                ${i === 0 ? '<span class="next-badge">Next up</span>' : ''}
                ${ME.role === 'admin' ? `<button class="btn-outline btn-sm btn-red" style="margin-left:auto" onclick="removeFromQueue(${id},${q.user_id})">✕</button>` : ''}
              </div>
            `).join('')}
          </div>
        </div>`;
    } else if (st !== 'available') {
      queueHtml = `
        <div class="queue-section">
          <div class="queue-header">
            <h4>Waitlist (0)</h4>
            <button class="btn-outline btn-sm btn-purple" onclick="joinQueue(${id})">Join Queue</button>
          </div>
          <p style="font-size:12px;color:var(--text-muted)">No one in queue</p>
        </div>`;
    }
  } catch {}
  // Load history
  let historyHtml = '';
  try {
    const { entries } = await api(`/api/equipment/log?limit=10`);
    const itemEntries = (entries || []).filter(e => e.equipment_id === id);
    if (itemEntries.length > 0) {
      historyHtml = `
        <div class="detail-section">
          <h4>History</h4>
          ${itemEntries.map(e => `
            <div class="history-item">
              <div class="history-dot ${e.action}"></div>
              <div>
                <div class="history-text">${e.action === 'checkout' ? 'Checked out' : 'Returned'} by ${esc(e.checkout_user)}</div>
                <div class="history-date">${fmtDateTime(e.created_at)}</div>
              </div>
            </div>
          `).join('')}
        </div>`;
    }
  } catch {}

  panel.innerHTML = `
    <div class="detail-header">
      <div>
        <span class="status-badge status-${st}"><span class="dot"></span>${st === 'available' ? 'Available' : st === 'checked_out' ? 'Checked Out' : 'Overdue'}</span>
        <div class="detail-name" style="margin-top:8px">${esc(item.name)}</div>
        <div class="detail-id">${esc(item.barcode || 'ID-' + item.id)}</div>
      </div>
      <button class="close-btn" onclick="closeDetail()">✕</button>
    </div>
    <div class="detail-section">
      <h4>Details</h4>
      <div class="meta-row"><span class="label">Serial</span><span class="value" style="font-family:var(--mono);font-size:12px">${esc(item.serial_number || '—')}</span></div>
      <div class="meta-row"><span class="label">Category</span><span class="value">${esc(item.category || '—')}</span></div>
      <div class="meta-row"><span class="label">Type</span><span class="value">${esc(item.type || '—')}</span></div>
      <div class="meta-row"><span class="label">Location</span><span class="value">${esc(item.location || '—')}</span></div>
      ${st !== 'available' ? `
        <div class="meta-row"><span class="label">Borrower</span><span class="value" style="color:${st === 'overdue' ? 'var(--red)' : 'var(--amber)'}">${esc(item.checked_out_username || '—')}</span></div>
        <div class="meta-row"><span class="label">Checked Out</span><span class="value">${fmtDate(item.checked_out_at)}</span></div>
        <div class="meta-row"><span class="label">Due</span><span class="value" style="color:${st==='overdue'?'var(--red)':'var(--text)'}">${item.due_date ? fmtDue(item.due_date) : '—'}</span></div>
      ` : ''}
    </div>
    <div class="detail-action">
      ${st === 'available'
        ? `<button class="btn-primary" onclick="openCheckoutModal(${id})">Check Out This Item</button>`
        : `<button class="btn-outline btn-green" style="width:100%;justify-content:center" onclick="openReturnModal(${id})">Return This Item</button>`}
    </div>
    ${queueHtml}
    ${historyHtml}
    ${ME.role === 'admin' ? `
      <div class="detail-section">
        <h4>Admin</h4>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn-outline btn-sm" onclick="editItem(${id})">Edit</button>
          <button class="btn-outline btn-sm" onclick="printLabel(${id})">Print Label</button>
          <button class="btn-outline btn-sm btn-red" onclick="deleteItem(${id})">Delete</button>
        </div>
      </div>
    ` : ''}
  `;
  document.getElementById('detailOverlay').classList.add('open');
}

function closeDetail() {
  document.getElementById('detailOverlay').classList.remove('open');
}

// ── Queue actions ──────────────────────────────────────────────────────
async function joinQueue(equipmentId) {
  try {
    const { position } = await api(`/api/queue/${equipmentId}/join`, { method: 'POST' });
    toast(`Joined queue at position #${position}`, 'purple');
    openDetail(equipmentId); // refresh
  } catch (err) {
    toast(err.error || 'Failed to join queue', 'error');
  }
}

async function removeFromQueue(equipmentId, userId) {
  try {
    await api(`/api/queue/${equipmentId}/user/${userId}`, { method: 'DELETE' });
    toast('Removed from queue', 'info');
    openDetail(equipmentId);
  } catch (err) {
    toast(err.error || 'Failed', 'error');
  }
}

// ── Checkout modal ─────────────────────────────────────────────────────
function openCheckoutModal(id) {
  const item = ITEMS.find(i => i.id === id);
  if (!item) return;
  const modal = document.getElementById('modalContent');
  const isAdmin = ME.role === 'admin';
  // Default due date label
  const defaultDays = 7;
  const defaultDue = new Date(); defaultDue.setDate(defaultDue.getDate() + defaultDays);
  const defaultDueStr = defaultDue.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
      <span style="font-size:10px;font-weight:600;letter-spacing:.08em;color:var(--text-muted);text-transform:uppercase">Checkout</span>
      <button style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;line-height:1" onclick="closeModal()">×</button>
    </div>
    <div class="modal-name">${esc(item.name)}</div>
    <div class="modal-id" style="margin-bottom:16px">${esc(item.barcode || 'ID-' + item.id)}</div>
    <div class="modal-body" id="coStep1">
      <div class="form-group">
        <label>Borrower Name</label>
        ${isAdmin ? `
          <select id="coBorrower" style="width:100%;padding:10px 12px;border-radius:9px;background:var(--bg-base);border:1px solid var(--border-input);color:var(--text);font-size:13px">
            <option value="">Loading users...</option>
          </select>
        ` : `
          <input type="text" value="${esc(ME.username)}" disabled style="width:100%;padding:10px 12px;border-radius:9px;background:var(--bg-surface);border:1px solid var(--border-input);color:var(--text-sec);font-size:13px">
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">You can only check out items to your own account.</div>
        `}
      </div>
      <div class="form-group">
        <label id="durationLabel">Duration — ${defaultDays} days (due ${defaultDueStr})</label>
        <input id="coDuration" type="range" min="1" max="30" value="${defaultDays}"
          style="width:100%;accent-color:var(--accent);cursor:pointer;margin:6px 0"
          oninput="updateDurationLabel(this.value)">
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-top:2px">
          <span>1d</span><span>7d</span><span>14d</span><span>30d</span>
        </div>
      </div>
      <div class="form-actions">
        <button class="btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="confirmCheckout(${id})">Continue →</button>
      </div>
    </div>
    <div id="coSuccess" class="hidden" style="text-align:center;padding:24px 0">
      <div class="success-icon">✓</div>
      <div style="font-size:17px;font-weight:600">Checked Out!</div>
      <div style="font-size:13px;color:var(--text-muted);margin-top:6px">${esc(item.name)}</div>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('open');
  if (isAdmin) loadUserSelect();
}

function updateDurationLabel(days) {
  days = parseInt(days, 10);
  const due = new Date();
  due.setDate(due.getDate() + days);
  const dueStr = due.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  const el = document.getElementById('durationLabel');
  if (el) el.textContent = `Duration — ${days} day${days !== 1 ? 's' : ''} (due ${dueStr})`;
}

async function loadUserSelect() {
  try {
    const { users } = await api('/api/admin/users');
    const sel = document.getElementById('coBorrower');
    if (!sel) return;
    if (!users || users.length === 0) {
      sel.innerHTML = '<option value="">No users found</option>';
      return;
    }
    sel.innerHTML = users.map(u => `<option value="${u.id}">${esc(u.username)} (${u.role})</option>`).join('');
  } catch (err) {
    const sel = document.getElementById('coBorrower');
    if (sel) sel.innerHTML = '<option value="">Failed to load users</option>';
    toast('Could not load user list: ' + (err.error || err.message || 'unknown error'), 'error');
  }
}

async function confirmCheckout(id) {
  try {
    const days = parseInt(document.getElementById('coDuration')?.value || '7', 10);
    const body = { source: 'Manual', duration_days: days };
    if (ME.role === 'admin') {
      const sel = document.getElementById('coBorrower');
      if (sel && sel.value) body.for_user_id = parseInt(sel.value, 10);
    }
    await api(`/api/equipment/${id}/checkout`, { method: 'POST', body });
    document.getElementById('coStep1').classList.add('hidden');
    document.getElementById('coSuccess').classList.remove('hidden');
    setTimeout(() => { closeModal(); loadItems(); closeDetail(); }, 1400);
  } catch (err) {
    toast(err.error || 'Checkout failed', 'error');
  }
}

// ── Return modal ───────────────────────────────────────────────────────
function openReturnModal(id) {
  const item = ITEMS.find(i => i.id === id);
  if (!item) return;
  const modal = document.getElementById('modalContent');
  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div class="modal-title">Quick Return</div>
        <div class="modal-name">${esc(item.name)}</div>
        <div class="modal-id">${esc(item.barcode || 'ID-' + item.id)}</div>
      </div>
      <button style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="summary-card">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Currently checked out by</div>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="avatar" style="width:32px;height:32px;font-size:13px">${(item.checked_out_username || '?')[0].toUpperCase()}</div>
          <div>
            <div style="font-size:14px;font-weight:500">${esc(item.checked_out_username || '?')}</div>
            <div style="font-size:11px;color:var(--text-muted)">Since ${fmtDate(item.checked_out_at)}</div>
          </div>
        </div>
      </div>
      ${item.queue_length > 0 ? `<div class="info-strip" style="background:var(--purple-soft);border-color:rgba(167,139,250,0.2);color:var(--purple)">📣 ${item.queue_length} person(s) in queue — next will be notified</div>` : ''}
      <div class="form-actions">
        <button class="btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn-outline btn-green" style="flex:2" onclick="confirmReturn(${id})">Confirm Return</button>
      </div>
    </div>
    <div id="retSuccess" class="hidden" style="text-align:center;padding:24px 0">
      <div class="success-icon">✓</div>
      <div style="font-size:17px;font-weight:600">Returned!</div>
      <div style="font-size:13px;color:var(--text-muted);margin-top:6px">${esc(item.name)}</div>
      <div id="retQueueMsg" class="hidden" style="margin-top:8px;font-size:13px;color:var(--purple)"></div>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('open');
}

async function confirmReturn(id) {
  try {
    const data = await api(`/api/equipment/${id}/checkin`, { method: 'POST', body: { source: 'Manual' } });
    document.querySelector('.modal-body').classList.add('hidden');
    document.getElementById('retSuccess').classList.remove('hidden');
    if (data.nextInQueue) {
      const msgEl = document.getElementById('retQueueMsg');
      msgEl.textContent = `📣 ${data.nextInQueue.username} has been notified!`;
      msgEl.classList.remove('hidden');
      toast(`📣 Next up: ${data.nextInQueue.username} has been notified`, 'purple');
    }
    setTimeout(() => { closeModal(); loadItems(); closeDetail(); }, 1800);
  } catch (err) {
    toast(err.error || 'Return failed', 'error');
  }
}

// ── Add item modal ─────────────────────────────────────────────────────
async function openAddItemModal() {
  let nextId = '';
  try { const d = await api('/api/equipment/next-asset-id'); nextId = d.asset_id; } catch {}
  const modal = document.getElementById('modalContent');
  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div class="modal-title">Add New Item</div>
      <span style="font-family:var(--mono);font-size:12px;color:var(--accent);background:var(--accent-soft);padding:4px 10px;border-radius:6px">${esc(nextId)}</span>
    </div>
    <input type="hidden" id="addBarcode" value="${esc(nextId)}">
    <div class="modal-body" id="addStep1">
      <div class="form-group"><label>Item Name *</label><input id="addName" required></div>
      <div class="form-group"><label>Category</label>
        <select id="addCat" style="width:100%;padding:10px 12px;border-radius:9px;background:var(--bg-base);border:1px solid var(--border-input);color:var(--text);font-size:13px">
          <option value="">Select…</option>
          <option>Computers</option><option>Components</option><option>GPUs</option>
          <option>Networking</option><option>Peripherals</option><option>Cables</option>
          <option>Storage</option><option>Cases</option><option>Adapters</option>
          <option>PSU Cables</option><option>Infrastructure</option><option>Tools</option>
          <option>Books</option><option>Other</option>
        </select>
      </div>
      <div class="form-group"><label>Location</label><input id="addLoc" placeholder="e.g. Shelf A1"></div>
      <div class="form-group"><label>Serial / Asset Number</label><input id="addSerial" class="mono" placeholder="Optional"></div>
      <div class="form-group"><label>Notes</label><textarea id="addNotes" rows="2"></textarea></div>
      <div class="info-strip">A QR label will be ready to print after creation.</div>
      <div class="form-actions">
        <button class="btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="submitAddItem()">Create & Print Label →</button>
      </div>
    </div>
    <div id="addStep2" class="hidden"></div>
  `;
  document.getElementById('modalOverlay').classList.add('open');
}

async function submitAddItem() {
  const name = document.getElementById('addName').value.trim();
  if (!name) { toast('Item name is required', 'error'); return; }
  try {
    const body = {
      name,
      barcode: document.getElementById('addBarcode').value.trim(),
      category: document.getElementById('addCat').value,
      location: document.getElementById('addLoc').value.trim(),
      serial_number: document.getElementById('addSerial').value.trim(),
      notes: document.getElementById('addNotes').value.trim(),
    };
    const { item } = await api('/api/equipment', { method: 'POST', body });
    toast('Item created!', 'success');
    // Show label step
    try {
      const label = await api(`/api/equipment/${item.id}/label`);
      _pendingPrint = { label, name: item.name, category: item.category || '', serial: item.serial_number || '' };
      document.getElementById('addStep1').classList.add('hidden');
      const step2 = document.getElementById('addStep2');
      step2.classList.remove('hidden');
      step2.innerHTML = `
        <div class="success-icon" style="margin-bottom:12px">✓</div>
        <div style="text-align:center;font-size:15px;font-weight:600;margin-bottom:16px">Item Created</div>
        <div class="label-preview">
          <img class="qr-img" src="${label.qr_data_url}" alt="QR Code">
          <div class="label-info">
            <div style="font-size:9px;color:#888;text-transform:uppercase">CISTracker</div>
            <div style="font-weight:600;margin:2px 0">${esc(item.name)}</div>
            <div class="label-id">${esc(label.asset_id)}</div>
            <div style="font-size:10px;color:#666;margin-top:2px">${esc(item.category || '')} ${item.serial_number ? '· ' + item.serial_number : ''}</div>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn-outline" onclick="closeModal();loadItems()">Skip</button>
          <button class="btn-primary" onclick="printPendingLabel()">🖨 Print Label</button>
        </div>
      `;
    } catch (labelErr) {
      toast('Item created but label failed to load', 'info');
      closeModal();
    }
    loadItems();
  } catch (err) {
    toast(err.error || 'Failed to create item', 'error');
  }
}

// ── Edit / Delete / Print ──────────────────────────────────────────────
async function editItem(id) {
  const item = ITEMS.find(i => i.id === id);
  if (!item) return;
  closeDetail();
  const modal = document.getElementById('modalContent');
  modal.innerHTML = `
    <div class="modal-title">Edit Item</div>
    <div class="modal-name">${esc(item.name)}</div>
    <div class="modal-body">
      <div class="form-group"><label>Name</label><input id="editName" value="${esc(item.name)}"></div>
      <div class="form-group"><label>Category</label><input id="editCat" value="${esc(item.category || '')}"></div>
      <div class="form-group"><label>Location</label><input id="editLoc" value="${esc(item.location || '')}" placeholder="e.g. Shelf A1"></div>
      <div class="form-group"><label>Serial Number</label><input id="editSerial" class="mono" value="${esc(item.serial_number || '')}"></div>
      <div class="form-group"><label>Barcode</label><input id="editBarcode" class="mono" value="${esc(item.barcode || '')}"></div>
      <div class="form-group"><label>Notes</label><textarea id="editNotes" rows="2">${esc(item.notes || '')}</textarea></div>
      <div class="form-actions">
        <button class="btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="submitEdit(${id})">Save</button>
      </div>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('open');
}

async function submitEdit(id) {
  try {
    await api(`/api/equipment/${id}`, {
      method: 'PUT',
      body: {
        name: document.getElementById('editName').value,
        category: document.getElementById('editCat').value,
        location: document.getElementById('editLoc').value,
        serial_number: document.getElementById('editSerial').value,
        barcode: document.getElementById('editBarcode').value,
        notes: document.getElementById('editNotes').value,
      },
    });
    toast('Item updated', 'success');
    closeModal();
    loadItems();
  } catch (err) {
    toast(err.error || 'Update failed', 'error');
  }
}

async function deleteItem(id) {
  if (!confirm('Delete this item?')) return;
  try {
    await api(`/api/equipment/${id}`, { method: 'DELETE' });
    toast('Item deleted', 'info');
    closeDetail();
    loadItems();
  } catch (err) {
    toast(err.error || 'Delete failed', 'error');
  }
}

// Shared label printer — 40mm × 30mm thermal stock.
// Pass the label API response object plus item metadata.
function doPrintLabel(label, name, category, serial) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:40mm;height:30mm;border:none;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.write(`<html><head><style>
    @page{size:40mm 30mm;margin:0;}
    *{box-sizing:border-box;}
    body{margin:0;padding:1.5mm;font-family:Arial,sans-serif;display:flex;gap:1.5mm;align-items:center;width:40mm;height:30mm;overflow:hidden;}
    .qr{width:21mm;height:21mm;flex-shrink:0;}
    .info{flex:1;overflow:hidden;display:flex;flex-direction:column;gap:1px;}
    .lab{font-size:5pt;color:#555;font-weight:600;letter-spacing:.2px;}
    .name{font-size:6pt;font-weight:700;line-height:1.2;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;}
    .id{font-family:monospace;font-size:7pt;font-weight:700;letter-spacing:.3px;white-space:nowrap;overflow:hidden;}
    .sub{font-size:5pt;color:#555;white-space:nowrap;overflow:hidden;}
  </style></head><body>
    <img class="qr" src="${label.qr_data_url}">
    <div class="info">
      <div class="lab">CISTracker</div>
      <div class="name">${esc(name)}</div>
      <div class="id">${esc(label.asset_id)}</div>
      <div class="sub">${esc(category || '')}${serial ? ' · ' + serial : ''}</div>
    </div>
  </body></html>`);
  doc.close();
  setTimeout(() => { frame.contentWindow.print(); setTimeout(() => frame.remove(), 2000); }, 250);
}

function printPendingLabel() {
  if (!_pendingPrint) return;
  const { label, name, category, serial } = _pendingPrint;
  doPrintLabel(label, name, category, serial);
}

async function printLabel(id) {
  try {
    const label = await api(`/api/equipment/${id}/label`);
    const item = ITEMS.find(i => i.id === id);
    doPrintLabel(label, item?.name || '', item?.category || '', item?.serial_number || '');
  } catch (err) {
    toast(err.error || 'Failed to load label', 'error');
  }
}

// ── Modal helpers ──────────────────────────────────────────────────────
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

// ═══════════════════════════════════════════════════════════════════════
//  CHECK IN / OUT VIEW
// ═══════════════════════════════════════════════════════════════════════

function setCioMode(mode) {
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('scanMode').classList.toggle('hidden', mode !== 'scan');
  document.getElementById('manualMode').classList.toggle('hidden', mode !== 'manual');
}

async function loadCheckinout() {
  // Load currently checked out items
  await loadItems();
  const outItems = ITEMS.filter(i => i.status === 'checked_out');
  const container = document.getElementById('currentlyOutList');
  if (outItems.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No items currently checked out</p></div>';
    return;
  }
  container.innerHTML = outItems.map(item => {
    const st = getItemStatus(item);
    return `
      <div class="out-item">
        <div style="width:6px;height:6px;border-radius:50%;background:${st === 'overdue' ? 'var(--red)' : 'var(--amber)'}"></div>
        <div class="item-info">
          <div class="item-name">${esc(item.name)}</div>
          <div class="item-meta">${esc(item.checked_out_username || '—')} · ${fmtDate(item.checked_out_at)}</div>
        </div>
        <button class="btn-outline btn-sm btn-green" onclick="openReturnModal(${item.id})">Return</button>
      </div>
    `;
  }).join('');
}

function manualSearchItems() {
  const q = (document.getElementById('manualSearch').value || '').toLowerCase();
  const container = document.getElementById('manualResults');
  if (!q) { container.innerHTML = ''; return; }
  const results = ITEMS.filter(i => {
    const hay = `${i.name} ${i.barcode} ${i.serial_number} ${i.category}`.toLowerCase();
    return hay.includes(q);
  }).slice(0, 20);
  container.innerHTML = results.map(item => {
    const st = getItemStatus(item);
    return `
      <div class="out-item" style="cursor:pointer" onclick="openDetail(${item.id})">
        <div class="item-info">
          <div class="item-name">${esc(item.name)}</div>
          <div class="item-meta" style="font-family:var(--mono);color:var(--accent)">${esc(item.barcode || '')}</div>
        </div>
        <span class="status-badge status-${st}"><span class="dot"></span>${st === 'available' ? 'Available' : st === 'checked_out' ? 'Out' : 'Overdue'}</span>
        ${st === 'available'
          ? `<button class="btn-outline btn-sm" onclick="event.stopPropagation();openCheckoutModal(${item.id})">Check Out</button>`
          : `<button class="btn-outline btn-sm btn-green" onclick="event.stopPropagation();openReturnModal(${item.id})">Return</button>`}
      </div>
    `;
  }).join('');
  if (results.length === 0) container.innerHTML = '<div class="empty-state"><p>No items match</p></div>';
}

async function startScan() {
  const area = document.getElementById('scannerArea');
  // Stop any previous scan
  if (window._stopScan) { window._stopScan(); window._stopScan = null; }

  const ZX = window.ZXingBrowser || window.ZXing || null;
  if (!ZX || !ZX.BrowserMultiFormatReader) {
    showScanFallback(area, 'Scanner library not loaded — refresh the page or enter the barcode manually.');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showScanFallback(area, 'Camera not available on this device — enter barcode manually.');
    return;
  }

  // Render the scanner UI
  area.style.height = '300px';
  area.style.padding = '0';
  area.style.border = 'none';
  area.innerHTML = `
    <div style="position:relative;width:100%;height:100%;overflow:hidden;border-radius:12px;background:#000">
      <video id="scanVideo" playsinline autoplay muted style="width:100%;height:100%;object-fit:cover;display:block"></video>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none">
        <div style="width:62%;aspect-ratio:1;border:2px solid rgba(255,255,255,0.85);border-radius:6px;box-shadow:0 0 0 9999px rgba(0,0,0,0.38)"></div>
      </div>
      <button onclick="stopScan()" style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.55);color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer">✕ Cancel</button>
      <div id="scanStatus" style="position:absolute;bottom:10px;left:10px;right:10px;text-align:center;color:#fff;font-size:12px;text-shadow:0 0 4px rgba(0,0,0,0.8)">Looking for a QR code…</div>
    </div>
  `;

  try {
    const reader = new ZX.BrowserMultiFormatReader();
    const video = document.getElementById('scanVideo');
    let busy = false;
    const controls = await reader.decodeFromConstraints(
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      video,
      (result, err) => {
        if (result && !busy) {
          busy = true;
          const text = (result.getText && result.getText()) || result.text || '';
          if (window._stopScan) { window._stopScan(); window._stopScan = null; }
          resetScanArea();
          handleScannedCode(text);
        }
        // err is NotFoundException on every empty frame — ignore
      }
    );

    window._stopScan = () => {
      try { if (controls && controls.stop) controls.stop(); } catch {}
      try { if (reader && reader.reset) reader.reset(); } catch {}
      const v = document.getElementById('scanVideo');
      if (v && v.srcObject) {
        try { v.srcObject.getTracks().forEach(t => t.stop()); } catch {}
        v.srcObject = null;
      }
    };
  } catch (err) {
    if (window._stopScan) { window._stopScan(); window._stopScan = null; }
    let msg = 'Could not start camera';
    if (err?.name === 'NotAllowedError' || /permission/i.test(err?.message || '')) {
      msg = '⚠️ Camera permission denied. Allow camera access in your browser/device settings.';
    } else if (err?.name === 'NotFoundError') {
      msg = 'No camera detected on this device — enter barcode manually.';
    } else if (location.protocol !== 'https:') {
      msg = '⚠️ Camera requires HTTPS. Use <strong>https://cistracker.net</strong>';
    } else if (err?.message) {
      msg = err.message;
    }
    showScanFallback(area, msg);
  }
}

function showScanFallback(area, msg) {
  area.style.height = '';
  area.style.padding = '';
  area.style.border = '';
  area.innerHTML = `
    <div style="text-align:center;padding:16px">
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">${msg}</div>
      <input id="manualBarcode" type="text" inputmode="text" placeholder="Type or paste barcode…"
        style="padding:10px;border-radius:8px;background:var(--bg-base);border:1px solid var(--border-input);color:var(--text);font-size:14px;font-family:var(--mono);width:240px;text-align:center">
      <button class="btn-primary" style="margin-top:8px;display:block;margin-inline:auto"
        onclick="lookUpManualBarcode()">Look Up</button>
      <button class="btn-outline btn-sm" style="margin-top:8px;display:block;margin-inline:auto"
        onclick="resetScanArea()">↺ Try Camera Again</button>
    </div>
  `;
  document.getElementById('manualBarcode')?.focus();
}

function lookUpManualBarcode() {
  const val = (document.getElementById('manualBarcode')?.value || '').trim();
  if (!val) { toast('Enter a barcode first', 'error'); return; }
  handleScannedCode(val);
}

function stopScan() {
  if (window._stopScan) { window._stopScan(); window._stopScan = null; }
  resetScanArea();
}

function resetScanArea() {
  const area = document.getElementById('scannerArea');
  if (!area) return;
  area.style.height = '';
  area.style.padding = '';
  area.style.border = '';
  area.innerHTML = `
    <div class="scan-icon">📷</div>
    <div>Point camera at QR label</div>
    <button class="btn-primary" id="startScanBtn" onclick="startScan()">Start Scan</button>
  `;
}

async function handleScannedCode(code) {
  const resultDiv = document.getElementById('scanResult');
  try {
    const { item } = await api(`/api/equipment/lookup?code=${encodeURIComponent(code)}`);
    resultDiv.classList.remove('hidden');
    const st = getItemStatus(item);
    resultDiv.innerHTML = `
      <div class="scan-result">
        <div style="font-size:24px;color:var(--green)">✓</div>
        <div class="item-info">
          <div style="font-weight:600">${esc(item.name)}</div>
          <div style="font-family:var(--mono);font-size:12px;color:var(--accent)">${esc(item.barcode)}</div>
        </div>
        <span class="status-badge status-${st}"><span class="dot"></span>${st === 'available' ? 'Available' : 'Checked Out'}</span>
        ${st === 'available'
          ? `<button class="btn-primary" onclick="openCheckoutModal(${item.id})">Check Out</button>`
          : `<button class="btn-outline btn-green" onclick="openReturnModal(${item.id})">Return</button>`}
      </div>
    `;
  } catch {
    resultDiv.classList.remove('hidden');
    resultDiv.innerHTML = `<div class="scan-result" style="border-color:var(--red)"><div style="color:var(--red)">✕ No item found for "${esc(code)}"</div></div>`;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  OVERDUE
// ═══════════════════════════════════════════════════════════════════════

async function loadOverdueCount() {
  try {
    const { items } = await api('/api/admin/overdue?days=3');
    const badge = document.getElementById('overdueBadge');
    if (items && items.length > 0) {
      badge.textContent = items.length;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch {}
}

async function loadOverdue() {
  const container = document.getElementById('overdueList');
  try {
    const { items } = await api('/api/admin/overdue?days=3');
    if (!items || items.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">🎉</div><h3>No overdue items!</h3><p>Everything is returned on time.</p></div>';
      return;
    }
    container.innerHTML = items.map(item => `
      <div class="out-item" style="cursor:pointer" onclick="openDetail(${item.id})">
        <div style="width:6px;height:6px;border-radius:50%;background:var(--red)"></div>
        <div class="item-info">
          <div class="item-name">${esc(item.name)}</div>
          <div class="item-meta">${esc(item.checked_out_username)} · ${item.days_out} days overdue</div>
        </div>
        <button class="btn-outline btn-sm btn-green" onclick="event.stopPropagation();openReturnModal(${item.id})">Return</button>
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<div class="empty-state"><p>Could not load overdue items</p></div>';
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  TICKETS
// ═══════════════════════════════════════════════════════════════════════

async function loadTicketCounts() {
  // Only admins see the open-ticket count badge
  if (!ME || ME.role !== 'admin') return;
  try {
    const data = await api('/api/tickets/counts');
    const badge = document.getElementById('ticketBadge');
    const open = (data.open || 0) + (data.in_progress || 0);
    if (open > 0) { badge.textContent = open; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  } catch {}
}

async function loadTickets() {
  document.getElementById('ticketsContainer').classList.remove('hidden');
  document.getElementById('ticketDetail').classList.add('hidden');
  const container = document.getElementById('ticketList');
  try {
    const { tickets } = await api('/api/tickets');
    const filtered = ticketFilter === 'all' ? tickets : tickets.filter(t => t.status === ticketFilter);
    if (!filtered || filtered.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">🎫</div><h3>No tickets</h3><p>All clear!</p></div>';
      return;
    }
    container.innerHTML = filtered.map(t => `
      <div class="ticket-card" onclick="openTicket(${t.id})">
        <div class="ticket-top">
          <span class="ticket-id">#${t.id}</span>
          <span class="ticket-subject">${esc(t.subject)}</span>
          <div class="priority-dot priority-${t.priority}" title="${t.priority}"></div>
        </div>
        <div class="ticket-bottom">
          <span class="ticket-status ${t.status}">${t.status.replace('_', ' ')}</span>
          <span>${esc(t.reporter_username)}</span>
          <span>${fmtDate(t.created_at)}</span>
          ${t.comment_count > 0 ? `<span>💬 ${t.comment_count}</span>` : ''}
        </div>
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<div class="empty-state"><p>Failed to load tickets</p></div>';
  }
}

function setTicketFilter(f) {
  ticketFilter = f;
  document.querySelectorAll('#ticketStatusChips .chip').forEach(el => {
    el.classList.toggle('active', el.dataset.tstatus === f);
  });
  loadTickets();
}

async function openTicket(id) {
  document.getElementById('ticketsContainer').classList.add('hidden');
  const detail = document.getElementById('ticketDetail');
  detail.classList.remove('hidden');
  try {
    const { ticket, comments } = await api(`/api/tickets/${id}`);
    const isAdmin = ME.role === 'admin';
    detail.innerHTML = `
      <div class="back-link" onclick="loadTickets()">← Back to tickets</div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
        <span class="ticket-id">#${ticket.id}</span>
        <span class="ticket-status ${ticket.status}">${ticket.status.replace('_', ' ')}</span>
        <div class="priority-dot priority-${ticket.priority}" title="${ticket.priority}"></div>
      </div>
      <h2>${esc(ticket.subject)}</h2>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">
        by ${esc(ticket.reporter_username)} · ${fmtDateTime(ticket.created_at)}
        ${ticket.equipment_name ? ` · Equipment: ${esc(ticket.equipment_name)}` : ''}
      </div>
      <div style="font-size:13px;line-height:1.7;padding:16px;background:var(--bg-surface);border-radius:10px;border:1px solid var(--border)">
        ${esc(ticket.description || 'No description').replace(/\n/g, '<br>')}
      </div>
      ${isAdmin ? `
        <div style="display:flex;gap:8px;margin-top:12px">
          <select id="ticketStatusSelect" onchange="updateTicketStatus(${id})" style="padding:8px;border-radius:8px;background:var(--bg-base);border:1px solid var(--border-input);color:var(--text);font-size:12px">
            <option value="open" ${ticket.status === 'open' ? 'selected' : ''}>Open</option>
            <option value="in_progress" ${ticket.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
            <option value="resolved" ${ticket.status === 'resolved' ? 'selected' : ''}>Resolved</option>
            <option value="closed" ${ticket.status === 'closed' ? 'selected' : ''}>Closed</option>
          </select>
          <button class="btn-outline btn-sm btn-red" onclick="deleteTicket(${id})">Delete</button>
        </div>
      ` : ''}
      <div class="comment-list">
        <h4 style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Comments (${comments.length})</h4>
        ${comments.map(c => `
          <div class="comment-card">
            <div class="comment-header">
              <span class="author">${esc(c.username)} ${c.role === 'admin' ? '(admin)' : ''}</span>
              <span class="date">${fmtDateTime(c.created_at)}</span>
            </div>
            <div class="comment-body">${esc(c.body).replace(/\n/g, '<br>')}</div>
          </div>
        `).join('')}
      </div>
      <div class="comment-form">
        <div class="form-group"><textarea id="commentBody" rows="2" placeholder="Add a comment…"></textarea></div>
        <button class="btn-primary" onclick="submitComment(${id})">Post Comment</button>
      </div>
    `;
  } catch (err) {
    detail.innerHTML = `<div class="back-link" onclick="loadTickets()">← Back</div><p>Failed to load ticket</p>`;
  }
}

async function submitComment(ticketId) {
  const body = document.getElementById('commentBody')?.value?.trim();
  if (!body) return;
  try {
    await api(`/api/tickets/${ticketId}/comments`, { method: 'POST', body: { body } });
    openTicket(ticketId);
  } catch (err) {
    toast(err.error || 'Failed to post comment', 'error');
  }
}

async function updateTicketStatus(ticketId) {
  const status = document.getElementById('ticketStatusSelect')?.value;
  try {
    await api(`/api/tickets/${ticketId}`, { method: 'PUT', body: { status } });
    toast('Status updated', 'success');
  } catch (err) {
    toast(err.error || 'Failed', 'error');
  }
}

async function deleteTicket(id) {
  if (!confirm('Delete this ticket?')) return;
  try {
    await api(`/api/tickets/${id}`, { method: 'DELETE' });
    toast('Ticket deleted', 'info');
    loadTickets();
    loadTicketCounts();
  } catch (err) {
    toast(err.error || 'Failed', 'error');
  }
}

function openNewTicketModal() {
  const modal = document.getElementById('modalContent');
  modal.innerHTML = `
    <div class="modal-title">New Support Ticket</div>
    <div class="modal-body">
      <div class="form-group"><label>Subject *</label><input id="ticketSubject" placeholder="Brief description of the issue" required></div>
      <div class="form-group">
        <label>Priority</label>
        <select id="ticketPriority" style="width:100%;padding:10px 12px;border-radius:9px;background:var(--bg-base);border:1px solid var(--border-input);color:var(--text);font-size:13px">
          <option value="low">Low</option>
          <option value="normal" selected>Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>
      <div class="form-group"><label>Description</label><textarea id="ticketDesc" rows="4" placeholder="Detailed description…"></textarea></div>
      <div class="form-actions">
        <button class="btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="submitTicket()">Submit Ticket</button>
      </div>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('open');
}

async function submitTicket() {
  const subject = document.getElementById('ticketSubject')?.value?.trim();
  if (!subject) { toast('Subject is required', 'error'); return; }
  try {
    await api('/api/tickets', {
      method: 'POST',
      body: {
        subject,
        priority: document.getElementById('ticketPriority').value,
        description: document.getElementById('ticketDesc')?.value || '',
      },
    });
    toast('Ticket submitted!', 'success');
    closeModal();
    loadTickets();
    loadTicketCounts();
  } catch (err) {
    toast(err.error || 'Failed to submit', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  USERS (admin)
// ═══════════════════════════════════════════════════════════════════════

async function loadUsers() {
  const container = document.getElementById('usersList');
  try {
    const { users } = await api('/api/admin/users');
    container.innerHTML = users.map(u => `
      <div class="user-row" onclick="openUserDetail(${u.id})">
        <div class="avatar">${u.username[0].toUpperCase()}</div>
        <div class="user-info">
          <div class="user-name">${esc(u.username)}</div>
          <div class="user-email">${esc(u.email || '—')}</div>
        </div>
        <span class="role-badge role-${u.role}">${u.role}</span>
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<div class="empty-state"><p>Failed to load users</p></div>';
  }
}

async function openUserDetail(id) {
  try {
    const data = await api(`/api/admin/users/${id}`);
    const u = data.user;
    const modal = document.getElementById('modalContent');
    modal.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <div class="avatar" style="width:40px;height:40px;font-size:16px">${u.username[0].toUpperCase()}</div>
        <div>
          <div style="font-size:16px;font-weight:600">${esc(u.username)}</div>
          <div style="font-size:12px;color:var(--text-muted)">${esc(u.email || '—')}</div>
        </div>
        <span class="role-badge role-${u.role}" style="margin-left:auto">${u.role}</span>
      </div>
      <div class="modal-body">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-outline btn-sm" onclick="toggleRole(${u.id},'${u.role === 'admin' ? 'user' : 'admin'}')">
            ${u.role === 'admin' ? 'Demote to User' : 'Promote to Admin'}
          </button>
          <button class="btn-outline btn-sm" onclick="resetUserPw(${u.id})">Reset Password</button>
          <button class="btn-outline btn-sm btn-red" onclick="deleteUser(${u.id})">Delete User</button>
        </div>
        ${data.currentCheckouts && data.currentCheckouts.length > 0 ? `
          <div style="margin-top:16px">
            <h4 style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Current Checkouts (${data.currentCheckouts.length})</h4>
            ${data.currentCheckouts.map(e => `<div style="font-size:13px;padding:4px 0">${esc(e.name)} <span style="font-family:var(--mono);font-size:11px;color:var(--accent)">${esc(e.barcode)}</span></div>`).join('')}
          </div>
        ` : ''}
      </div>
      <div class="form-actions" style="margin-top:16px">
        <button class="btn-outline" onclick="closeModal()">Close</button>
      </div>
    `;
    document.getElementById('modalOverlay').classList.add('open');
  } catch (err) {
    toast(err.error || 'Failed', 'error');
  }
}

async function toggleRole(id, newRole) {
  try {
    await api(`/api/admin/users/${id}`, { method: 'PUT', body: { role: newRole } });
    toast(`Role changed to ${newRole}`, 'success');
    closeModal();
    loadUsers();
  } catch (err) { toast(err.error || 'Failed', 'error'); }
}

async function resetUserPw(id) {
  try {
    const { tempPassword } = await api(`/api/admin/users/${id}`, { method: 'PUT', body: { reset_password: true } });
    toast(`Temporary password: ${tempPassword}`, 'info');
  } catch (err) { toast(err.error || 'Failed', 'error'); }
}

async function deleteUser(id) {
  if (!confirm('Delete this user?')) return;
  try {
    await api(`/api/admin/users/${id}`, { method: 'DELETE' });
    toast('User deleted', 'info');
    closeModal();
    loadUsers();
  } catch (err) { toast(err.error || 'Failed', 'error'); }
}

function openCreateUserModal() {
  const modal = document.getElementById('modalContent');
  modal.innerHTML = `
    <div class="modal-title">Add User</div>
    <div class="modal-body">
      <div class="form-group"><label>Username *</label><input id="newUsername" required></div>
      <div class="form-group"><label>Email *</label><input id="newEmail" type="email" required></div>
      <div class="form-group">
        <label>Role</label>
        <select id="newRole" style="width:100%;padding:10px 12px;border-radius:9px;background:var(--bg-base);border:1px solid var(--border-input);color:var(--text);font-size:13px">
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div class="info-strip">A temporary password will be generated and emailed to the user.</div>
      <div class="form-actions">
        <button class="btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="submitCreateUser()">Create User</button>
      </div>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('open');
}

async function submitCreateUser() {
  try {
    const { user, tempPassword } = await api('/api/admin/users', {
      method: 'POST',
      body: {
        username: document.getElementById('newUsername').value,
        email: document.getElementById('newEmail').value,
        role: document.getElementById('newRole').value,
      },
    });
    toast(`User created! Temp password: ${tempPassword}`, 'success');
    closeModal();
    loadUsers();
  } catch (err) {
    toast(err.error || 'Failed to create user', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  AUDIT LOG (admin)
// ═══════════════════════════════════════════════════════════════════════

async function loadAudit() {
  const container = document.getElementById('auditList');
  try {
    const { entries } = await api('/api/admin/audit?limit=200');
    if (!entries || entries.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No audit entries</p></div>';
      return;
    }
    container.innerHTML = entries.map(e => `
      <div class="audit-row">
        <span class="action">${esc(e.action)}</span>
        <span class="target">${esc(e.target || '—')}</span>
        <span style="font-size:11px;color:var(--text-muted)">${esc(e.ip_address || '')}</span>
        <span class="date">${fmtDateTime(e.created_at)}</span>
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<div class="empty-state"><p>Failed to load audit log</p></div>';
  }
}

// ── Util ───────────────────────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
