'use strict';

let device = null;
let activeCall = null;
let currentProspect = null;
let prospects = [];
let callDuration = 0;
let timerInterval = null;
let callLogged = false;

const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadProspects(), loadStats(), loadCallLog()]);

  $('btn-call').addEventListener('click', startCall);
  $('btn-hangup').addEventListener('click', hangUp);
  $('btn-next').addEventListener('click', nextProspect);
  $('btn-add-prospect').addEventListener('click', () => showModal('add-modal'));
  $('btn-remove-prospect').addEventListener('click', removeCurrentProspect);
  $('btn-manual-log').addEventListener('click', () => {
    if (!currentProspect) return alert('Select a prospect first.');
    $('outcome-section').classList.add('show');
  });
  $('btn-dismiss-outcome').addEventListener('click', () => {
    $('outcome-section').classList.remove('show');
    $('callback-date-row').style.display = 'none';
  });
  $('form-add').addEventListener('submit', addProspect);
  $('btn-import').addEventListener('click', () => $('csv-input').click());
  $('csv-input').addEventListener('change', importCSV);

  document.querySelectorAll('.btn-outcome').forEach(btn => {
    btn.addEventListener('click', () => logOutcome(btn.dataset.outcome));
  });

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => hideModal(btn.dataset.close));
  });

  // Callback date row visibility
  document.querySelector('.outcome-callback').addEventListener('click', () => {
    $('callback-date-row').style.display = 'flex';
  });
});

// ── Twilio ─────────────────────────────────────────────────────────────────
async function initTwilio() {
  const badge = $('twilio-badge');
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    if (!config.twilioReady) {
      badge.textContent = 'Twilio not configured';
      badge.className = 'badge-status warn';
      setStatus('Twilio not configured — see SETUP.md', 'no-twilio');
      return;
    }

    const tokenRes = await fetch('/token', { method: 'POST' });
    const { token } = await tokenRes.json();

    device = new Twilio.Device(token, { codecPreferences: ['opus', 'pcmu'] });

    device.on('ready', () => {
      setStatus('Ready', 'ready');
      badge.textContent = config.callerNumber || 'Twilio connected';
      badge.className = 'badge-status ok';
    });
    device.on('error', err => {
      const msg = err.message || '';
      if (msg.includes('31486') || msg.includes('unverified')) {
        setStatus('Trial limit: verify this number in Twilio console first', 'error');
      } else if (msg.includes('31401') || msg.includes('auth')) {
        setStatus('Auth error — check API key in .env', 'error');
      } else {
        setStatus(`Error ${err.code || ''}: ${msg}`, 'error');
      }
      console.error('Twilio error:', err);
    });

    await device.register();
  } catch (err) {
    badge.textContent = 'Twilio error';
    badge.className = 'badge-status warn';
    setStatus('Twilio init failed — check console', 'error');
    console.error(err);
  }
}

// ── Prospects ──────────────────────────────────────────────────────────────
async function loadProspects() {
  const res = await fetch('/api/prospects');
  prospects = await res.json();
  renderQueue();

  if (!currentProspect && prospects.length > 0) {
    const first = prospects.find(p => !p.status || p.status === 'active') || prospects[0];
    setCurrentProspect(first);
  }
}

function renderQueue() {
  const list = $('prospect-list');
  const active = prospects.filter(p => !p.status || p.status === 'active');
  const callbacks = prospects.filter(p => p.status === 'callback');

  $('queue-count').textContent = active.length + callbacks.length;
  $('stat-queue').textContent = active.length;

  list.innerHTML = '';

  if (callbacks.length) {
    list.innerHTML += `<div class="queue-section-label">Callbacks (${callbacks.length})</div>`;
    callbacks.forEach(p => list.innerHTML += card(p));
  }
  if (active.length) {
    list.innerHTML += `<div class="queue-section-label">Queue (${active.length})</div>`;
    active.forEach(p => list.innerHTML += card(p));
  }
  if (!active.length && !callbacks.length) {
    list.innerHTML = '<div class="empty-state">Queue empty! Add prospects to get started.</div>';
  }

  list.querySelectorAll('.prospect-card').forEach(el => {
    el.addEventListener('click', () => {
      const p = prospects.find(x => x.id == el.dataset.id);
      if (p) setCurrentProspect(p);
    });
  });
}

function card(p) {
  const isActive = currentProspect && currentProspect.id === p.id;
  return `
    <div class="prospect-card ${isActive ? 'active' : ''} ${p.status === 'callback' ? 'callback' : ''}" data-id="${p.id}">
      <div class="pc-name">${esc(p.name)}</div>
      <div class="pc-phone">${fmtPhone(p.phone)}</div>
      ${p.company ? `<div class="pc-company">${esc(p.company)}</div>` : ''}
    </div>`;
}

function setCurrentProspect(p) {
  currentProspect = p;
  const initials = (p.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  $('prospect-avatar').textContent = initials;
  $('current-name').textContent = p.name || 'Unknown';
  $('current-phone').textContent = fmtPhone(p.phone);
  $('current-company').textContent = p.company || '';
  $('current-email').textContent = p.email || '';
  $('call-notes').value = '';
  $('outcome-section').classList.remove('show');
  callLogged = false;

  if (device) $('btn-call').disabled = false;

  document.querySelectorAll('.prospect-card').forEach(el => {
    el.classList.toggle('active', el.dataset.id == p.id);
  });
  const el = document.querySelector(`.prospect-card[data-id="${p.id}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function nextProspect() {
  const available = prospects.filter(p => !p.status || p.status === 'active' || p.status === 'callback');
  if (!available.length) { setStatus('Queue empty!', 'ready'); return; }
  const idx = available.findIndex(p => currentProspect && p.id === currentProspect.id);
  setCurrentProspect(available[(idx + 1) % available.length]);
}

async function removeCurrentProspect() {
  if (!currentProspect) return;
  if (!confirm(`Remove ${currentProspect.name || currentProspect.phone} from the queue?`)) return;
  await fetch(`/api/prospects/${currentProspect.id}`, { method: 'DELETE' });
  currentProspect = null;
  await loadProspects();
}

// ── Calling ────────────────────────────────────────────────────────────────
let twilioInitPromise = null;

async function startCall() {
  if (!currentProspect || activeCall) return;
  if (!device) {
    if (!twilioInitPromise) twilioInitPromise = initTwilio();
    await twilioInitPromise;
    if (!device) return;
  }

  try {
    $('btn-call').disabled = true;
    setStatus('Connecting...', 'connecting');

    activeCall = await device.connect({ params: { To: currentProspect.phone } });

    activeCall.on('ringing', () => setStatus('Ringing...', 'ringing'));
    activeCall.on('accept', () => {
      setStatus('Connected', 'active');
      $('btn-call').style.display = 'none';
      $('btn-hangup').style.display = '';
      startTimer();
    });
    activeCall.on('disconnect', onCallEnd);
    activeCall.on('reject', () => {
      activeCall = null;
      $('btn-call').disabled = false;
      setStatus('Call rejected', 'ended');
    });
    activeCall.on('error', err => {
      activeCall = null;
      $('btn-call').disabled = false;
      const msg = err.message || '';
      if (msg.includes('unverified') || err.code === 13224) {
        setStatus('Trial limit: verify this number at twilio.com/console first', 'error');
      } else {
        setStatus(`Call error ${err.code || ''}: ${msg}`, 'error');
      }
      console.error('Call error:', err);
    });
  } catch (err) {
    console.error(err);
    activeCall = null;
    $('btn-call').disabled = false;
    setStatus('Failed to connect', 'error');
  }
}

function hangUp() {
  if (activeCall) activeCall.disconnect();
}

function onCallEnd() {
  stopTimer();
  activeCall = null;
  $('btn-call').disabled = false;
  $('btn-call').style.display = '';
  $('btn-hangup').style.display = 'none';
  if (!callLogged) {
    setStatus('Call ended — log the outcome', 'ended');
    $('outcome-section').classList.add('show');
  }
}

// ── Outcome logging ────────────────────────────────────────────────────────
async function logOutcome(outcome) {
  if (!currentProspect) return;

  callLogged = true;
  const notes = $('call-notes').value.trim();
  const callbackDate = $('callback-date').value;

  await fetch('/api/calls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prospect_id: currentProspect.id,
      duration: callDuration,
      outcome,
      notes: notes || null,
      callback_date: callbackDate || null,
    }),
  });

  $('outcome-section').classList.remove('show');
  $('callback-date-row').style.display = 'none';
  $('callback-date').value = '';
  resetTimer();

  await Promise.all([loadProspects(), loadStats(), loadCallLog()]);

  if ($('power-dial-toggle').checked && outcome !== 'dnc') {
    nextProspect();
    setTimeout(startCall, 600);
  } else {
    nextProspect();
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────
async function loadStats() {
  const res = await fetch('/api/stats');
  const { today } = await res.json();
  $('stat-total').textContent     = today.total;
  $('stat-answered').textContent  = today.answered;
  $('stat-converted').textContent = today.converted;
}

// ── Call Log ───────────────────────────────────────────────────────────────
async function loadCallLog() {
  const res = await fetch('/api/calls');
  const calls = await res.json();
  const log = $('call-log');

  if (!calls.length) {
    log.innerHTML = '<div class="empty-state">No calls yet today.</div>';
    return;
  }

  const icons = { answered:'✓', voicemail:'📬', no_answer:'✗', callback:'📅', converted:'⭐', dnc:'🚫' };

  log.innerHTML = calls.slice(0, 30).map(c => `
    <div class="log-item">
      <div class="log-icon">${icons[c.outcome] || '•'}</div>
      <div>
        <div class="log-name">${esc(c.name)}</div>
        <div class="log-meta">${c.outcome.replace('_',' ')} · ${fmtDur(c.duration)} · ${timeAgo(c.called_at)}</div>
        ${c.notes ? `<div class="log-note">${esc(c.notes)}</div>` : ''}
      </div>
    </div>`).join('');
}

// ── Prospect management ────────────────────────────────────────────────────
async function addProspect(e) {
  e.preventDefault();
  const f = e.target;
  const data = {
    name:    f.querySelector('[name=name]').value,
    phone:   f.querySelector('[name=phone]').value,
    company: f.querySelector('[name=company]').value,
    email:   f.querySelector('[name=email]').value,
    notes:   f.querySelector('[name=notes]').value,
  };
  await fetch('/api/prospects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  f.reset();
  hideModal('add-modal');
  await loadProspects();
}

async function importCSV(e) {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/import', { method: 'POST', body: fd });
  const { imported, error } = await res.json();
  if (error) { alert('Import error: ' + error); }
  else { alert(`Imported ${imported} prospect${imported !== 1 ? 's' : ''}.`); }
  e.target.value = '';
  await loadProspects();
}

// ── Timer ──────────────────────────────────────────────────────────────────
function startTimer() {
  callDuration = 0;
  const start = Date.now();
  timerInterval = setInterval(() => {
    callDuration = Math.floor((Date.now() - start) / 1000);
    $('call-timer').textContent = fmtDur(callDuration);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function resetTimer() {
  stopTimer();
  callDuration = 0;
  $('call-timer').textContent = '0:00';
}

// ── Modal helpers ──────────────────────────────────────────────────────────
function showModal(id) { $(id).style.display = 'flex'; }
function hideModal(id) { $(id).style.display = 'none'; }

// ── Utils ──────────────────────────────────────────────────────────────────
function setStatus(msg, type) {
  const el = $('call-status');
  el.textContent = msg;
  el.className = `call-status status-${type}`;
}

function fmtPhone(p) {
  const d = ('' + p).replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return p;
}

function fmtDur(s) {
  return `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
}

function timeAgo(str) {
  const diff = Math.floor((Date.now() - new Date(str)) / 1000);
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return new Date(str).toLocaleDateString();
}

function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
