'use strict';
/* ============================================================
   CISTracker — Single-Page Application
   ============================================================ */

// ─── UTILITIES ────────────────────────────────────────────────────────────────
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let _toastTimer;
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function api(path, { method = 'GET', body } = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}

// ─── AUTH / SESSION ───────────────────────────────────────────────────────────
let _currentUser = null;

async function checkAuth() {
  try {
    const { user } = await api('/api/auth/me');
    _currentUser = user;
    if (user.must_change_pw) {
      showLoginPage();
      showForcePwModal();
      return;
    }
    onAuthSuccess(user);
  } catch {
    showLoginPage();
  }
}

function showLoginPage() {
  document.getElementById('loginPage').classList.remove('hidden');
  document.getElementById('appLayout').classList.add('hidden');
  // Reset MFA section
  const mfaGroup = document.getElementById('mfaGroup');
  if (mfaGroup) mfaGroup.classList.add('hidden');
}

function onAuthSuccess(user) {
  _currentUser = user;
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('appLayout').classList.remove('hidden');

  // Update avatar
  const avatar = document.getElementById('userAvatar');
  if (avatar) avatar.textContent = (user.username || '?')[0].toUpperCase();

  // Update user info in sidebar
  const userEmailEl = document.getElementById('userEmail');
  if (userEmailEl) userEmailEl.textContent = user.email || user.username;
  const userNameEl = document.getElementById('sidebarUsername');
  if (userNameEl) userNameEl.textContent = user.username;

  // Show/hide admin nav
  const adminNav = document.getElementById('adminNav');
  if (adminNav) adminNav.style.display = user.role === 'admin' ? '' : 'none';

  // Show/hide add item button
  const addBtn = document.getElementById('addItemBtn');
  if (addBtn) addBtn.style.display = user.role === 'admin' ? '' : 'none';

  switchView('inventory');
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

function hideLoginError() {
  const el = document.getElementById('loginError');
  if (el) el.style.display = 'none';
}

async function handleLoginSubmit(e) {
  if (e) e.preventDefault();
  hideLoginError();
  const username = (document.getElementById('loginUser')?.value || '').trim();
  const password = document.getElementById('loginPass')?.value || '';
  const mfaCode = (document.getElementById('loginMfa')?.value || '').trim();
  const mfaGroup = document.getElementById('mfaGroup');
  const mfaVisible = mfaGroup && !mfaGroup.classList.contains('hidden');

  if (!username || !password) {
    showLoginError('Enter username and password');
    return;
  }

  try {
    const body = { username, password };
    if (mfaVisible && mfaCode) body.mfa_code = mfaCode;
    const data = await api('/api/auth/login', { method: 'POST', body });

    if (data.mfaRequired) {
      if (mfaGroup) mfaGroup.classList.remove('hidden');
      document.getElementById('loginMfa')?.focus();
      return;
    }
    if (data.mustChangePw || data.user?.must_change_pw) {
      _currentUser = data.user;
      document.getElementById('loginPage').classList.add('hidden');
      showForcePwModal();
      return;
    }
    onAuthSuccess(data.user);
  } catch (err) {
    showLoginError(err.error || err.message || 'Login failed');
  }
}

function showForcePwModal() {
  // Show a modal for forced password change
  document.getElementById('appLayout').classList.remove('hidden');
  document.getElementById('loginPage').classList.add('hidden');
  const modal = document.getElementById('modalContent');
  modal.innerHTML = `
    <div class="modal-title">Change Password Required</div>
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">
      You must set a new password before continuing.
    </p>
    <div class="form-group">
      <label>New Password</label>
      <input id="forcePwNew" type="password" class="form-input" placeholder="At least 8 characters" autofocus>
    </div>
    <div class="form-group">
      <label>Confirm Password</label>
      <input id="forcePwConfirm" type="password" class="form-input">
    </div>
    <div class="form-actions">
      <button class="btn-primary" onclick="submitForcePw()">Set Password</button>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('open');
}

async function submitForcePw() {
  const pw1 = document.getElementById('forcePwNew')?.value || '';
  const pw2 = document.getElementById('forcePwConfirm')?.value || '';
  if (!pw1) { toast('Enter a new password', 'error'); return; }
  if (pw1.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
  if (pw1 !== pw2) { toast('Passwords do not match', 'error'); return; }
  try {
    const data = await api('/api/auth/change-password', { method: 'POST', body: { password: pw1 } });
    closeModal();
    onAuthSuccess(data.user);
  } catch (err) {
    toast(err.error || 'Failed to change password', 'error');
  }
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  _currentUser = null;
  showLoginPage();
}

async function loginWithPasskey() {
  try {
    const { SimpleWebAuthnBrowser } = window;
    if (!SimpleWebAuthnBrowser) { toast('WebAuthn not available', 'error'); return; }
    const { options } = await api('/api/passkeys/authenticate/begin', { method: 'POST' });
    const response = await SimpleWebAuthnBrowser.startAuthentication(options);
    const data = await api('/api/passkeys/authenticate/finish', { method: 'POST', body: { response } });
    if (data.user) onAuthSuccess(data.user);
  } catch (err) {
    if (err.name === 'NotAllowedError') return;
    toast(err.error || err.message || 'Passkey login failed', 'error');
  }
}

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
let _currentView = null;

function switchView(view) {
  // Hide all views
  document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hidden'));
  // Deactivate all nav items
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  // Activate matching nav item
  const navItem = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (navItem) navItem.classList.add('active');
  // Show chosen view
  const viewEl = document.getElementById(`view-${view}`);
  if (viewEl) viewEl.classList.remove('hidden');
  _currentView = view;
  closeMobileSidebar();

  if (view === 'inventory') loadInventory();
  else if (view === 'checkinout') resetCioView();
  else if (view === 'overdue') loadOverdue();
  else if (view === 'tickets') loadTickets();
  else if (view === 'users') loadUsers();
  else if (view === 'audit') loadAudit();
  else if (view === 'passkeys') loadPasskeys();
  else if (view === 'locations') loadLocations();
}

function toggleMobileSidebar() {
  document.getElementById('sidebar')?.classList.toggle('open');
  document.getElementById('sidebarBackdrop')?.classList.toggle('open');
}
function closeMobileSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarBackdrop')?.classList.remove('open');
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
function closeModal() {
  document.getElementById('modalOverlay')?.classList.remove('open');
}
function closeDetail() {
  document.getElementById('detailOverlay')?.classList.remove('open');
}

// ─── INVENTORY ────────────────────────────────────────────────────────────────
let _allItems = [];
let _statusFilter = 'all';
let _catFilter = 'all';
let _locFilter = 'all';
let _searchQuery = '';

async function loadInventory() {
  try {
    const { items } = await api('/api/equipment');
    _allItems = items;
    renderInventory();
    buildCategoryChips();
    buildLocationChips();
    updateStats();
  } catch {
    toast('Failed to load inventory', 'error');
  }
}

function updateStats() {
  const now = new Date();
  const total = _allItems.length;
  const available = _allItems.filter(i => i.status === 'available').length;
  const out = _allItems.filter(i => i.status === 'checked_out').length;
  const overdue = _allItems.filter(i =>
    i.status === 'checked_out' && i.due_date && new Date(i.due_date) < now
  ).length;

  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('statTotal', total);
  set('statAvailable', available);
  set('statOut', out);
  set('statOverdue', overdue);

  const badge = document.getElementById('overdueBadge');
  if (badge) { badge.textContent = overdue; badge.classList.toggle('hidden', overdue === 0); }
}

function buildCategoryChips() {
  const cats = [...new Set(_allItems.map(i => i.category).filter(Boolean))].sort();
  const container = document.getElementById('catChips');
  if (!container) return;
  container.innerHTML = cats.map(c =>
    `<div class="chip${_catFilter === c ? ' active' : ''}" onclick="setCatFilter(${JSON.stringify(c)})">${esc(c)}</div>`
  ).join('');
}

function buildLocationChips() {
  const locs = [...new Set(_allItems.map(i => i.location).filter(Boolean))].sort();
  const container = document.getElementById('locChips');
  if (!container) return;
  container.innerHTML = locs.map(l =>
    `<div class="chip${_locFilter === l ? ' active' : ''}" onclick="setLocFilter(${JSON.stringify(l)})">${esc(l)}</div>`
  ).join('');
}

function filterItems() {
  _searchQuery = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  renderInventory();
}

function setStatusFilter(s) {
  _statusFilter = s;
  document.querySelectorAll('#statusChips .chip').forEach(el => {
    el.classList.toggle('active', el.dataset.status === s);
  });
  renderInventory();
}

function setCatFilter(c) {
  _catFilter = _catFilter === c ? 'all' : c;
  buildCategoryChips();
  renderInventory();
}

function setLocFilter(l) {
  _locFilter = _locFilter === l ? 'all' : l;
  buildLocationChips();
  renderInventory();
}

function renderInventory() {
  const tbody = document.getElementById('itemsBody');
  if (!tbody) return;
  const now = new Date();

  let items = _allItems;
  if (_statusFilter !== 'all') {
    if (_statusFilter === 'overdue') {
      items = items.filter(i => i.status === 'checked_out' && i.due_date && new Date(i.due_date) < now);
    } else {
      items = items.filter(i => i.status === _statusFilter);
    }
  }
  if (_catFilter !== 'all') items = items.filter(i => i.category === _catFilter);
  if (_locFilter !== 'all') items = items.filter(i => i.location === _locFilter);
  if (_searchQuery) {
    items = items.filter(i =>
      (i.name || '').toLowerCase().includes(_searchQuery) ||
      (i.barcode || '').toLowerCase().includes(_searchQuery) ||
      (i.serial_number || '').toLowerCase().includes(_searchQuery) ||
      (i.category || '').toLowerCase().includes(_searchQuery)
    );
  }

  const countEl = document.getElementById('itemCount');
  if (countEl) countEl.textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-muted)">No items found</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(item => {
    const isOverdue = item.status === 'checked_out' && item.due_date && new Date(item.due_date) < now;
    const statusClass = item.status === 'available' ? 'status-available' : 'status-out';
    const statusLabel = item.status === 'available' ? 'Available' :
      `Out${item.checked_out_username ? ' – ' + esc(item.checked_out_username) : ''}`;
    const canReturn = item.status === 'checked_out' &&
      (_currentUser?.role === 'admin' || item.checked_out_by === _currentUser?.id);
    return `
      <tr onclick="openItemDetail(${item.id})" style="cursor:pointer">
        <td><span style="font-family:var(--mono);font-size:12px">${esc(item.barcode || '—')}</span></td>
        <td>
          <div style="font-weight:500">${esc(item.name)}</div>
          ${item.serial_number ? `<div style="font-size:11px;color:var(--text-muted);font-family:var(--mono)">${esc(item.serial_number)}</div>` : ''}
        </td>
        <td>${esc(item.category || '—')}</td>
        <td>${esc(item.location || '—')}</td>
        <td>
          <span class="status-badge ${statusClass}">${statusLabel}</span>
          ${isOverdue ? `<span class="badge badge-red" style="margin-left:4px">Overdue</span>` : ''}
          ${item.period_available ? `<span class="badge badge-green" style="margin-left:4px">Avail Now</span>` : ''}
        </td>
        <td>
          ${item.status === 'available'
            ? `<button class="btn-sm btn-primary" onclick="event.stopPropagation();quickCheckout(${item.id})">Check Out</button>`
            : canReturn
              ? `<button class="btn-sm btn-outline" onclick="event.stopPropagation();quickCheckin(${item.id})">Return</button>`
              : ''}
        </td>
      </tr>`;
  }).join('');
}

async function openItemDetail(id) {
  try {
    const { item } = await api(`/api/equipment/${id}`);
    const logData = await api(`/api/equipment/log?equipment_id=${id}&limit=20`).catch(() => ({ entries: [] }));
    const log = logData.entries || [];
    const panel = document.getElementById('detailPanel');
    const isAdmin = _currentUser?.role === 'admin';
    const isOverdue = item.status === 'checked_out' && item.due_date && new Date(item.due_date) < new Date();
    const canReturn = item.status === 'checked_out' &&
      (isAdmin || item.checked_out_by === _currentUser?.id);

    panel.innerHTML = `
      <div class="detail-header">
        <div>
          <div class="detail-title">${esc(item.name)}</div>
          ${item.barcode ? `<div class="detail-sub" style="font-family:var(--mono);font-size:12px">${esc(item.barcode)}</div>` : ''}
        </div>
        <button class="btn-icon" onclick="closeDetail()">✕</button>
      </div>
      <div class="detail-body">
        <div style="margin-bottom:12px">
          <span class="status-badge ${item.status === 'available' ? 'status-available' : 'status-out'}">
            ${item.status === 'available' ? 'Available' : `Out – ${esc(item.checked_out_username || '')}`}
          </span>
          ${isOverdue ? `<span class="badge badge-red" style="margin-left:6px">Overdue</span>` : ''}
        </div>
        ${item.serial_number ? `<div style="margin-bottom:8px;font-size:13px"><span style="color:var(--text-muted)">S/N: </span><span style="font-family:var(--mono)">${esc(item.serial_number)}</span></div>` : ''}
        ${item.category ? `<div style="margin-bottom:8px;font-size:13px"><span style="color:var(--text-muted)">Category: </span>${esc(item.category)}</div>` : ''}
        ${item.location ? `<div style="margin-bottom:8px;font-size:13px"><span style="color:var(--text-muted)">Location: </span>${esc(item.location)}</div>` : ''}
        ${item.status === 'checked_out' && item.due_date
          ? `<div style="margin-bottom:8px;font-size:13px"><span style="color:var(--text-muted)">Due: </span>${new Date(item.due_date).toLocaleDateString()}</div>` : ''}
        ${item.notes ? `<div style="margin-bottom:12px;font-size:13px;color:var(--text-muted)">${esc(item.notes)}</div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
          ${item.status === 'available' ? `<button class="btn-primary btn-sm" onclick="quickCheckout(${item.id})">Check Out</button>` : ''}
          ${canReturn ? `<button class="btn-outline btn-sm" onclick="quickCheckin(${item.id})">Return</button>` : ''}
          ${isAdmin ? `
            <button class="btn-outline btn-sm" onclick="openEditItemModal(${item.id})">Edit</button>
            <button class="btn-outline btn-sm" onclick="printLabel(${item.id})">Print Label</button>
            <button class="btn-outline btn-sm" style="color:var(--red);border-color:var(--red)" onclick="deleteItem(${item.id})">Delete</button>` : ''}
        </div>
        ${log.length ? `
          <div style="border-top:1px solid var(--border);padding-top:12px">
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;font-weight:600">HISTORY</div>
            ${log.map(e => `
              <div style="display:flex;gap:8px;align-items:center;padding:4px 0;font-size:12px;border-bottom:1px solid var(--border-subtle)">
                <span style="font-weight:600;color:${e.action === 'checkout' ? 'var(--red)' : 'var(--green)'}">${e.action === 'checkout' ? '↑ Out' : '↓ In'}</span>
                <span>${esc(e.checkout_user || '')}</span>
                <span style="color:var(--text-muted);margin-left:auto">${new Date(e.created_at).toLocaleDateString()}</span>
              </div>
            `).join('')}
          </div>` : ''}
      </div>
    `;
    document.getElementById('detailOverlay').classList.add('open');
  } catch (err) {
    toast(err.error || 'Failed to load item', 'error');
  }
}

async function quickCheckout(id) {
  if (_currentUser?.role === 'admin') {
    try {
      const { users } = await api('/api/admin/users');
      openCheckoutModal(id, users);
    } catch { toast('Failed to load users', 'error'); }
  } else {
    try {
      await api(`/api/equipment/${id}/checkout`, { method: 'POST', body: { source: 'Manual' } });
      toast('Checked out', 'success');
      closeDetail();
      loadInventory();
    } catch (err) { toast(err.error || 'Checkout failed', 'error'); }
  }
}

async function quickCheckin(id) {
  try {
    const result = await api(`/api/equipment/${id}/checkin`, { method: 'POST', body: { source: 'Manual' } });
    toast('Returned', 'success');
    closeDetail();
    loadInventory();
    if (result.nextInQueue?.username) toast(`${result.nextInQueue.username} is next in queue`, 'info');
  } catch (err) { toast(err.error || 'Check-in failed', 'error'); }
}

function openCheckoutModal(equipmentId, users) {
  const modal = document.getElementById('modalContent');
  modal.innerHTML = `
    <div class="modal-title">Check Out Item</div>
    <div class="modal-body">
      <div class="form-group">
        <label>Check out to</label>
        <select id="checkoutUserId" style="width:100%;padding:10px 12px;border-radius:9px;background:var(--bg-base);border:1px solid var(--border-input);color:var(--text);font-size:13px">
          ${users.map(u => `<option value="${u.id}">${esc(u.username)}${u.student_group && u.student_group !== 'none' ? ' (' + u.student_group + ')' : ''}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Duration (days)</label>
        <input id="checkoutDays" type="number" value="7" min="1" max="30" style="width:100%;padding:10px 12px;border-radius:9px;background:var(--bg-base);border:1px solid var(--border-input);color:var(--text);font-size:13px">
      </div>
      <div class="form-actions">
        <button class="btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="confirmCheckout(${equipmentId})">Check Out</button>
      </div>
    </div>
  `;
  closeDetail();
  document.getElementById('modalOverlay').classList.add('open');
}

async function confirmCheckout(equipmentId) {
  const userId = parseInt(document.getElementById('checkoutUserId').value, 10);
  const days = parseInt(document.getElementById('checkoutDays').value, 10) || 7;
  try {
    await api(`/api/equipment/${equipmentId}/checkout`, {
      method: 'POST',
      body: { for_user_id: userId, duration_days: days, source: 'Manual' },
    });
    toast('Checked out', 'success');
    closeModal();
    loadInventory();
  } catch (err) { toast(err.error || 'Checkout failed', 'error'); }
}

function openAddItemModal() {
  const modal = document.getElementById('modalContent');
  modal.innerHTML = `
    <div class="modal-title">Add Item</div>
    <div class="modal-body">
      <div class="form-group"><label>Name <span style="color:var(--red)">*</span></label><input id="itemName" class="form-input" autofocus></div>
      <div class="form-group"><label>Asset ID / Barcode</label>
        <div style="display:flex;gap:8px">
          <input id="itemBarcode" class="form-input" style="flex:1">
          <button class="btn-outline btn-sm" onclick="suggestAssetId()">Suggest</button>
        </div>
      </div>
      <div class="form-group"><label>Serial Number</label><input id="itemSerial" class="form-input"></div>
      <div class="form-group"><label>Category</label><input id="itemCategory" class="form-input"></div>
      <div class="form-group"><label>Location</label><input id="itemLocation" class="form-input"></div>
      <div class="form-group"><label>Notes</label><input id="itemNotes" class="form-input"></div>
      <div class="form-actions">
        <button class="btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="submitAddItem()">Add Item</button>
      </div>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('open');
}

async function suggestAssetId() {
  try {
    const { asset_id } = await api('/api/equipment/next-asset-id');
    const el = document.getElementById('itemBarcode');
    if (el) el.value = asset_id;
  } catch { toast('Could not suggest ID', 'error'); }
}

async function submitAddItem() {
  const name = document.getElementById('itemName')?.value.trim();
  if (!name) { toast('Name is required', 'error'); return; }
  try {
    await api('/api/equipment', {
      method: 'POST',
      body: {
        name,
        barcode: document.getElementById('itemBarcode')?.value.trim() || undefined,
        serial_number: document.getElementById('itemSerial')?.value.trim() || undefined,
        category: document.getElementById('itemCategory')?.value.trim() || undefined,
        location: document.getElementById('itemLocation')?.value.trim() || undefined,
        notes: document.getElementById('itemNotes')?.value.trim() || undefined,
      },
    });
    toast('Item added', 'success');
    closeModal();
    loadInventory();
  } catch (err) { toast(err.error || 'Failed to add item', 'error'); }
}

async function openEditItemModal(id) {
  try {
    const { item } = await api(`/api/equipment/${id}`);
    const modal = document.getElementById('modalContent');
    modal.innerHTML = `
      <div class="modal-title">Edit Item</div>
      <div class="modal-body">
        <div class="form-group"><label>Name <span style="color:var(--red)">*</span></label><input id="editName" class="form-input" value="${esc(item.name)}"></div>
        <div class="form-group"><label>Asset ID / Barcode</label><input id="editBarcode" class="form-input" value="${esc(item.barcode || '')}"></div>
        <div class="form-group"><label>Serial Number</label><input id="editSerial" class="form-input" value="${esc(item.serial_number || '')}"></div>
        <div class="form-group"><label>Category</label><input id="editCategory" class="form-input" value="${esc(item.category || '')}"></div>
        <div class="form-group"><label>Location</label><input id="editLocation" class="form-input" value="${esc(item.location || '')}"></div>
        <div class="form-group"><label>Notes</label><input id="editNotes" class="form-input" value="${esc(item.notes || '')}"></div>
        <div class="form-actions">
          <button class="btn-outline" onclick="closeModal()">Cancel</button>
          <button class="btn-primary" onclick="submitEditItem(${id})">Save Changes</button>
        </div>
      </div>
    `;
    closeDetail();
    document.getElementById('modalOverlay').classList.add('open');
  } catch (err) { toast(err.error || 'Failed to load item', 'error'); }
}

async function submitEditItem(id) {
  const name = document.getElementById('editName')?.value.trim();
  if (!name) { toast('Name is required', 'error'); return; }
  try {
    await api(`/api/equipment/${id}`, {
      method: 'PUT',
      body: {
        name,
        barcode: document.getElementById('editBarcode')?.value.trim() || undefined,
        serial_number: document.getElementById('editSerial')?.value.trim() || undefined,
        category: document.getElementById('editCategory')?.value.trim() || undefined,
        location: document.getElementById('editLocation')?.value.trim() || undefined,
        notes: document.getElementById('editNotes')?.value.trim() || undefined,
      },
    });
    toast('Item updated', 'success');
    closeModal();
    loadInventory();
  } catch (err) { toast(err.error || 'Failed to update', 'error'); }
}

async function deleteItem(id) {
  if (!confirm('Delete this item? This cannot be undone.')) return;
  try {
    await api(`/api/equipment/${id}`, { method: 'DELETE' });
    toast('Item deleted', 'info');
    closeDetail();
    loadInventory();
  } catch (err) { toast(err.error || 'Failed to delete', 'error'); }
}

async function printLabel(id) {
  try {
    const { asset_id, name, qr_data_url } = await api(`/api/equipment/${id}/label`);
    const win = window.open('', '_blank', 'width=400,height=500');
    win.document.write(`<!DOCTYPE html><html><head><title>Label – ${esc(name)}</title>
      <style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;font-family:monospace;}
      img{width:200px;height:200px;} .lname{font-size:14px;margin-top:8px;text-align:center;max-width:200px;font-weight:bold;}
      .lcode{font-size:12px;color:#555;margin-top:4px;}</style></head>
      <body><img src="${qr_data_url}"><div class="lname">${esc(name)}</div>
      <div class="lcode">${esc(asset_id)}</div>
      <script>window.onload=()=>window.print();<\/script></body></html>`);
    win.document.close();
  } catch (err) { toast(err.error || 'Failed to generate label', 'error'); }
}

// ─── CHECK IN / OUT ───────────────────────────────────────────────────────────
let _scanner = null;

function resetCioView() {
  setCioMode('scan');
  const sr = document.getElementById('scanResult');
  if (sr) sr.classList.add('hidden');
}

function setCioMode(mode) {
  document.querySelectorAll('.mode-btn').forEach(el => {
    el.classList.toggle('active', el.dataset.mode === mode);
  });
  const scanMode = document.getElementById('scanMode');
  const manualMode = document.getElementById('manualMode');
  if (scanMode) scanMode.classList.toggle('hidden', mode !== 'scan');
  if (manualMode) manualMode.classList.toggle('hidden', mode !== 'manual');
  if (_scanner) { try { _scanner.reset(); } catch {} _scanner = null; }
  const startBtn = document.getElementById('startScanBtn');
  if (startBtn) startBtn.style.display = '';
}

async function startScan() {
  const scannerArea = document.getElementById('scannerArea');
  if (!scannerArea) return;
  try {
    const ZXing = window.ZXing;
    if (!ZXing) { toast('Scanner library not loaded', 'error'); return; }
    _scanner = new ZXing.BrowserQRCodeReader();
    const startBtn = document.getElementById('startScanBtn');
    if (startBtn) startBtn.style.display = 'none';
    const result = await _scanner.decodeOnceFromConstraints(
      { video: { facingMode: 'environment' } },
      scannerArea
    );
    _scanner.reset(); _scanner = null;
    if (startBtn) startBtn.style.display = '';
    await handleScannedCode(result.text);
  } catch (err) {
    if (_scanner) { try { _scanner.reset(); } catch {} _scanner = null; }
    const startBtn = document.getElementById('startScanBtn');
    if (startBtn) startBtn.style.display = '';
    if (err?.name !== 'NotFoundException' && err?.name !== 'NotAllowedError') {
      toast('Scan failed: ' + (err?.message || ''), 'error');
    }
  }
}

async function handleScannedCode(code) {
  try {
    const { item } = await api(`/api/equipment/lookup?code=${encodeURIComponent(code)}`);
    showScanResult(item);
  } catch { toast('No item found for that code', 'error'); }
}

function showScanResult(item) {
  const div = document.getElementById('scanResult');
  if (!div) return;
  div.classList.remove('hidden');
  const isOut = item.status === 'checked_out';
  const canReturn = isOut && (_currentUser?.role === 'admin' || item.checked_out_by === _currentUser?.id);
  div.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px">
      <div style="font-weight:600;font-size:15px;margin-bottom:4px">${esc(item.name)}</div>
      <div style="font-family:var(--mono);font-size:12px;color:var(--text-muted);margin-bottom:10px">${esc(item.barcode || item.serial_number || '')}</div>
      <div style="margin-bottom:12px">
        <span class="status-badge ${isOut ? 'status-out' : 'status-available'}">
          ${isOut ? `Out – ${esc(item.checked_out_username || '')}` : 'Available'}
        </span>
      </div>
      <div style="display:flex;gap:8px">
        ${!isOut ? `<button class="btn-primary btn-sm" onclick="scanCheckout(${item.id})">Check Out</button>` : ''}
        ${canReturn ? `<button class="btn-outline btn-sm" onclick="scanCheckin(${item.id})">Return</button>` : ''}
        <button class="btn-outline btn-sm" onclick="document.getElementById('scanResult').classList.add('hidden')">Dismiss</button>
      </div>
    </div>
  `;
}

async function scanCheckout(id) {
  if (_currentUser?.role === 'admin') {
    try {
      const { users } = await api('/api/admin/users');
      openCheckoutModal(id, users);
    } catch { toast('Failed to load users', 'error'); }
  } else {
    try {
      await api(`/api/equipment/${id}/checkout`, { method: 'POST', body: { source: 'Scan' } });
      toast('Checked out', 'success');
      document.getElementById('scanResult')?.classList.add('hidden');
      loadInventory();
    } catch (err) { toast(err.error || 'Checkout failed', 'error'); }
  }
}

async function scanCheckin(id) {
  try {
    const result = await api(`/api/equipment/${id}/checkin`, { method: 'POST', body: { source: 'Scan' } });
    toast('Returned', 'success');
    document.getElementById('scanResult')?.classList.add('hidden');
    if (result.nextInQueue?.username) toast(`${result.nextInQueue.username} is next in queue`, 'info');
    loadInventory();
  } catch (err) { toast(err.error || 'Check-in failed', 'error'); }
}

async function manualSearchItems() {
  const q = (document.getElementById('manualSearch')?.value || '').trim();
  const container = document.getElementById('manualResults');
  if (!q) { if (container) container.innerHTML = ''; return; }

  // First try exact barcode lookup
  try {
    const { item } = await api(`/api/equipment/lookup?code=${encodeURIComponent(q)}`);
    if (container) container.innerHTML = '';
    showScanResult(item);
    return;
  } catch {}

  // Fall back to text search on loaded items
  const results = _allItems.filter(i =>
    (i.name || '').toLowerCase().includes(q.toLowerCase()) ||
    (i.barcode || '').toLowerCase().includes(q.toLowerCase()) ||
    (i.serial_number || '').toLowerCase().includes(q.toLowerCase())
  );
  if (!container) return;
  if (!results.length) {
    container.innerHTML = `<div style="color:var(--text-muted);padding:8px;font-size:13px">No items found</div>`;
    return;
  }
  container.innerHTML = results.slice(0, 10).map(item =>
    `<div onclick="showScanResult(${JSON.stringify(item).replace(/"/g, '&quot;')})"
       style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px">${esc(item.name)}</span>
      <span style="font-family:var(--mono);font-size:11px;color:var(--text-muted)">${esc(item.barcode || item.serial_number || '')}</span>
    </div>`
  ).join('');
}

// ─── OVERDUE ──────────────────────────────────────────────────────────────────
async function loadOverdue() {
  const container = document.getElementById('overdueList');
  if (!container) return;
  try {
    const { items } = await api('/api/admin/overdue');
    if (!items.length) {
      container.innerHTML = '<div class="empty-state"><p>No overdue items 🎉</p></div>';
      return;
    }
    container.innerHTML = items.map(item => `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px">
        <div style="font-weight:600;margin-bottom:4px">${esc(item.name)}</div>
        <div style="font-size:13px;margin-bottom:8px">
          Checked out by: <strong>${esc(item.checked_out_username)}</strong>
          ${item.checked_out_email ? `<span style="color:var(--text-muted)"> · ${esc(item.checked_out_email)}</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="badge badge-red">${item.days_out} day${item.days_out !== 1 ? 's' : ''} overdue</span>
          <button class="btn-outline btn-sm" onclick="adminCheckin(${item.id})">Return</button>
        </div>
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<div class="empty-state"><p>Failed to load</p></div>';
  }
}

async function adminCheckin(id) {
  try {
    await api(`/api/equipment/${id}/checkin`, { method: 'POST', body: { source: 'Admin' } });
    toast('Returned', 'success');
    loadOverdue();
    updateStats();
  } catch (err) { toast(err.error || 'Failed', 'error'); }
}

// ─── TICKETS ──────────────────────────────────────────────────────────────────
let _ticketFilter = 'all';
let _allTickets = [];

async function loadTickets() {
  const container = document.getElementById('ticketList');
  if (!container) return;
  try {
    const { tickets } = await api('/api/tickets');
    _allTickets = tickets;
    renderTicketList();
    updateTicketBadge(tickets);
  } catch {
    container.innerHTML = '<div class="empty-state"><p>Failed to load tickets</p></div>';
  }
}

function updateTicketBadge(tickets) {
  const count = (tickets || _allTickets).filter(t => t.status === 'open' || t.status === 'in_progress').length;
  const badge = document.getElementById('ticketBadge');
  if (badge) { badge.textContent = count; badge.classList.toggle('hidden', count === 0); }
}

function setTicketFilter(status) {
  _ticketFilter = status;
  document.querySelectorAll('#ticketStatusChips .chip').forEach(el => {
    el.classList.toggle('active', el.dataset.tstatus === status);
  });
  renderTicketList();
}

function renderTicketList() {
  const container = document.getElementById('ticketList');
  if (!container) return;
  const filtered = _ticketFilter === 'all' ? _allTickets : _allTickets.filter(t => t.status === _ticketFilter);
  if (!filtered.length) {
    container.innerHTML = '<div class="empty-state"><p>No tickets</p></div>';
    return;
  }
  const statusColor = { open: 'var(--accent)', in_progress: 'var(--yellow)', resolved: 'var(--green)' };
  container.innerHTML = filtered.map(t => `
    <div onclick="openTicketDetail(${t.id})"
      style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px;cursor:pointer">
      <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px">
        <span style="font-weight:500;font-size:14px;flex:1">${esc(t.title)}</span>
        <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.05);color:${statusColor[t.status] || 'var(--text-muted)'}">
          ${(t.status || '').replace('_', ' ')}
        </span>
      </div>
      <div style="font-size:11px;color:var(--text-muted)">
        #${t.id}${t.username ? ` · ${esc(t.username)}` : ''} · ${new Date(t.created_at).toLocaleDateString()}
      </div>
    </div>
  `).join('');
}

async function openTicketDetail(id) {
  try {
    const { ticket, comments } = await api(`/api/tickets/${id}`);
    const isAdmin = _currentUser?.role === 'admin';
    const detail = document.getElementById('ticketDetail');
    if (!detail) return;
    detail.classList.remove('hidden');
    detail.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <button class="btn-outline btn-sm" onclick="document.getElementById('ticketDetail').classList.add('hidden')">← Back</button>
        <div style="font-weight:600;font-size:15px;flex:1">${esc(ticket.title)}</div>
        <span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:10px;background:rgba(255,255,255,0.05)">
          ${(ticket.status || '').replace('_', ' ')}
        </span>
      </div>
      ${ticket.description ? `<div style="font-size:13px;margin-bottom:16px;color:var(--text-muted)">${esc(ticket.description)}</div>` : ''}
      ${isAdmin ? `
        <div style="margin-bottom:16px">
          <label style="font-size:12px;color:var(--text-muted)">Status</label>
          <select id="ticketStatusSel" onchange="updateTicketStatus(${id})" style="margin-left:8px;padding:6px 10px;border-radius:6px;border:1px solid var(--border-input);background:var(--bg-base);color:var(--text)">
            <option value="open" ${ticket.status==='open'?'selected':''}>Open</option>
            <option value="in_progress" ${ticket.status==='in_progress'?'selected':''}>In Progress</option>
            <option value="resolved" ${ticket.status==='resolved'?'selected':''}>Resolved</option>
          </select>
        </div>` : ''}
      <div style="border-top:1px solid var(--border);padding-top:12px">
        <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:10px">COMMENTS (${comments.length})</div>
        ${comments.map(c => `
          <div style="margin-bottom:12px;padding:10px 12px;background:var(--bg-base);border-radius:8px">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">${esc(c.username || 'User')} · ${new Date(c.created_at).toLocaleDateString()}</div>
            <div style="font-size:13px">${esc(c.body)}</div>
          </div>
        `).join('')}
        <textarea id="commentBody_${id}" placeholder="Add a comment…"
          style="width:100%;box-sizing:border-box;padding:10px;border-radius:9px;border:1px solid var(--border-input);background:var(--bg-base);color:var(--text);font-size:13px;resize:vertical;min-height:70px;margin-top:8px"></textarea>
        <button class="btn-primary btn-sm" style="margin-top:8px" onclick="submitComment(${id})">Post Comment</button>
      </div>
    `;
  } catch (err) { toast(err.error || 'Failed to load ticket', 'error'); }
}

async function updateTicketStatus(id) {
  const status = document.getElementById('ticketStatusSel')?.value;
  if (!status) return;
  try {
    await api(`/api/tickets/${id}`, { method: 'PUT', body: { status } });
    toast('Status updated', 'success');
    loadTickets();
  } catch (err) { toast(err.error || 'Failed', 'error'); }
}

async function submitComment(ticketId) {
  const body = document.getElementById(`commentBody_${ticketId}`)?.value.trim();
  if (!body) { toast('Comment cannot be empty', 'error'); return; }
  try {
    await api(`/api/tickets/${ticketId}/comments`, { method: 'POST', body: { body } });
    toast('Comment posted', 'success');
    openTicketDetail(ticketId);
  } catch (err) { toast(err.error || 'Failed', 'error'); }
}

function openNewTicketModal() {
  const modal = document.getElementById('modalContent');
  modal.innerHTML = `
    <div class="modal-title">New Ticket</div>
    <div class="modal-body">
      <div class="form-group"><label>Title <span style="color:var(--red)">*</span></label><input id="ticketTitle" class="form-input" autofocus></div>
      <div class="form-group"><label>Description</label>
        <textarea id="ticketDesc" class="form-input" style="min-height:100px;resize:vertical"></textarea>
      </div>
      <div class="form-actions">
        <button class="btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="submitNewTicket()">Submit</button>
      </div>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('open');
}

async function submitNewTicket() {
  const title = document.getElementById('ticketTitle')?.value.trim();
  const description = document.getElementById('ticketDesc')?.value.trim();
  if (!title) { toast('Title is required', 'error'); return; }
  try {
    await api('/api/tickets', { method: 'POST', body: { title, description } });
    toast('Ticket submitted', 'success');
    closeModal();
    loadTickets();
  } catch (err) { toast(err.error || 'Failed to submit ticket', 'error'); }
}

// ─── USERS (admin) ────────────────────────────────────────────────────────────
async function loadUsers() {
  const container = document.getElementById('usersList');
  if (!container) return;
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
        ${u.student_group && u.student_group !== 'none'
          ? `<span class="role-badge" style="background:rgba(139,92,246,0.15);color:#a78bfa">${u.student_group === 'allday' ? 'All Day' : u.student_group.toUpperCase()}</span>`
          : ''}
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
          <button class="btn-outline btn-sm" onclick="changeUserGroup(${u.id}, '${u.student_group || 'none'}')">Change Group</button>
          <button class="btn-outline btn-sm" onclick="changeUserEmail(${u.id}, ${JSON.stringify(u.email || '').replace(/"/g, '&quot;')})">Change Email</button>
          <button class="btn-outline btn-sm" onclick="resetUserPw(${u.id})">Reset Password</button>
          <button class="btn-outline btn-sm" style="color:var(--red);border-color:var(--red)" onclick="deleteUser(${u.id})">Delete User</button>
        </div>
        ${data.currentCheckouts && data.currentCheckouts.length > 0 ? `
          <div style="margin-top:16px">
            <h4 style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Current Checkouts (${data.currentCheckouts.length})</h4>
            ${data.currentCheckouts.map(e => `
              <div style="font-size:13px;padding:4px 0">${esc(e.name)}
                <span style="font-family:var(--mono);font-size:11px;color:var(--accent)">${esc(e.barcode)}</span>
              </div>`).join('')}
          </div>` : ''}
      </div>
      <div class="form-actions" style="margin-top:16px">
        <button class="btn-outline" onclick="closeModal()">Close</button>
      </div>
    `;
    document.getElementById('modalOverlay').classList.add('open');
  } catch (err) { toast(err.error || 'Failed', 'error'); }
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
    showTempPassword(tempPassword, 'Password Reset');
  } catch (err) { toast(err.error || 'Failed', 'error'); }
}

function showTempPassword(password, title) {
  document.getElementById('modalContent').innerHTML = `
    <div class="modal-title">${esc(title)}</div>
    <div style="font-size:14px;font-weight:500;margin-bottom:18px">Temporary Password</div>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:14px">
      Copy this password and give it to the user. It won't be shown again once you close this dialog.
    </p>
    <div style="display:flex;gap:8px;align-items:center;background:rgba(3,6,16,0.8);border:1px solid var(--border-input);border-radius:3px;padding:10px 14px;">
      <code id="tmpPwDisplay" style="flex:1;font-family:var(--mono);font-size:14px;font-weight:600;letter-spacing:0.12em;color:var(--accent);filter:blur(5px);user-select:all;transition:filter 0.2s">${esc(password)}</code>
      <button class="btn-outline btn-sm" onclick="toggleTmpPwVisibility()" id="tmpPwToggleBtn" title="Show/hide">👁</button>
      <button class="btn-outline btn-sm" onclick="copyTmpPw(${JSON.stringify(password)})" title="Copy">⎘ Copy</button>
    </div>
    <p style="font-size:11px;color:var(--text-muted);margin-top:8px;font-family:var(--mono)">Click the eye icon to reveal · User must change password on first login</p>
    <div class="form-actions" style="margin-top:20px">
      <button class="btn-primary" onclick="closeModal()">✕ Close</button>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('open');
}

function toggleTmpPwVisibility() {
  const el = document.getElementById('tmpPwDisplay');
  const btn = document.getElementById('tmpPwToggleBtn');
  if (!el) return;
  const isBlurred = el.style.filter !== 'none' && el.style.filter !== '';
  el.style.filter = isBlurred ? 'none' : 'blur(5px)';
  if (btn) btn.textContent = isBlurred ? '🙈' : '👁';
}

function copyTmpPw(password) {
  navigator.clipboard.writeText(password).then(() => {
    toast('Password copied to clipboard', 'success');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = password;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('Password copied to clipboard', 'success');
  });
}

function changeUserEmail(id, currentEmail) {
  const next = prompt('New email address for this user:', currentEmail || '');
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed) { toast('Email cannot be empty', 'error'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    toast("That doesn't look like a valid email", 'error'); return;
  }
  if (trimmed === currentEmail) return;
  api(`/api/admin/users/${id}`, { method: 'PUT', body: { email: trimmed } })
    .then(() => { toast('Email updated', 'success'); closeModal(); loadUsers(); })
    .catch(err => toast(err.error || 'Failed to update email', 'error'));
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

async function changeUserGroup(id, currentGroup) {
  const choice = prompt(
    `Change group for this user:\n  none = No Group\n  am = AM Students\n  pm = PM Students\n  allday = All Day\n\nCurrent: ${currentGroup}\nEnter new group:`,
    currentGroup || 'none'
  );
  if (!choice || choice.trim() === currentGroup) return;
  const g = choice.trim().toLowerCase();
  if (!['am', 'pm', 'allday', 'none'].includes(g)) {
    toast('Invalid group — use: am, pm, allday, or none', 'error'); return;
  }
  try {
    await api(`/api/admin/users/${id}`, { method: 'PUT', body: { student_group: g } });
    toast('Group updated', 'success');
    closeModal();
    loadUsers();
  } catch (err) { toast(err.error || 'Failed', 'error'); }
}

function openCreateUserModal() {
  const modal = document.getElementById('modalContent');
  modal.innerHTML = `
    <div class="modal-title">Add User</div>
    <div class="modal-body">
      <div class="form-group"><label>Username *</label><input id="newUsername" class="form-input" autofocus></div>
      <div class="form-group"><label>Email *</label><input id="newEmail" type="email" class="form-input"></div>
      <div class="form-group">
        <label>Role</label>
        <select id="newRole" style="width:100%;padding:10px 12px;border-radius:9px;background:var(--bg-base);border:1px solid var(--border-input);color:var(--text);font-size:13px">
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div class="form-group">
        <label>Student Group</label>
        <select id="newGroup" style="width:100%;padding:10px 12px;border-radius:9px;background:var(--bg-base);border:1px solid var(--border-input);color:var(--text);font-size:13px">
          <option value="none">No Group (Admin / Staff)</option>
          <option value="am">AM Students (morning only)</option>
          <option value="pm">PM Students (afternoon only)</option>
          <option value="allday">All Day Students</option>
        </select>
      </div>
      <div class="info-strip">A temporary password will be generated and shown to you. Give it to the user directly — they must change it on first login.</div>
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
    const { tempPassword } = await api('/api/admin/users', {
      method: 'POST',
      body: {
        username: document.getElementById('newUsername').value,
        email: document.getElementById('newEmail').value,
        role: document.getElementById('newRole').value,
        student_group: document.getElementById('newGroup').value,
      },
    });
    loadUsers();
    showTempPassword(tempPassword, 'User Created');
  } catch (err) { toast(err.error || 'Failed to create user', 'error'); }
}

// ─── AUDIT LOG (admin) ────────────────────────────────────────────────────────
async function loadAudit() {
  const container = document.getElementById('auditList');
  if (!container) return;
  try {
    const { entries } = await api('/api/admin/audit?limit=200');
    if (!entries.length) {
      container.innerHTML = '<div class="empty-state"><p>No audit log entries</p></div>';
      return;
    }
    container.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:500">Time</th>
            <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:500">User</th>
            <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:500">Action</th>
            <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:500">Target</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map(e => `
            <tr style="border-bottom:1px solid var(--border-subtle)">
              <td style="padding:8px 12px;color:var(--text-muted);font-size:11px;font-family:var(--mono)">${new Date(e.created_at).toLocaleString()}</td>
              <td style="padding:8px 12px">${esc(e.username || '—')}</td>
              <td style="padding:8px 12px;font-family:var(--mono);font-size:11px">${esc(e.action)}</td>
              <td style="padding:8px 12px;font-size:12px">${esc(e.target || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch {
    container.innerHTML = '<div class="empty-state"><p>Failed to load audit log</p></div>';
  }
}

// ─── PASSKEYS ─────────────────────────────────────────────────────────────────
async function loadPasskeys() {
  const container = document.getElementById('passkeysList');
  if (!container) return;
  try {
    const { passkeys } = await api('/api/passkeys');
    if (!passkeys.length) {
      container.innerHTML = '<div class="empty-state"><p>No passkeys registered yet.</p></div>';
      return;
    }
    container.innerHTML = passkeys.map(pk => `
      <div style="display:flex;align-items:center;gap:12px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px">
        <div style="flex:1">
          <div style="font-weight:500">${esc(pk.credential_name || 'Passkey')}</div>
          <div style="font-size:12px;color:var(--text-muted)">Added ${new Date(pk.created_at).toLocaleDateString()}</div>
        </div>
        <button class="btn-outline btn-sm" style="color:var(--red);border-color:var(--red)"
          onclick="deletePasskey(${JSON.stringify(pk.credential_id)})">Remove</button>
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<div class="empty-state"><p>Failed to load passkeys</p></div>';
  }
}

async function registerPasskey() {
  try {
    const SWA = window.SimpleWebAuthnBrowser;
    if (!SWA) { toast('WebAuthn not available', 'error'); return; }
    const { options } = await api('/api/passkeys/register/begin', { method: 'POST' });
    const response = await SWA.startRegistration(options);
    const name = prompt('Name this passkey (e.g. "MacBook Touch ID"):') || 'Passkey';
    await api('/api/passkeys/register/finish', { method: 'POST', body: { response, name } });
    toast('Passkey registered!', 'success');
    loadPasskeys();
  } catch (err) {
    if (err?.name === 'NotAllowedError') { toast('Registration cancelled', 'info'); return; }
    toast(err?.error || err?.message || 'Failed to register passkey', 'error');
  }
}

async function deletePasskey(credentialId) {
  if (!confirm('Remove this passkey?')) return;
  try {
    await api(`/api/passkeys/${encodeURIComponent(credentialId)}`, { method: 'DELETE' });
    toast('Passkey removed', 'info');
    loadPasskeys();
  } catch (err) { toast(err.error || 'Failed', 'error'); }
}

// ─── LOCATIONS (admin) ────────────────────────────────────────────────────────
let _allLocations = [];

async function loadLocations() {
  const container = document.getElementById('locationsList');
  if (!container) return;
  try {
    const { locations } = await api('/api/admin/locations');
    _allLocations = locations;
    if (!locations.length) {
      container.innerHTML = '<div class="empty-state"><p>No locations yet. Add your first location above.</p></div>';
      return;
    }
    container.innerHTML = locations.map(loc => `
      <div class="user-row" onclick="openEditLocationModal(${loc.id})" style="cursor:pointer">
        <div class="user-info">
          <div class="user-name">${esc(loc.name)}</div>
          <div class="user-email">${[loc.building, loc.room].filter(Boolean).join(' · ') || '—'}</div>
        </div>
        ${loc.description
          ? `<span style="font-size:11px;color:var(--text-muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(loc.description)}</span>`
          : ''}
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<div class="empty-state"><p>Failed to load locations</p></div>';
  }
}

function openCreateLocationModal() {
  const modal = document.getElementById('modalContent');
  modal.innerHTML = `
    <div class="modal-title">Add Location</div>
    <div class="form-group">
      <label class="form-label">Name <span style="color:var(--red)">*</span></label>
      <input id="locName" class="form-input" placeholder="e.g. Main Lab" autofocus>
    </div>
    <div class="form-group">
      <label class="form-label">Building</label>
      <input id="locBuilding" class="form-input" placeholder="e.g. Building A">
    </div>
    <div class="form-group">
      <label class="form-label">Room</label>
      <input id="locRoom" class="form-input" placeholder="e.g. Room 101">
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <input id="locDesc" class="form-input" placeholder="Optional notes about this location">
    </div>
    <div class="form-actions">
      <button class="btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="submitCreateLocation()">Add Location</button>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('open');
}

async function submitCreateLocation() {
  const name = document.getElementById('locName')?.value.trim();
  if (!name) { toast('Name is required', 'error'); return; }
  try {
    await api('/api/admin/locations', {
      method: 'POST',
      body: {
        name,
        building:    document.getElementById('locBuilding')?.value.trim() || null,
        room:        document.getElementById('locRoom')?.value.trim() || null,
        description: document.getElementById('locDesc')?.value.trim() || null,
      },
    });
    toast('Location added', 'success');
    closeModal();
    loadLocations();
  } catch (err) { toast(err.error || 'Failed to add location', 'error'); }
}

async function openEditLocationModal(id) {
  const loc = _allLocations.find(l => l.id === id);
  if (!loc) { toast('Location not found', 'error'); return; }
  const modal = document.getElementById('modalContent');
  modal.innerHTML = `
    <div class="modal-title">Edit Location</div>
    <div class="form-group">
      <label class="form-label">Name <span style="color:var(--red)">*</span></label>
      <input id="locName" class="form-input" value="${esc(loc.name)}">
    </div>
    <div class="form-group">
      <label class="form-label">Building</label>
      <input id="locBuilding" class="form-input" value="${esc(loc.building || '')}">
    </div>
    <div class="form-group">
      <label class="form-label">Room</label>
      <input id="locRoom" class="form-input" value="${esc(loc.room || '')}">
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <input id="locDesc" class="form-input" value="${esc(loc.description || '')}">
    </div>
    <div class="form-actions" style="justify-content:space-between">
      <button class="btn-outline btn-sm" style="color:var(--red);border-color:var(--red)" onclick="deleteLocation(${loc.id})">Delete</button>
      <div style="display:flex;gap:8px">
        <button class="btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="submitEditLocation(${loc.id})">Save Changes</button>
      </div>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('open');
}

async function submitEditLocation(id) {
  const name = document.getElementById('locName')?.value.trim();
  if (!name) { toast('Name is required', 'error'); return; }
  try {
    await api(`/api/admin/locations/${id}`, {
      method: 'PUT',
      body: {
        name,
        building:    document.getElementById('locBuilding')?.value.trim() || null,
        room:        document.getElementById('locRoom')?.value.trim() || null,
        description: document.getElementById('locDesc')?.value.trim() || null,
      },
    });
    toast('Location updated', 'success');
    closeModal();
    loadLocations();
  } catch (err) { toast(err.error || 'Failed to update', 'error'); }
}

async function deleteLocation(id) {
  if (!confirm('Delete this location? This cannot be undone.')) return;
  try {
    await api(`/api/admin/locations/${id}`, { method: 'DELETE' });
    toast('Location deleted', 'success');
    closeModal();
    loadLocations();
  } catch (err) { toast(err.error || 'Failed to delete', 'error'); }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();

  // Login form submit
  document.getElementById('loginForm')?.addEventListener('submit', handleLoginSubmit);

  // Passkey login button
  document.getElementById('passkeyLoginBtn')?.addEventListener('click', loginWithPasskey);
});
