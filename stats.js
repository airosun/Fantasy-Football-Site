const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST' };
const GROUPS = ['QB', 'RB', 'WR', 'TE', 'D/ST', 'K'];
const BENCH = new Set([20, 21]); // bench, IR
// lineup slot id -> eligible position ids (0 QB, 2 RB, 4 WR, 6 TE, 16 D/ST, 17 K, 23 FLEX, 3 RB/WR, 5 WR/TE, 7 OP)
const ELIG = { 0: [1], 2: [2], 3: [2, 3], 4: [3], 5: [3, 4], 6: [4], 7: [1, 2, 3, 4], 16: [16], 17: [5], 23: [2, 3, 4] };

const r1 = (n) => Math.round(n * 10) / 10;

// Best possible lineup from a full roster, using this league's own lineup slots.
function optimal(players, slotCounts) {
  const slots = [];
  Object.entries(slotCounts).forEach(([s, c]) => {
    if (ELIG[s]) for (let i = 0; i < c; i++) slots.push(+s);
  });
  slots.sort((a, b) => ELIG[a].length - ELIG[b].length);
  const pool = players.filter((p) => p.slot !== 21).sort((a, b) => b.pts - a.pts);
  const used = new Set();
  let total = 0;
  for (const s of slots) {
    const p = pool.find((x) => !used.has(x.id) && ELIG[s].includes(x.pos));
    if (p) { used.add(p.id); total += p.pts; }
  }
  return total;
}

function teamWeek(S, sd) {
  const starters = sd.players.filter((p) => !BENCH.has(p.slot));
  const groups = Object.fromEntries(GROUPS.map((g) => [g, 0]));
  starters.forEach((p) => { if (POS[p.pos]) groups[POS[p.pos]] += p.pts; });
  const potential = optimal(sd.players, S.slotCounts);
  return { teamId: sd.teamId, score: sd.score, potential, pct: potential ? (sd.score / potential) * 100 : 0, groups, starters, bench: sd.players.filter((p) => BENCH.has(p.slot)) };
}

const team = (S, id) => S.teams.find((t) => t.id === id) || { id, name: `Team ${id}`, manager: '' };
const rec = (w, l, t) => ({ w, l, t, str: t ? `${w}-${l}-${t}` : `${w}-${l}` });

function weekView(S, w) {
  const games = S.weeks[w];
  const all = games.flatMap((g) => [g.home.score, g.away.score]);
  const shape = (sd) => {
    const tw = teamWeek(S, sd);
    const tm = team(S, sd.teamId);
    // compare against the other teams only (remove this team's own score once)
    const others = [...all]; others.splice(others.indexOf(sd.score), 1);
    let W = 0, L = 0, T = 0;
    others.forEach((o) => (sd.score > o ? W++ : sd.score < o ? L++ : T++));
    return { ...tw, name: tm.name, manager: tm.manager, total: rec(W, L, T) };
  };
  const cmp = (a, b) => (Math.abs(a - b) < 0.005 ? 'tie' : a > b ? 'home' : 'away');
  return {
    week: w, live: w === S.current && !S.finished,
    games: games.map((g) => {
      const home = shape(g.home), away = shape(g.away);
      return {
        home, away,
        groupWinners: Object.fromEntries(GROUPS.map((k) => [k, cmp(home.groups[k], away.groups[k])])),
        potentialWinner: cmp(home.potential, away.potential),
      };
    }),
  };
}

function info(S) {
  return {
    season: S.season, current: S.current, completed: S.completed, totalWeeks: S.total, updated: S.updated,
    teams: S.teams.map((t) => ({ id: t.id, name: t.name, manager: t.manager })),
  };
}

function standings(S) {
  const rows = Object.fromEntries(S.teams.map((t) => [t.id, { id: t.id, name: t.name, manager: t.manager, w: 0, l: 0, t: 0, tw: 0, tl: 0, tt: 0, pf: 0, pa: 0, ppf: 0, ppa: 0, gp: 0 }]));
  for (let w = 1; w <= S.completed; w++) {
    const games = S.weeks[w] || [];
    const all = games.flatMap((g) => [g.home.score, g.away.score]);
    games.forEach((g) => {
      const a = teamWeek(S, g.home), b = teamWeek(S, g.away);
      [[g.home, a, g.away, b], [g.away, b, g.home, a]].forEach(([me, mw, op, ow]) => {
        const r = rows[me.teamId]; if (!r) return;
        r.gp++; r.pf += me.score; r.pa += op.score; r.ppf += mw.potential; r.ppa += ow.potential;
        me.score > op.score ? r.w++ : me.score < op.score ? r.l++ : r.t++;
        const others = [...all]; others.splice(others.indexOf(me.score), 1);
        others.forEach((o) => (me.score > o ? r.tw++ : me.score < o ? r.tl++ : r.tt++));
      });
    });
  }
  return Object.values(rows).map((r) => ({
    id: r.id, name: r.name, manager: r.manager,
    record: rec(r.w, r.l, r.t).str, winPct: r.gp ? (r.w + r.t / 2) / r.gp : 0,
    totalRecord: rec(r.tw, r.tl, r.tt).str, totalPct: r.tw + r.tl + r.tt ? (r.tw + r.tt / 2) / (r.tw + r.tl + r.tt) : 0,
    pf: r1(r.pf), pa: r1(r.pa), diff: r1(r.pf - r.pa),
    pfpg: r.gp ? r1(r.pf / r.gp) : 0, papg: r.gp ? r1(r.pa / r.gp) : 0,
    ppf: r1(r.ppf), ppa: r1(r.ppa),
    pctPf: r.ppf ? r1((r.pf / r.ppf) * 100) : 0, pctPa: r.ppa ? r1((r.pa / r.ppa) * 100) : 0,
  }));
}

function managerView(S, id) {
  const tm = S.teams.find((t) => t.id === id);
  if (!tm) return null;
  const agg = {}, perf = [];
  for (let w = 1; w <= S.completed; w++) {
    (S.weeks[w] || []).forEach((g) => {
      const sd = [g.home, g.away].find((s) => s.teamId === id);
      if (!sd) return;
      sd.players.forEach((p) => {
        const started = !BENCH.has(p.slot);
        const a = (agg[p.id] ||= { name: p.name, started: 0, total: 0 });
        a.total += p.pts; if (started) a.started += p.pts;
        perf.push({ name: p.name, pts: p.pts, week: w, started });
      });
    });
  }
  const top = (arr, key) => arr.sort((a, b) => b[key] - a[key]).slice(0, 3).map((x) => ({ name: x.name, pts: r1(x[key]) }));
  const list = Object.values(agg);
  const nm = (pid) => S.names[pid] || `Player ${pid}`;
  const transactions = Object.values(S.tx)
    .filter((t) => t.status === 'EXECUTED' && t.type !== 'ROSTER' && (t.teamId === id || (t.items || []).some((i) => i.toTeamId === id || i.fromTeamId === id)))
    .map((t) => ({
      date: t.processDate || t.proposedDate, type: t.type.replace('_', ' ').toLowerCase(),
      lines: (t.items || []).filter((i) => i.type !== 'LINEUP').map((i) => {
        if (i.type === 'ADD') return `Added ${nm(i.playerId)}`;
        if (i.type === 'DROP') return `Dropped ${nm(i.playerId)}`;
        if (i.type === 'TRADE') return i.toTeamId === id ? `Received ${nm(i.playerId)} from ${team(S, i.fromTeamId).name}` : `Sent ${nm(i.playerId)} to ${team(S, i.toTeamId).name}`;
        return `${i.type} ${nm(i.playerId)}`;
      }),
    })).filter((t) => t.lines.length).sort((a, b) => b.date - a.date);
  return {
    id, name: tm.name, manager: tm.manager,
    roster: tm.roster.map((p) => ({ name: p.name, pos: POS[p.pos] || '?', status: BENCH.has(p.slot) ? (p.slot === 21 ? 'IR' : 'Bench') : 'Starter' })),
    leadersStarted: top([...list], 'started'), leadersTotal: top([...list], 'total'),
    bestStarted: perf.filter((p) => p.started).sort((a, b) => b.pts - a.pts).slice(0, 3).map((p) => ({ ...p, pts: r1(p.pts) })),
    bestBench: perf.filter((p) => !p.started).sort((a, b) => b.pts - a.pts).slice(0, 3).map((p) => ({ ...p, pts: r1(p.pts) })),
    transactions,
  };
}

module.exports = { info, weekView, standings, managerView };
