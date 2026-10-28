const path = require('path');
const express = require('express');
const { refreshSeason } = require('./espn');
const stats = require('./stats');

const app = express();
const seasons = (process.env.SEASONS || String(new Date().getFullYear())).split(',').map((s) => s.trim());
const state = {};
const errors = {};

async function refreshAll() {
  for (const s of seasons) {
    try {
      state[s] = await refreshSeason(s, state[s]);
      delete errors[s];
      console.log(`Refreshed ${s} (week ${state[s].current})`);
    } catch (e) {
      errors[s] = e.message;
      console.error(`Refresh failed for ${s}:`, e.message);
    }
  }
}
refreshAll();
setInterval(refreshAll, 15 * 60 * 1000); // scores and the Wednesday week change are picked up automatically

const need = (req, res, next) => {
  const S = state[req.params.season];
  if (!S) return res.status(503).json({ error: errors[req.params.season] || 'Data is still loading. Try again in a minute.' });
  req.S = S;
  next();
};

app.get('/api/seasons', (req, res) => res.json({ seasons, default: seasons[seasons.length - 1] }));
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
