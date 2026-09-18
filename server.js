require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const db = require('./database');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(require('path').join(__dirname, 'public')));

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_API_KEY,
  TWILIO_API_SECRET,
  TWILIO_TWIML_APP_SID,
  TWILIO_PHONE_NUMBER,
} = process.env;

const twilioReady = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_API_KEY && TWILIO_API_SECRET && TWILIO_TWIML_APP_SID);

// ── Twilio ─────────────────────────────────────────────────────────────────
app.post('/token', (req, res) => {
  if (!twilioReady) return res.status(503).json({ error: 'Twilio not configured' });

  const { AccessToken } = twilio.jwt;
  const { VoiceGrant } = AccessToken;

  const grant = new VoiceGrant({ outgoingApplicationSid: TWILIO_TWIML_APP_SID, incomingAllow: false });
  const token = new AccessToken(TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, { identity: 'dialer-agent', ttl: 3600 });
  token.addGrant(grant);

  res.json({ token: token.toJwt() });
});

app.post('/voice', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const to = req.body.To;
  if (to) {
    const dial = twiml.dial({ callerId: TWILIO_PHONE_NUMBER, timeout: 30 });
    dial.number(to);
  } else {
    twiml.say('No number provided.');
  }
  res.type('text/xml');
  res.send(twiml.toString());
});

app.get('/api/config', (req, res) => {
  res.json({ twilioReady, callerNumber: TWILIO_PHONE_NUMBER || null });
});

// ── Prospects ──────────────────────────────────────────────────────────────
app.get('/api/prospects', (req, res) => {
  res.json(db.getProspects());
});

app.post('/api/prospects', (req, res) => {
  const { name, phone, company, email, notes } = req.body;
  const id = db.insertProspect({ name, phone, company, email, notes });
  res.json({ id });
});

app.delete('/api/prospects/:id', (req, res) => {
  db.deleteProspect(Number(req.params.id));
  res.json({ success: true });
});

app.put('/api/prospects/:id/status', (req, res) => {
  db.updateProspectStatus(Number(req.params.id), req.body.status);
  res.json({ success: true });
});

app.post('/api/import', upload.single('file'), (req, res) => {
  try {
    const records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
    let imported = 0;
    for (const r of records) {
      const keys = Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase().trim(), v]));
      const phone = keys.phone || keys.phone_number || keys.mobile || keys.cell || '';
      const name  = keys.name  || keys.full_name   || keys.first_name || '';
      if (phone) {
        db.insertProspect({ name, phone, company: keys.company || keys.business || null, email: keys.email || null, notes: null });
        imported++;
      }
    }
    res.json({ imported });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Calls ──────────────────────────────────────────────────────────────────
app.post('/api/calls', (req, res) => {
  const { prospect_id, duration, outcome, notes, callback_date } = req.body;
  const id = db.insertCall({ prospect_id: Number(prospect_id), duration, outcome, notes, callback_date });

  const statusMap = { answered:'active', voicemail:'active', no_answer:'active', callback:'callback', dnc:'dnc', converted:'converted' };
  if (statusMap[outcome]) db.updateProspectStatus(Number(prospect_id), statusMap[outcome]);

  res.json({ id });
});

app.get('/api/calls', (req, res) => {
  res.json(db.getCalls());
});

// ── Stats ──────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  res.json({ today: db.getTodayStats(), queue: db.getQueueStats() });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Auto Dialer → http://localhost:${PORT}`);
    if (!twilioReady) {
      console.log('  ⚠  Twilio not configured — add env vars to enable calling');
      return;
    }
    setupWebhook();
  });
}

module.exports = app;

async function setupWebhook() {
  const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  // On Railway, a public domain is provided automatically
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    const voiceUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/voice`;
    await twilioClient.applications(TWILIO_TWIML_APP_SID).update({ voiceUrl, voiceMethod: 'POST' });
    console.log(`  Webhook: ${voiceUrl}`);
    console.log('  ✓ Ready to make calls!');
    return;
  }

  // Local: use Cloudflare tunnel
  startTunnel(twilioClient);
}

function startTunnel(twilioClient) {
  const { spawn } = require('child_process');
  const path = require('path');
  const cfBin = path.join(__dirname, 'node_modules', '.bin', 'cloudflared.cmd');

  console.log('  Starting Cloudflare tunnel...');
  const cf = spawn('cmd.exe', ['/c', cfBin, 'tunnel', '--url', `http://localhost:${PORT}`], { windowsHide: true });

  let urlFound = false;

  function parseLine(line) {
    if (urlFound) return;
    const match = line.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/);
    if (match) {
      urlFound = true;
      const voiceUrl = `${match[0]}/voice`;
      console.log(`  Tunnel: ${match[0]}`);
      twilioClient.applications(TWILIO_TWIML_APP_SID)
        .update({ voiceUrl, voiceMethod: 'POST' })
        .then(() => console.log(`  TwiML App updated → ${voiceUrl}\n  ✓ Ready to make calls!`))
        .catch(err => console.error('  Failed to update TwiML App:', err.message));
    }
  }

  cf.stdout.on('data', d => d.toString().split('\n').forEach(parseLine));
  cf.stderr.on('data', d => d.toString().split('\n').forEach(parseLine));
  cf.on('close', code => {
    console.log(`  Tunnel closed (${code}) — restarting in 3s...`);
    setTimeout(() => startTunnel(twilioClient), 3000);
  });
}
