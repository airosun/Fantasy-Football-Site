// All ESPN-specific code lives here. ESPN's API is unofficial and can change.
const BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';

const headers = () => ({
  Cookie: `espn_s2=${process.env.ESPN_S2}; SWID=${process.env.SWID}`,
  'User-Agent': 'Mozilla/5.0',
  Accept: 'application/json',
});

// NFL season that is current right now (a new season starts around July)
const nflSeason = () => { const d = new Date(); return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; };

async function call(season, query) {
  // ESPN serves seasons before 2018 from a different (leagueHistory) endpoint
  const url = +season >= 2018
    ? `${BASE}/${season}/segments/0/leagues/${process.env.LEAGUE_ID}?${query}`
    : `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/${process.env.LEAGUE_ID}?seasonId=${season}&${query}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`ESPN returned ${res.status} for season ${season} (${query.split('&')[0]})`);
  const j = await res.json();
  return Array.isArray(j) ? j[0] : j;
}

const player = (e) => ({
  id: e.playerId,
  name: e.playerPoolEntry?.player?.fullName || `Player ${e.playerId}`,
  pos: e.playerPoolEntry?.player?.defaultPositionId,
  team: e.playerPoolEntry?.player?.proTeamId,
  slot: e.lineupSlotId,
  pts: e.playerPoolEntry?.appliedStatTotal ?? 0,
});

const r2 = (n) => Math.round(n * 100) / 100;

// While a matchup is still in progress the score is the sum of the starters' points, so the
// scoreboard moves as each player's points move. Once ESPN calls the matchup, its own total is used.
const side = (s, decided) => {
  const players = (s.rosterForCurrentScoringPeriod?.entries || []).map(player);
  const starters = players.filter((p) => p.slot !== 20 && p.slot !== 21);
  const live = r2(starters.reduce((a, p) => a + p.pts, 0));
  return { teamId: s.teamId, score: decided || !players.length ? (s.totalPoints ?? 0) : live, players };
};

// `final` forces every matchup to count as decided (used for weeks that are already over).
const parseWeek = (d, w, final) =>
  d.schedule
    .filter((m) => m.matchupPeriodId === w && m.home && m.away)
    .map((m) => {
      const decided = final || m.winner === undefined || m.winner !== 'UNDECIDED';
      return { decided, home: side(m.home, decided), away: side(m.away, decided) };
    });

// NFL bye week for each pro team: { proTeamId: week }. Used so player averages skip bye weeks.
async function fetchByes(season) {
  const res = await fetch(`${BASE}/${season}?view=proTeamSchedules_wl`, { headers: headers() });
  if (!res.ok) throw new Error(`ESPN returned ${res.status} for pro schedules`);
  const d = await res.json();
  const out = {};
  for (const t of d.settings?.proTeams || []) {
    if (!t.id) continue;
    let b = t.byeWeek;
    if (!b && t.proGamesByScoringPeriod) {
      const have = new Set(Object.keys(t.proGamesByScoringPeriod).map(Number));
      for (let w = 1; w <= 18; w++) if (!have.has(w)) { b = w; break; }
    }
    if (b) out[t.id] = b;
  }
  return out;
}

// Refreshes one season. Finished weeks are kept from `prev` so only recent weeks are re-fetched.
async function refreshSeason(season, prev) {
  const info = await call(season, 'view=mTeam&view=mSettings&view=mRoster');
  const total = info.settings.scheduleSettings.matchupPeriodCount;
  const current = Math.min(info.status?.currentMatchupPeriod || info.scoringPeriodId || 1, total);
  const finished = current >= total && (info.status?.isActive === false || +season < nflSeason());
  const members = {};
  (info.members || []).forEach((m) => {
    members[m.id] = `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.displayName;
  });
  const names = { ...(prev?.names || {}) };
  const teams = info.teams.map((t) => {
    const roster = t.roster.entries.map(player);
    roster.forEach((p) => (names[p.id] = p.name));
    return {
      id: t.id,
      champion: !!finished && t.rankCalculatedFinal === 1,
      name: t.name || `${t.location} ${t.nickname}`,
      manager: members[t.primaryOwner] || members[(t.owners || [])[0]] || '',
      roster,
    };
  });

  const weeks = { ...(prev?.weeks || {}) };
  const txMap = { ...(prev?.tx || {}) };
  for (let w = 1; w <= current; w++) {
    const recent = w >= current - 1;
    if (!weeks[w] || recent) {
      const d = await call(season, `view=mMatchupScore&view=mMatchup&scoringPeriodId=${w}`);
      weeks[w] = parseWeek(d, w, w < current || finished);
      weeks[w].forEach((g) =>
        [g.home, g.away].forEach((s) => s.players.forEach((p) => (names[p.id] = p.name)))
      );
    }
    if (!prev || recent) {
      try {
        const t = await call(season, `view=mTransactions2&scoringPeriodId=${w}`);
        (t.transactions || []).forEach((x) => (txMap[x.id] = x));
      } catch (e) { /* transactions are optional; keep going */ }
    }
  }
  let byes = prev?.byes;
  if (!byes || !Object.keys(byes).length) {
    try { byes = await fetchByes(season); } catch (e) { byes = {}; }
  }
  return {
    season, total, current, finished, byes,
    completed: finished ? total : current - 1,
    slotCounts: info.settings.rosterSettings.lineupSlotCounts,
    teams, weeks, names, tx: txMap, updated: new Date().toISOString(),
  };
}

// Lightweight refresh of just the current week's scoreboard (one ESPN call). Returns the new games.
async function refreshLive(season, S) {
  const d = await call(season, `view=mMatchupScore&view=mMatchup&scoringPeriodId=${S.current}`);
  return parseWeek(d, S.current, false);
}

module.exports = { refreshSeason, refreshLive, nflSeason };
