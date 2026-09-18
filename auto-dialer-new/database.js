const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'dialer.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; }
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

function init() {
  const existing = load();
  if (existing) return existing;
  const fresh = { prospects: [], calls: [], nextProspectId: 1, nextCallId: 1 };
  save(fresh);
  return fresh;
}

let _data = init();

function persist() { save(_data); }

function now() { return new Date().toISOString(); }

// ── Prospects ──────────────────────────────────────────────────────────────
function getProspects() {
  return _data.prospects.map(p => ({
    ...p,
    call_count: _data.calls.filter(c => c.prospect_id === p.id).length,
  })).reverse();
}

function insertProspect({ name, phone, company, email, notes }) {
  const id = _data.nextProspectId++;
  _data.prospects.push({ id, name, phone, company: company || null, email: email || null, notes: notes || null, status: 'active', last_called: null, created_at: now() });
  persist();
  return id;
}

function deleteProspect(id) {
  _data.prospects = _data.prospects.filter(p => p.id !== id);
  persist();
}

function updateProspectStatus(id, status) {
  const p = _data.prospects.find(p => p.id === id);
  if (p) { p.status = status; p.last_called = now(); persist(); }
}

// ── Calls ──────────────────────────────────────────────────────────────────
function insertCall({ prospect_id, duration, outcome, notes, callback_date }) {
  const id = _data.nextCallId++;
  _data.calls.push({ id, prospect_id, duration: duration || 0, outcome, notes: notes || null, callback_date: callback_date || null, called_at: now() });
  persist();
  return id;
}

function getCalls(limit = 100) {
  return [..._data.calls]
    .reverse()
    .slice(0, limit)
    .map(c => {
      const p = _data.prospects.find(p => p.id === c.prospect_id) || {};
      return { ...c, name: p.name, phone: p.phone, company: p.company };
    });
}

// ── Stats ──────────────────────────────────────────────────────────────────
function getTodayStats() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayCalls = _data.calls.filter(c => c.called_at.startsWith(todayStr));
  return {
    total:    todayCalls.length,
    answered: todayCalls.filter(c => c.outcome === 'answered').length,
    converted:todayCalls.filter(c => c.outcome === 'converted').length,
    callbacks:todayCalls.filter(c => c.outcome === 'callback').length,
    total_seconds: todayCalls.reduce((s, c) => s + (c.duration || 0), 0),
  };
}

function getQueueStats() {
  const ps = _data.prospects;
  return {
    total:    ps.length,
    active:   ps.filter(p => !p.status || p.status === 'active').length,
    callbacks:ps.filter(p => p.status === 'callback').length,
    dnc:      ps.filter(p => p.status === 'dnc').length,
    converted:ps.filter(p => p.status === 'converted').length,
  };
}

module.exports = { getProspects, insertProspect, deleteProspect, updateProspectStatus, insertCall, getCalls, getTodayStats, getQueueStats };
