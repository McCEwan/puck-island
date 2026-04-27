// @ts-nocheck
// v2
"use client";
import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

// ─────────────────────────────────────────────
// DATA LAYER — swap these out for Supabase queries in production
// ─────────────────────────────────────────────
const NHLApi = {
  async getTeams() {
    const res = await fetch('/api/teams');
    return res.json();
  },

  async getPlayerStats(season: string) {
    const res = await fetch(`/api/playerstats?season=${season}`);
    return res.json();
  },

};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
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
  const [minGP,       setMinGP]       = useState(30);
  const [sortKey,     setSortKey]     = useState("pts");
  const [statSortKey,    setStatSortKey]    = useState("pts");
  const [statSortDir,    setStatSortDir]    = useState("desc");
  const [selectedSeason, setSelectedSeason] = useState("2025-26");

  // ── Real NHL data ──
  const [dbTeams,         setDbTeams]         = useState([]);
  const [playerStats,     setPlayerStats]     = useState([]);
  const [listPercentiles, setListPercentiles] = useState<Record<number, { overall: number | null, offense: number | null, defense: number | null, powerPlay: number | null, penaltyKill: number | null }>>({});
  const [loadingMsg,      setLoadingMsg]      = useState("Connecting to NHL API…");

  useEffect(() => {
    async function loadNHLData() {
      try {
        const dbTeams = await NHLApi.getTeams();
        setDbTeams(dbTeams);

        const stats = await NHLApi.getPlayerStats(selectedSeason);
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
          offensePercentile:  listPercentiles[pid]?.offense     ?? null,
          defensePercentile:  listPercentiles[pid]?.defense     ?? null,
          overallPercentile:  listPercentiles[pid]?.overall     ?? null,
          ppPercentile:       listPercentiles[pid]?.powerPlay   ?? null,
          pkPercentile:       listPercentiles[pid]?.penaltyKill ?? null,
        };
      })
      .filter(p => p.gp >= Math.max(1, minGP))
      .filter(p => p.position !== 'G')
      .filter(p => teamFilter === 'ALL' || p.currentTeam === teamFilter)
      .filter(p => posFilter  === 'ALL' || p.position === posFilter)
      .filter(p => query === '' || p.name.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => {
        const dir = statSortDir === 'desc' ? -1 : 1;
        if (['offensePercentile','defensePercentile','overallPercentile','ppPercentile','pkPercentile'].includes(sortKey)) {
          const aVal = (a as any)[sortKey] ?? -1;
          const bVal = (b as any)[sortKey] ?? -1;
          return (bVal - aVal) * dir;
        }
        return (Number((a as any)[sortKey]) - Number((b as any)[sortKey])) * dir;
      });
  }, [playerStats, sortKey, statSortKey, statSortDir, listPercentiles, query, teamFilter, posFilter, minGP]);


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
        @media (max-width: 768px) {
          .page-title { font-size: 32px; }
          .section-title { font-size: 22px; }
          .nav-btn { padding: 6px 12px; font-size: 13px; }
          input, select { font-size: 16px; }
        }
      `}</style>

      {/* HEADER */}
      <header style={{ position: "sticky", top: 0, zIndex: 20, borderBottom: "1px solid #1e2d40", background: "#060b14ee", backdropFilter: "blur(12px)", padding: "0 16px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <button onClick={() => setPage("home")} style={{ display: "flex", alignItems: "center", gap: 12, background: "none", border: "none", cursor: "pointer", color: "inherit" }}>
            <img src="/logo.png" alt="PuckIsland" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "contain" }} />
            <div style={{ textAlign: "left" }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: ".06em", color: "#e2e8f0" }}>PuckIsland</div>
              <div style={{ fontSize: 11, color: "#475569" }}>NHL stats & analytics</div>
            </div>
          </button>
          <nav style={{ display: "flex", gap: 4 }}>
            {["home","players"].map((p) => (
              <button key={p} className={`nav-btn ${page === p ? "active" : ""}`} onClick={() => setPage(p)}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 16px 80px" }}>

        {/* ══════════════ HOME ══════════════ */}
        {page === "home" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            {/* Hero */}
            <div className="card" style={{ padding: "28px 24px", background: "linear-gradient(135deg, #0d1623 0%, #0a1a2e 100%)", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", right: -40, top: -40, width: 300, height: 300, borderRadius: "50%", background: "#22d3ee08", pointerEvents: "none" }} />
              <div className="pill" style={{ marginBottom: 16 }}>V1 Prototype · Live NHL Data</div>
              <div className="page-title" style={{ color: "#e2e8f0", marginBottom: 12 }}>Track NHL players,<br/>teams & trends.</div>
              <p style={{ color: "#64748b", lineHeight: 1.6, maxWidth: 600, marginBottom: 8 }}>
                A clean stats explorer backed by the official NHL API and MoneyPuck advanced metrics.
              </p>
              <p style={{ fontSize: 12, color: "#22d3ee88", marginBottom: 24 }}>{loadingMsg}</p>
              <div style={{ display: "flex", gap: 12 }}>
                <button className="btn-primary" onClick={() => setPage("players")}>Explore Players</button>
              </div>
            </div>

            {/* ── Formula Documentation ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 20 }}>

              {/* Offense */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "#22d3ee", marginBottom: 4 }}>5v5 Offense</div>
                <div style={{ fontSize: 12, color: "#475569", marginBottom: 16 }}>Same formula for forwards and defensemen · min 200 min 5v5 ice</div>
                {[
                  { stat: "Primary Assists / GP",  weight: "35%", desc: "Direct passes leading to goals — most repeatable offensive metric" },
                  { stat: "Individual xG / 60",    weight: "30%", desc: "Quality of shots you personally generate per 60 min" },
                  { stat: "5v5 Points / 60",       weight: "20%", desc: "Overall even-strength scoring rate" },
                  { stat: "On-ice xGF / 60",       weight: "15%", desc: "Expected goals for while you're on the ice" },
                ].map(({ stat, weight, desc }) => (
                  <div key={stat} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{stat}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: "#22d3ee" }}>{weight}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.4 }}>{desc}</div>
                  </div>
                ))}
              </div>

              {/* Defense — Forwards */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "#4ade80", marginBottom: 4 }}>5v5 Defense — Forwards</div>
                <div style={{ fontSize: 12, color: "#475569", marginBottom: 16 }}>Min 200 min 5v5 ice · lower-is-better stats are inverted</div>
                {[
                  { stat: "Relative xG%",      weight: "35%", desc: "How much the team's xG ratio improves with you on ice vs off" },
                  { stat: "xGA / 60",          weight: "25%", desc: "Expected goals against per 60 while on ice (lower = better)" },
                  { stat: "HD xGA / 60",       weight: "20%", desc: "High-danger expected goals against (lower = better)" },
                  { stat: "Corsi Against / 60",weight: "20%", desc: "Shot attempts against per 60 (lower = better)" },
                ].map(({ stat, weight, desc }) => (
                  <div key={stat} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{stat}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: "#4ade80" }}>{weight}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.4 }}>{desc}</div>
                  </div>
                ))}
              </div>

              {/* Defense — Defensemen */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "#4ade80", marginBottom: 4 }}>5v5 Defense — Defensemen</div>
                <div style={{ fontSize: 12, color: "#475569", marginBottom: 16 }}>Min 200 min 5v5 ice · lower-is-better stats are inverted</div>
                {[
                  { stat: "Relative xG%",      weight: "30%", desc: "Team xG ratio improvement with you on ice vs off" },
                  { stat: "xGA / 60",          weight: "20%", desc: "Expected goals against per 60 (lower = better)" },
                  { stat: "HD xGA / 60",       weight: "15%", desc: "High-danger expected goals against (lower = better)" },
                  { stat: "Corsi Against / 60",weight: "15%", desc: "Shot attempts against per 60 (lower = better)" },
                  { stat: "Blocked Shots / 60",weight: "10%", desc: "Shots blocked per 60 minutes" },
                  { stat: "On-ice xGF / 60",   weight: "10%", desc: "Offensive contribution while defending" },
                ].map(({ stat, weight, desc }) => (
                  <div key={stat} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{stat}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: "#4ade80" }}>{weight}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.4 }}>{desc}</div>
                  </div>
                ))}
              </div>

              {/* Overall */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "#f59e0b", marginBottom: 4 }}>Overall Rating</div>
                <div style={{ fontSize: 12, color: "#475569", marginBottom: 16 }}>Weighted combination of 5v5 offense + defense · percentile ranked within position group</div>
                {[
                  { pos: "Forwards",   off: "80%", def: "20%" },
                  { pos: "Defensemen", off: "35%", def: "65%" },
                ].map(({ pos, off, def }) => (
                  <div key={pos} style={{ marginBottom: 16, background: "#111c2d", borderRadius: 10, padding: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: "#e2e8f0" }}>{pos}</div>
                    <div style={{ display: "flex", gap: 12 }}>
                      <div style={{ flex: 1, textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>Offense</div>
                        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "#22d3ee" }}>{off}</div>
                      </div>
                      <div style={{ flex: 1, textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>Defense</div>
                        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "#4ade80" }}>{def}</div>
                      </div>
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: "#475569", marginTop: 8 }}>
                  PP rating: PP pts/60 (40%) + PP xGF/60 (35%) + PP primary A/60 (25%) · min 30s PP/game<br/>
                  PK rating: xGA/60 (45%) + CA/60 (30%) + HD xGA/60 (25%) · min 30s PK/game
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ══════════════ PLAYERS LIST ══════════════ */}
        {page === "players" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <PageTitle title="Player Explorer" sub={`${sortedStats.length} players — click any column to sort`} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
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
                <option value="ppPercentile">Sort: Power Play</option>
                <option value="pkPercentile">Sort: Penalty Kill</option>
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
                        { label: "PP RTG",   key: "ppPercentile" },
                        { label: "PK RTG",   key: "pkPercentile" },
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
                            ? <span className="pill" style={{ background: "#22d3ee15", color: "#22d3ee" }}>{ordinal(p.offensePercentile)}</span>
                            : <span style={{ color: "#475569", fontSize: 12 }}>—</span>}
                        </td>
                        <td>
                          {p.defensePercentile !== null
                            ? <span className="pill" style={{ background: "#4ade8015", color: "#4ade80" }}>{ordinal(p.defensePercentile)}</span>
                            : <span style={{ color: "#475569", fontSize: 12 }}>—</span>}
                        </td>
                        <td>
                          {p.ppPercentile !== null
                            ? <span className="pill" style={{ background: "#818cf815", color: "#818cf8" }}>{ordinal(p.ppPercentile)}</span>
                            : <span style={{ color: "#475569", fontSize: 12 }}>—</span>}
                        </td>
                        <td>
                          {p.pkPercentile !== null
                            ? <span className="pill" style={{ background: "#f8718115", color: "#f87171" }}>{ordinal(p.pkPercentile)}</span>
                            : <span style={{ color: "#475569", fontSize: 12 }}>—</span>}
                        </td>
                        <td>
                          {p.overallPercentile !== null
                            ? <span className="pill" style={{ background: "#f59e0b15", color: "#f59e0b" }}>{ordinal(p.overallPercentile)}</span>
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

      </main>
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
