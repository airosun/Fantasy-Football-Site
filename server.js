const path = require('path');
const express = require('express');
const { refreshSeason, nflSeason } = require('./espn');
const stats = require('./stats');

const app = express();
// Optional override: SEASONS=2024,2025,2026. Without it, every season the league has is found automatically.
const explicit = (process.env.SEASONS || '').split(',').map((s) => s.trim()).filter(Boolean);
const state = {};
const errors = {};
let discovering = !explicit.length;
let known = [...explicit];

async function load(s) {
  try {
    state[s] = await refreshSeason(s, state[s]);
    delete errors[s];
    console.log(`Loaded ${s} (week ${state[s].current})`);
    return true;
  } catch (e) {
    errors[s] = e.message;
    console.error(`Load failed for ${s}:`, e.message);
    return false;
  }
}

// Walk backwards from the current season until the league stops existing.
async function discover() {
  const found = [];
  for (let y = nflSeason(); y >= 2010; y--) {
    const ok = await load(String(y));
    if (ok) { found.push(String(y)); known = [...found]; }
    else if (found.length) break;   // gap after finding seasons = league started the year after
  }
  discovering = false;
  console.log(`Seasons found: ${known.join(', ') || 'none'}`);
}

async function refreshAll() {
  for (const s of known) {
    if (state[s]?.finished) continue;   // finished seasons never change
    await load(s);
  }
}

(async () => {
  if (explicit.length) { for (const s of explicit) await load(s); }
  else await discover();
  setInterval(refreshAll, 15 * 60 * 1000); // scores and the Wednesday week change are picked up automatically
})();

const loaded = () => known.filter((s) => state[s]).sort((a, b) => b - a);

const need = (req, res, next) => {
  const S = state[req.params.season];
  if (!S) return res.status(503).json({ error: errors[req.params.season] || 'Data is still loading. Try again in a minute.' });
  req.S = S;
  next();
};

app.get('/api/seasons', (req, res) => {
  const seasons = loaded();
  res.json({ seasons, default: seasons[0], loading: discovering });
});
app.get('/api/:season/info', need, (req, res) => res.json(stats.info(req.S)));
app.get('/api/:season/week/:w', need, (req, res) => {
  const w = +req.params.w;
  if (!req.S.weeks[w]) return res.status(404).json({ error: 'Week not found' });
  res.json(stats.weekView(req.S, w));
});
app.get('/api/:season/standings', need, (req, res) => res.json(stats.standings(req.S)));
app.get('/api/:season/manager/:id', need, (req, res) => {
  const m = stats.managerView(req.S, +req.params.id);
  m ? res.json(m) : res.status(404).json({ error: 'Manager not found' });
});

app.use(express.static(path.join(__dirname, 'public')));
app.listen(process.env.PORT || 3000, () => console.log('Listening'));
