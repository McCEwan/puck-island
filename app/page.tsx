// @ts-nocheck
// v2
"use client";
import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Trophy, Users, BarChart3, Star,
  Shield, Activity, ArrowLeft, TrendingUp, Zap,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

// ─────────────────────────────────────────────
// DATA LAYER — swap these out for Supabase queries in production
// ─────────────────────────────────────────────
const NHLApi = {
  async getStandings() {
    const res = await fetch("/api/standings");
    const data = await res.json();
    return data.standings ?? [];
  },

  async getTeams() {
    const res = await fetch('/api/teams');
    return res.json();
  },

  async getPlayers() {
    const res = await fetch('/api/players');
    return res.json();
  },

  async getPlayerStats(season: string) {
    const res = await fetch(`/api/playerstats?season=${season}`);
    return res.json();
  },

  async getRoster(teamAbbr: string) {
    const res = await fetch(`/api/roster/${teamAbbr}`);
    const data = await res.json();
    return [
      ...(data.forwards ?? []),
      ...(data.defensemen ?? []),
      ...(data.goalies ?? []),
    ].map((p: any) => ({
      id: p.id,
      name: `${p.firstName?.default ?? ""} ${p.lastName?.default ?? ""}`.trim(),
      position: p.positionCode ?? "N/A",
      sweaterNumber: p.sweaterNumber ?? "—",
    }));
  },
};

// ─────────────────────────────────────────────
// STATIC DATA (replace with Supabase queries after schema setup)
// ─────────────────────────────────────────────
const FEATURED_TEAMS = ["TOR", "EDM", "COL", "NYR", "VAN"];

const MOCK_PLAYERS = [
  { id: 8479318, name: "Auston Matthews",  team: "TOR", position: "C",  age: 28, gp: 81, g: 69,  a: 38,  pts: 107, shots: 369, plusMinus: 31, toi: "20:58", trend: [1,0,2,1,3,2,0,2,1,2] },
  { id: 8481522, name: "Mitch Marner",     team: "TOR", position: "RW", age: 28, gp: 69, g: 26,  a: 59,  pts: 85,  shots: 198, plusMinus: 21, toi: "21:15", trend: [1,1,0,2,1,2,3,1,1,0] },
  { id: 8478402, name: "Connor McDavid",   team: "EDM", position: "C",  age: 29, gp: 76, g: 32,  a: 100, pts: 132, shots: 263, plusMinus: 35, toi: "21:22", trend: [2,3,1,2,4,1,3,2,2,3] },
  { id: 8477934, name: "Leon Draisaitl",   team: "EDM", position: "C",  age: 30, gp: 81, g: 41,  a: 65,  pts: 106, shots: 245, plusMinus: 26, toi: "20:41", trend: [0,2,2,1,3,2,1,0,3,1] },
  { id: 8477492, name: "Nathan MacKinnon", team: "COL", position: "C",  age: 30, gp: 82, g: 51,  a: 89,  pts: 140, shots: 405, plusMinus: 35, toi: "22:49", trend: [3,1,2,2,4,3,1,2,2,3] },
  { id: 8480069, name: "Cale Makar",       team: "COL", position: "D",  age: 27, gp: 77, g: 21,  a: 69,  pts: 90,  shots: 230, plusMinus: 15, toi: "24:46", trend: [1,1,2,0,2,1,1,3,0,1] },
  { id: 8478550, name: "Artemi Panarin",   team: "NYR", position: "LW", age: 34, gp: 82, g: 49,  a: 71,  pts: 120, shots: 302, plusMinus: 18, toi: "20:07", trend: [2,1,2,3,2,1,0,2,4,1] },
  { id: 8480800, name: "Quinn Hughes",     team: "VAN", position: "D",  age: 26, gp: 82, g: 17,  a: 75,  pts: 92,  shots: 199, plusMinus: 38, toi: "24:41", trend: [1,2,1,1,3,0,2,1,2,1] },
];

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function calcRating(p) {
  const ppg      = p.pts / p.gp;
  const gpg      = p.g   / p.gp;
  const shotRate = p.shots / p.gp;
  const plusBonus = Math.max(p.plusMinus, 0) / 20;
  return Math.round((ppg * 45 + gpg * 25 + shotRate * 5 + plusBonus * 10) * 10) / 10;
}

function pct(num, den) {
  return den === 0 ? 0 : Number(((num / den) * 100).toFixed(1));
}

function ptsPct(wins, ot, gp = 82) {
  return (((wins * 2 + ot) / (gp * 2)) * 100).toFixed(1);
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export default function PuckIsland() {
  const router = useRouter();

  // ── Navigation ──
  const [page, setPage] = useState("home");

  // ── Players page ──
  const [query,       setQuery]       = useState("");
  const [teamFilter,  setTeamFilter]  = useState("ALL");
  const [posFilter,   setPosFilter]   = useState("ALL");
  const [minGP,       setMinGP]       = useState(0);
  const [sortKey,     setSortKey]     = useState("pts");
  const [statSortKey,    setStatSortKey]    = useState("pts");
  const [statSortDir,    setStatSortDir]    = useState("desc");
  const [selectedSeason, setSelectedSeason] = useState("2025-26");

  // ── Enriched static players (stable reference, computed once) ──
  const enrichedPlayers = useMemo(() =>
    MOCK_PLAYERS.map((p) => ({
      ...p,
      rating: calcRating(p),
      ppg:    Number((p.pts / p.gp).toFixed(2)),
      shPct:  pct(p.g, p.shots),
    })), []
  );

  // FIX: selectedPlayer and compare states initialized AFTER enrichedPlayers
  const [selectedPlayer, setSelectedPlayer] = useState(enrichedPlayers[0]);
  const [compareA,       setCompareA]       = useState(enrichedPlayers[0]);
  const [compareB,       setCompareB]       = useState(enrichedPlayers[1]);

  // ── Real NHL data ──
  const [standings,       setStandings]       = useState([]);
  const [rosters,         setRosters]         = useState({});
  const [dbTeams,         setDbTeams]         = useState([]);
  const [dbPlayers,       setDbPlayers]       = useState([]);
  const [playerStats,     setPlayerStats]     = useState([]);
  const [listPercentiles, setListPercentiles] = useState<Record<number, { overall: number | null, offense: number | null, defense: number | null }>>({});
  const [loadingMsg,      setLoadingMsg]      = useState("Connecting to NHL API…");

  useEffect(() => {
    async function loadNHLData() {
      try {
        // Load from Supabase
        const dbTeams = await NHLApi.getTeams();
        const dbPlayers = await NHLApi.getPlayers();
        console.log('DB Teams:', dbTeams);
        console.log('DB Players:', dbPlayers);
        setDbTeams(dbTeams);
        setDbPlayers(dbPlayers);

        // Load live NHL data
        const raw = await NHLApi.getStandings();
        setStandings(raw);
        setLoadingMsg("Standings loaded. Fetching rosters…");

        const rosterEntries = await Promise.all(
          FEATURED_TEAMS.map(async (abbr) => {
            const players = await NHLApi.getRoster(abbr);
            return [abbr, players];
          })
        );
        setRosters(Object.fromEntries(rosterEntries));

        const stats = await NHLApi.getPlayerStats(selectedSeason);
        console.log('Player Stats:', stats);
        setPlayerStats(stats);
        setLoadingMsg("Live NHL data loaded ✓");

        // Single bulk call for all player ratings
        const bulkRes = await fetch(`/api/ratings/bulk?season=${selectedSeason}`);
        if (bulkRes.ok) {
          setListPercentiles(await bulkRes.json());
        }
      } catch (err) {
        setLoadingMsg("API error — showing cached data");
        console.error(err);
      }
    }
    loadNHLData();
  }, []);

  useEffect(() => {
    async function loadStats() {
      const stats = await NHLApi.getPlayerStats(selectedSeason);
      setPlayerStats(stats);
    }
    loadStats();
  }, [selectedSeason]);

  useEffect(() => {
    async function refreshBulkRatings() {
      const res = await fetch(`/api/ratings/bulk?season=${selectedSeason}`);
      if (res.ok) setListPercentiles(await res.json());
    }
    refreshBulkRatings();
  }, [selectedSeason]);

  // ── Derived / filtered ──
  // FIX: all dependencies (query, teamFilter, sortKey, enrichedPlayers) now exist before this call
  const filteredPlayers = useMemo(() =>
    enrichedPlayers
      .filter((p) => teamFilter === "ALL" || p.team === teamFilter)
      .filter((p) =>
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        p.team.toLowerCase().includes(query.toLowerCase())
      )
      .sort((a, b) => Number(b[sortKey]) - Number(a[sortKey])),
    [query, teamFilter, sortKey, enrichedPlayers]
  );

  const leagueLeaders = useMemo(() =>
    [...enrichedPlayers].sort((a, b) => b.pts - a.pts).slice(0, 5),
    [enrichedPlayers]
  );

  const featuredStandings = useMemo(() =>
    dbTeams.map((t) =>
      standings.find((s) => s.teamAbbrev?.default === t.abbreviation)
    ).filter(Boolean),
    [standings, dbTeams]
  );

  const sortedStats = useMemo(() => {
    // Step 1: for each (player_id, team_id) pair keep the row with the most GP.
    // This removes DB duplicates (e.g. one null-team row + one real-team row from
    // separate syncs) without discarding legitimate multi-team stints.
    const byPlayerTeam = new Map<string, any>();
    for (const p of playerStats) {
      if (!p.players) continue;
      // Skip slash-aggregate ("van/min") or numeric-aggregate ("2tm") rows
      if (p.team_id && (p.team_id.includes('/') || /^\d/.test(p.team_id))) continue;
      // Null team_id rows fall back to the player's current team so they still appear
      const effectiveTeam = p.team_id ?? p.players.current_team_id ?? '__unknown__';
      const key = `${p.player_id}__${effectiveTeam}`;
      const existing = byPlayerTeam.get(key);
      if (!existing || p.gp > existing.gp) byPlayerTeam.set(key, p);
    }

    // Step 2: group deduplicated rows by player_id
    const grouped = new Map<number, any[]>();
    for (const p of byPlayerTeam.values()) {
      if (!grouped.has(p.player_id)) grouped.set(p.player_id, []);
      grouped.get(p.player_id)!.push(p);
    }

    return [...grouped.entries()]
      .map(([pid, rows]) => {
        // Sum stats across all stints (rows are already clean — no null/aggregate team_ids)
        const gp    = rows.reduce((s, r) => s + (r.gp    ?? 0), 0);
        const g     = rows.reduce((s, r) => s + (r.g     ?? 0), 0);
        const a     = rows.reduce((s, r) => s + (r.a     ?? 0), 0);
        const pts   = rows.reduce((s, r) => s + (r.pts   ?? 0), 0);
        const shots = rows.reduce((s, r) => s + (r.shots ?? 0), 0);

        // Current team from player profile; former teams from stint rows
        const currentTeam = rows[0].players.current_team_id?.toUpperCase() ?? '—';
        const formerTeams = [...new Set(
          rows
            .map(r => (r.team_id ?? r.players.current_team_id)?.toUpperCase())
            .filter((t: string) => t && t !== currentTeam)
        )];
        const teamDisplay = formerTeams.length > 0
          ? `${currentTeam}, ${formerTeams.join(', ')}`
          : currentTeam;

        return {
          id:                pid,
          name:              rows[0].players.full_name,
          team:              teamDisplay,
          currentTeam,
          position:          rows[0].players.position ?? '—',
          gp,
          g,
          a,
          pts,
          shots,
          shPct:             shots > 0 ? Number(((g / shots) * 100).toFixed(1)) : 0,
          ppg:               gp    > 0 ? Number((pts / gp).toFixed(2))           : 0,
          offensePercentile: listPercentiles[pid]?.offense ?? null,
          defensePercentile: listPercentiles[pid]?.defense ?? null,
          overallPercentile: listPercentiles[pid]?.overall ?? null,
        };
      })
      .filter(p => p.gp >= Math.max(1, minGP))
      .filter(p => p.position !== 'G')
      .filter(p => teamFilter === 'ALL' || p.currentTeam === teamFilter)
      .filter(p => posFilter  === 'ALL' || p.position === posFilter)
      .filter(p => query === '' || p.name.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => {
        const dir = statSortDir === 'desc' ? -1 : 1;
        if (sortKey === 'offensePercentile' || sortKey === 'defensePercentile' || sortKey === 'overallPercentile') {
          const aVal = (a as any)[sortKey] ?? -1;
          const bVal = (b as any)[sortKey] ?? -1;
          return (bVal - aVal) * dir;
        }
        return (Number((a as any)[sortKey]) - Number((b as any)[sortKey])) * dir;
      });
  }, [playerStats, sortKey, statSortKey, statSortDir, listPercentiles, query, teamFilter, posFilter, minGP]);

  // ── Derived for player detail page ──
  const trendData = selectedPlayer.trend.map((v, i) => ({ game: `G${i + 1}`, points: v }));

  const compareData = [
    { stat: "Goals",   [compareA.name]: compareA.g,           [compareB.name]: compareB.g },
    { stat: "Assists", [compareA.name]: compareA.a,           [compareB.name]: compareB.a },
    { stat: "Points",  [compareA.name]: compareA.pts,         [compareB.name]: compareB.pts },
    { stat: "Shots",   [compareA.name]: compareA.shots,       [compareB.name]: compareB.shots },
    { stat: "Rating",  [compareA.name]: calcRating(compareA), [compareB.name]: calcRating(compareB) },
  ];

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#060b14", color: "#e2e8f0", fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Bebas+Neue&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; } 
        ::-webkit-scrollbar-track { background: #0d1623; }
        ::-webkit-scrollbar-thumb { background: #22d3ee44; border-radius: 3px; }
        .nav-btn { background: none; border: none; cursor: pointer; padding: 8px 18px; border-radius: 999px; font-size: 14px; font-weight: 600; color: #94a3b8; transition: all .2s; font-family: 'DM Sans', sans-serif; }
        .nav-btn:hover { background: #1e293b; color: #e2e8f0; }
        .nav-btn.active { background: #22d3ee; color: #060b14; }
        .card { background: #0d1623; border: 1px solid #1e2d40; border-radius: 16px; }
        .pill { display: inline-flex; align-items: center; gap: 4px; background: #22d3ee15; color: #22d3ee; border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 700; }
        .btn-primary { background: #22d3ee; color: #060b14; border: none; border-radius: 10px; padding: 10px 22px; font-weight: 700; font-size: 14px; cursor: pointer; transition: background .15s; font-family: 'DM Sans', sans-serif; }
        .btn-primary:hover { background: #67e8f9; }
        .btn-ghost { background: transparent; color: #94a3b8; border: 1px solid #1e2d40; border-radius: 10px; padding: 10px 22px; font-weight: 600; font-size: 14px; cursor: pointer; transition: all .15s; font-family: 'DM Sans', sans-serif; }
        .btn-ghost:hover { border-color: #22d3ee; color: #22d3ee; }
        .mini-stat { background: #111c2d; border-radius: 10px; padding: 14px; }
        .mini-stat .label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #64748b; margin-bottom: 4px; }
        .mini-stat .value { font-size: 20px; font-weight: 700; }
        .tr-hover:hover { background: #131f30 !important; cursor: pointer; }
        input, select { background: #0a1525; border: 1px solid #1e2d40; border-radius: 10px; color: #e2e8f0; padding: 10px 14px; font-family: 'DM Sans', sans-serif; font-size: 14px; outline: none; transition: border-color .15s; }
        input:focus, select:focus { border-color: #22d3ee; }
        .page-title { font-family: 'Bebas Neue', sans-serif; font-size: 48px; letter-spacing: .04em; line-height: 1; }
        .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: .04em; }
      `}</style>

      {/* HEADER */}
      <header style={{ position: "sticky", top: 0, zIndex: 20, borderBottom: "1px solid #1e2d40", background: "#060b14ee", backdropFilter: "blur(12px)", padding: "0 32px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          <button onClick={() => setPage("home")} style={{ display: "flex", alignItems: "center", gap: 12, background: "none", border: "none", cursor: "pointer", color: "inherit" }}>
            <div style={{ background: "#22d3ee", borderRadius: 10, padding: 8, color: "#060b14", display: "flex" }}>
              <Shield size={20} />
            </div>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: ".06em", color: "#e2e8f0" }}>PuckIsland</div>
              <div style={{ fontSize: 11, color: "#475569" }}>NHL stats & analytics</div>
            </div>
          </button>
          <nav style={{ display: "flex", gap: 4 }}>
            {["home","players","teams","compare"].map((p) => (
              <button key={p} className={`nav-btn ${page === p ? "active" : ""}`} onClick={() => setPage(p)}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 32px 80px" }}>

        {/* ══════════════ HOME ══════════════ */}
        {page === "home" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            {/* Hero */}
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr .6fr", gap: 20 }}>
              <div className="card" style={{ padding: 40, background: "linear-gradient(135deg, #0d1623 0%, #0a1a2e 100%)", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", right: -40, top: -40, width: 300, height: 300, borderRadius: "50%", background: "#22d3ee08", pointerEvents: "none" }} />
                <div className="pill" style={{ marginBottom: 16 }}>V1 Prototype · Live NHL Data</div>
                <div className="page-title" style={{ color: "#e2e8f0", marginBottom: 12 }}>Track NHL players,<br/>teams & trends.</div>
                <p style={{ color: "#64748b", lineHeight: 1.6, maxWidth: 480, marginBottom: 8 }}>
                  A clean stats explorer backed by the official NHL API and MoneyPuck advanced metrics.
                </p>
                <p style={{ fontSize: 12, color: "#22d3ee88", marginBottom: 24 }}>{loadingMsg}</p>
                <div style={{ display: "flex", gap: 12 }}>
                  <button className="btn-primary" onClick={() => setPage("players")}>Explore Players</button>
                  <button className="btn-ghost" onClick={() => setPage("compare")}>Compare Players</button>
                </div>
              </div>

              {/* League Leaders */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                  <Trophy size={18} color="#22d3ee" />
                  <span className="section-title">Leaders</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {leagueLeaders.map((p, i) => (
                    <button key={p.id} onClick={() => { setSelectedPlayer(p); setPage("player"); }}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#111c2d", border: "none", borderRadius: 10, padding: "12px 14px", cursor: "pointer", color: "inherit", width: "100%", transition: "background .15s" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "#162030"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "#111c2d"}>
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{i + 1}. {p.name}</div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>{p.team} · {p.position}</div>
                      </div>
                      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: "#22d3ee", letterSpacing: ".04em" }}>{p.pts}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════ PLAYERS LIST ══════════════ */}
        {page === "players" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <PageTitle title="Player Explorer" sub={`${sortedStats.length} players — click any column to sort`} />
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              {/* Search */}
              <div style={{ position: "relative" }}>
                <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#475569", pointerEvents: "none" }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search players…"
                  style={{ paddingLeft: 34, width: 200 }}
                />
              </div>
              {/* Team */}
              <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} style={{ width: 140 }}>
                <option value="ALL">All Teams</option>
                {[...new Set(dbTeams.map((t: any) => t.abbreviation))].sort().map((abbr: any) => (
                  <option key={abbr} value={abbr}>{abbr}</option>
                ))}
              </select>
              {/* Position */}
              <select value={posFilter} onChange={(e) => setPosFilter(e.target.value)} style={{ width: 140 }}>
                <option value="ALL">All Positions</option>
                <option value="C">Centre</option>
                <option value="L">Left Wing</option>
                <option value="LW">Left Wing (LW)</option>
                <option value="R">Right Wing</option>
                <option value="RW">Right Wing (RW)</option>
                <option value="D">Defence</option>
              </select>
              {/* Season */}
              <select value={selectedSeason} onChange={(e) => setSelectedSeason(e.target.value)} style={{ width: 120 }}>
                {[
                  '2025-26','2024-25','2023-24','2022-23','2021-22','2020-21',
                  '2019-20','2018-19','2017-18','2016-17','2015-16','2014-15',
                  '2013-14','2012-13','2011-12','2010-11','2009-10','2008-09',
                  '2007-08','2006-07','2005-06','2003-04','2002-03','2001-02','2000-01'
                ].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {/* Sort */}
              {/* Min GP slider */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#0a1525", border: "1px solid #1e2d40", borderRadius: 10, padding: "6px 14px" }}>
                <span style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>Min GP</span>
                <input
                  type="range"
                  min={0} max={82} step={1}
                  value={minGP}
                  onChange={(e) => setMinGP(Number(e.target.value))}
                  style={{ width: 100, accentColor: "#22d3ee", cursor: "pointer" }}
                />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#22d3ee", minWidth: 24 }}>{minGP}</span>
              </div>
              <select value={sortKey} onChange={(e) => { setSortKey(e.target.value); setStatSortDir("desc"); }} style={{ width: 200 }}>
                <option value="pts">Sort: Points</option>
                <option value="g">Sort: Goals</option>
                <option value="a">Sort: Assists</option>
                <option value="shots">Sort: Shots</option>
                <option value="offensePercentile">Sort: Offense Rating</option>
                <option value="defensePercentile">Sort: Defense Rating</option>
                <option value="overallPercentile">Sort: Overall Rating</option>
              </select>
            </div>
            <div className="card" style={{ overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ background: "#111c2d", color: "#64748b", textAlign: "left" }}>
                      {[
                        { label: "Player",   key: null },
                        { label: "Team",     key: null },
                        { label: "Pos",      key: null },
                        { label: "GP",       key: "gp" },
                        { label: "G",        key: "g" },
                        { label: "A",        key: "a" },
                        { label: "PTS",      key: "pts" },
                        { label: "Shots",    key: "shots" },
                        { label: "SH%",      key: "shPct" },
                        { label: "PPG",      key: "ppg" },
                        { label: "OFF RTG",  key: "offensePercentile" },
                        { label: "DEF RTG",  key: "defensePercentile" },
                        { label: "OVR RTG",  key: "overallPercentile" },
                      ].map(({ label, key }) => (
                        <th
                          key={label}
                          onClick={() => {
                            if (!key) return;
                            if (sortKey === key) {
                              setStatSortDir(statSortDir === "desc" ? "asc" : "desc");
                            } else {
                              setSortKey(key);
                              setStatSortDir("desc");
                            }
                          }}
                          style={{
                            padding: "12px 16px",
                            fontWeight: 600,
                            fontSize: 12,
                            textTransform: "uppercase",
                            letterSpacing: ".06em",
                            cursor: key ? "pointer" : "default",
                            color: sortKey === key ? "#22d3ee" : "#64748b",
                            userSelect: "none",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {label} {sortKey === key ? (statSortDir === "desc" ? "↓" : "↑") : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedStats.slice(0, 100).map((p) => (
                      <tr
                        key={p.id}
                        className="tr-hover"
                        onClick={() => router.push(`/players/${p.id}`)}
                        style={{ borderTop: "1px solid #1e2d40", cursor: "pointer" }}
                      >
                        <td style={{ padding: "13px 16px", fontWeight: 700 }}>{p.name}</td>
                        <td style={{ color: "#64748b" }}>{p.team}</td>
                        <td style={{ color: "#64748b" }}>{p.position}</td>
                        <td>{p.gp}</td>
                        <td>{p.g}</td>
                        <td>{p.a}</td>
                        <td style={{ fontWeight: 800, color: "#22d3ee" }}>{p.pts}</td>
                        <td>{p.shots}</td>
                        <td>{p.shPct}%</td>
                        <td>{p.ppg}</td>
                        <td>
                          {p.offensePercentile !== null
                            ? <span className="pill" style={{ background: "#22d3ee15", color: "#22d3ee" }}>{p.offensePercentile}th</span>
                            : <span style={{ color: "#475569", fontSize: 12 }}>—</span>}
                        </td>
                        <td>
                          {p.defensePercentile !== null
                            ? <span className="pill" style={{ background: "#4ade8015", color: "#4ade80" }}>{p.defensePercentile}th</span>
                            : <span style={{ color: "#475569", fontSize: 12 }}>—</span>}
                        </td>
                        <td>
                          {p.overallPercentile !== null
                            ? <span className="pill" style={{ background: "#f59e0b15", color: "#f59e0b" }}>{p.overallPercentile}th</span>
                            : <span style={{ color: "#475569", fontSize: 12 }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════ PLAYER DETAIL ══════════════ */}
        {page === "player" && selectedPlayer && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <button className="btn-ghost" style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6 }}
              onClick={() => setPage("players")}>
              <ArrowLeft size={15} /> Back to players
            </button>
            <div style={{ display: "grid", gridTemplateColumns: ".85fr 1.15fr", gap: 20 }}>
              {/* Bio + stats */}
              <div className="card" style={{ padding: 28 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
                  <div>
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, letterSpacing: ".04em" }}>{selectedPlayer.name}</div>
                    <div style={{ color: "#64748b", fontSize: 14 }}>{selectedPlayer.team} · {selectedPlayer.position} · Age {selectedPlayer.age}</div>
                  </div>
                  <div style={{ background: "#22d3ee12", borderRadius: 12, padding: "10px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>Rating</div>
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, color: "#22d3ee", letterSpacing: ".04em" }}>{calcRating(selectedPlayer)}</div>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[["Games",  selectedPlayer.gp],
                    ["Goals",  selectedPlayer.g],
                    ["Assists",selectedPlayer.a],
                    ["Points", selectedPlayer.pts],
                    ["Shots",  selectedPlayer.shots],
                    ["SH%",    `${pct(selectedPlayer.g, selectedPlayer.shots)}%`],
                    ["+/−",    selectedPlayer.plusMinus],
                    ["TOI/GP", selectedPlayer.toi],
                    ["PPG",    (selectedPlayer.pts / selectedPlayer.gp).toFixed(2)],
                    ["GPG",    (selectedPlayer.g   / selectedPlayer.gp).toFixed(2)],
                  ].map(([l, v]) => (
                    <div key={l} className="mini-stat">
                      <div className="label">{l}</div>
                      <div className="value">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Trend chart */}
              <div className="card" style={{ padding: 28 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                  <TrendingUp size={18} color="#22d3ee" />
                  <span className="section-title">Last 10 Games: Points</span>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2d40" />
                    <XAxis dataKey="game" tick={{ fill: "#64748b", fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 12 }} />
                    <Tooltip contentStyle={{ background: "#0d1623", border: "1px solid #1e2d40", borderRadius: 8 }} />
                    <Line type="monotone" dataKey="points" stroke="#22d3ee" strokeWidth={2.5} dot={{ fill: "#22d3ee", r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════ TEAMS ══════════════ */}
        {page === "teams" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <PageTitle title="Team Dashboard" sub={standings.length > 0 ? `Live standings — ${standings.length} teams` : "Loading live standings…"} />
            {/* Live standings table */}
            {featuredStandings.length > 0 && (
              <div className="card" style={{ overflow: "hidden" }}>
                <div style={{ padding: "20px 24px 0", marginBottom: 4 }}>
                  <span className="section-title">Featured Teams — Live Standings</span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                    <thead>
                      <tr style={{ background: "#111c2d", color: "#64748b" }}>
                        {["Team","Conference","Division","W","L","OT","GF","GA","GDiff","Pts%"].map((h) => (
                          <th key={h} style={{ padding: "12px 16px", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: ".06em", textAlign: "left" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {featuredStandings.map((s) => {
                        const abbr = s.teamAbbrev?.default;
                        const gf   = s.goalFor ?? 0;
                        const ga   = s.goalAgainst ?? 0;
                        return (
                          <tr key={abbr} style={{ borderTop: "1px solid #1e2d40" }}>
                            <td style={{ padding: "13px 16px", fontWeight: 700 }}>{s.teamName?.default ?? abbr}</td>
                            <td style={{ color: "#64748b" }}>{s.conferenceName}</td>
                            <td style={{ color: "#64748b" }}>{s.divisionName}</td>
                            <td style={{ fontWeight: 700, color: "#22d3ee" }}>{s.wins}</td>
                            <td>{s.losses}</td>
                            <td>{s.otLosses}</td>
                            <td>{gf}</td>
                            <td>{ga}</td>
                            <td style={{ color: gf - ga > 0 ? "#4ade80" : "#f87171", fontWeight: 700 }}>{gf - ga > 0 ? "+" : ""}{gf - ga}</td>
                            <td><span className="pill">{ptsPct(s.wins, s.otLosses, s.gamesPlayed)}%</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {/* Roster cards per team */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 }}>
              {FEATURED_TEAMS.map((abbr) => {
                const roster = rosters[abbr];
                return (
                  <div key={abbr} className="card" style={{ padding: 22 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                      <span className="section-title">{abbr}</span>
                      {roster && <span className="pill">{roster.length} players</span>}
                    </div>
                    {roster ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
                        {roster.map((p) => (
                          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "#111c2d", borderRadius: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                            <span style={{ fontSize: 12, color: "#64748b" }}>#{p.sweaterNumber} · {p.position}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: "#475569", fontSize: 13 }}>Loading roster…</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ══════════════ COMPARE ══════════════ */}
        {page === "compare" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <PageTitle title="Player Compare" sub="Head-to-head breakdown across goals, assists, points, shots, and rating." />
            <div className="card" style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              {[["Player A", compareA, setCompareA], ["Player B", compareB, setCompareB]].map(([label, player, setter]) => (
                <div key={label}>
                  <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>{label}</div>
                  <select value={player.id} onChange={(e) => { const found = enrichedPlayers.find((p) => p.id === Number(e.target.value)); if (found) setter(found); }} style={{ width: "100%" }}>
                    {enrichedPlayers.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.team}</option>)}
                  </select>
                  <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[["Points", player.pts],["Goals", player.g],["Assists", player.a],["Rating", calcRating(player)]].map(([l, v]) => (
                      <div key={l} className="mini-stat">
                        <div className="label">{l}</div>
                        <div className="value" style={{ color: "#22d3ee" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="card" style={{ padding: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                <Zap size={18} color="#22d3ee" />
                <span className="section-title">Comparison Chart</span>
              </div>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={compareData} barGap={6}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2d40" />
                  <XAxis dataKey="stat" tick={{ fill: "#64748b", fontSize: 12 }} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "#0d1623", border: "1px solid #1e2d40", borderRadius: 8 }} />
                  <Legend />
                  <Bar dataKey={compareA.name} fill="#22d3ee" radius={[4,4,0,0]} />
                  <Bar dataKey={compareB.name} fill="#818cf8" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────
// SMALL UI COMPONENTS
// ─────────────────────────────────────────────
function StatCard({ icon, label, value }) {
  return (
    <div className="card" style={{ display: "flex", alignItems: "center", gap: 16, padding: 20 }}>
      <div style={{ background: "#22d3ee12", borderRadius: 10, padding: 10, color: "#22d3ee", display: "flex" }}>{icon}</div>
      <div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 2 }}>{label}</div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: ".04em" }}>{value}</div>
      </div>
    </div>
  );
}

function PageTitle({ title, sub }) {
  return (
    <div>
      <div className="page-title" style={{ color: "#e2e8f0" }}>{title}</div>
      <div style={{ color: "#64748b", marginTop: 4, fontSize: 14 }}>{sub}</div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SUPABASE SCHEMA — paste this into your Supabase SQL editor
// ─────────────────────────────────────────────
export const SUPABASE_SCHEMA = `
CREATE TABLE teams (
  id          TEXT PRIMARY KEY,           -- e.g. "tor"
  name        TEXT NOT NULL,
  abbreviation TEXT NOT NULL UNIQUE,      -- e.g. "TOR"
  city        TEXT,
  conference  TEXT,
  division    TEXT
);

CREATE TABLE players (
  id              INTEGER PRIMARY KEY,    -- NHL API player ID
  full_name       TEXT NOT NULL,
  position        TEXT,
  shoots          TEXT,
  birth_date      DATE,
  height_cm       INTEGER,
  weight_kg       INTEGER,
  current_team_id TEXT REFERENCES teams(id)
);

CREATE TABLE seasons (
  id         TEXT PRIMARY KEY,            -- e.g. "2024-25"
  label      TEXT NOT NULL,
  start_year INTEGER,
  end_year   INTEGER
);

CREATE TABLE player_season_stats (
  id          SERIAL PRIMARY KEY,
  player_id   INTEGER REFERENCES players(id),
  team_id     TEXT    REFERENCES teams(id),
  season_id   TEXT    REFERENCES seasons(id),
  gp          INTEGER DEFAULT 0,
  g           INTEGER DEFAULT 0,
  a           INTEGER DEFAULT 0,
  pts         INTEGER DEFAULT 0,
  shots       INTEGER DEFAULT 0,
  pim         INTEGER DEFAULT 0,
  pp_goals    INTEGER DEFAULT 0,
  pp_points   INTEGER DEFAULT 0,
  gw_goals    INTEGER DEFAULT 0,
  plus_minus  INTEGER DEFAULT 0,
  toi_per_game TEXT,
  UNIQUE(player_id, team_id, season_id)
);

CREATE TABLE team_season_stats (
  id        SERIAL PRIMARY KEY,
  team_id   TEXT    REFERENCES teams(id),
  season_id TEXT    REFERENCES seasons(id),
  gp        INTEGER DEFAULT 0,
  wins      INTEGER DEFAULT 0,
  losses    INTEGER DEFAULT 0,
  otl       INTEGER DEFAULT 0,
  gf        INTEGER DEFAULT 0,
  ga        INTEGER DEFAULT 0,
  pp_pct    DECIMAL(5,2),
  pk_pct    DECIMAL(5,2),
  UNIQUE(team_id, season_id)
);
`;

// ─────────────────────────────────────────────
// SYNC SCRIPTS — save as scripts/sync.ts and run with:
//   SUPABASE_URL=... SUPABASE_KEY=... npx ts-node scripts/sync.ts
// ─────────────────────────────────────────────
export const SYNC_SCRIPT = `
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
const NHL = 'https://api-web.nhle.com/v1';

const ALL_TEAMS = [
  'TOR','EDM','COL','NYR','VAN','BOS','CAR','DAL','FLA','VGK',
  'NJD','SEA','MIN','PIT','LAK','WPG','ANA','OTT','CBJ','BUF',
  'MTL','DET','CGY','STL','NSH','SJS','PHI','CHI','ARI','TBL','NYI','WSH'
];

// 1. Sync teams from standings
async function syncTeams() {
  const res  = await fetch(\`\${NHL}/standings/now\`);
  const { standings } = await res.json();
  const rows = standings.map((s: any) => ({
    id:           s.teamAbbrev.default.toLowerCase(),
    name:         s.teamName.default,
    abbreviation: s.teamAbbrev.default,
    city:         s.placeName.default,
    conference:   s.conferenceName,
    division:     s.divisionName,
  }));
  const { error } = await supabase.from('teams').upsert(rows, { onConflict: 'id' });
  console.log(error ?? \`Teams synced: \${rows.length}\`);
}

// 2. Sync all players from every team roster
async function syncPlayers() {
  let total = 0;
  for (const abbr of ALL_TEAMS) {
    const res  = await fetch(\`\${NHL}/roster/\${abbr}/current\`);
    const data = await res.json();
    const all  = [...(data.forwards??[]), ...(data.defensemen??[]), ...(data.goalies??[])];
    const rows = all.map((p: any) => ({
      id:              p.id,
      full_name:       \`\${p.firstName.default} \${p.lastName.default}\`,
      position:        p.positionCode,
      current_team_id: abbr.toLowerCase(),
    }));
    const { error } = await supabase.from('players').upsert(rows, { onConflict: 'id' });
    if (error) console.error(\`\${abbr}:\`, error);
    else total += rows.length;
  }
  console.log(\`Players synced: \${total}\`);
}

// 3. Sync season stats for a player (call per player after roster sync)
async function syncPlayerStats(playerId: number, seasonId = '2024-25') {
  const res  = await fetch(\`\${NHL}/player/\${playerId}/landing\`);
  const data = await res.json();
  const season = data.seasonTotals?.find((s: any) => s.season === 20242025 && s.leagueAbbrev === 'NHL');
  if (!season) return;
  const row = {
    player_id:    playerId,
    team_id:      season.teamAbbrevs?.toLowerCase(),
    season_id:    seasonId,
    gp:           season.gamesPlayed,
    g:            season.goals,
    a:            season.assists,
    pts:          season.points,
    shots:        season.shots,
    pim:          season.pim,
    pp_goals:     season.powerPlayGoals,
    pp_points:    season.powerPlayPoints,
    gw_goals:     season.gameWinningGoals,
    plus_minus:   season.plusMinus,
    toi_per_game: season.avgToi,
  };
  const { error } = await supabase.from('player_season_stats').upsert(row, { onConflict: 'player_id,team_id,season_id' });
  console.log(error ?? \`Stats synced for player \${playerId}\`);
}

// Run all syncs
(async () => {
  await syncTeams();
  await syncPlayers();
})();
`;
