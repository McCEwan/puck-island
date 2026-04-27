// @ts-nocheck
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Star } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid
} from "recharts";

const SEASONS_ORDERED = [
  '2000-01','2001-02','2002-03','2003-04','2005-06','2006-07',
  '2007-08','2008-09','2009-10','2010-11','2011-12','2012-13',
  '2013-14','2014-15','2015-16','2016-17','2017-18','2018-19',
  '2019-20','2020-21','2021-22','2022-23','2023-24','2024-25','2025-26'
];

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function calcRating(gp, pts, g, shots) {
  if (gp === 0) return 0;
  return Math.round(((pts/gp)*45 + (g/gp)*25 + (shots/gp)*5) * 10) / 10;
}

export default function PlayerDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [player, setPlayer] = useState(null);
  const [stats, setStats] = useState([]);
  const [ratings, setRatings] = useState(null);
  const [seasonPercentiles, setSeasonPercentiles] = useState<Record<string, { overall: number | null, offense: number | null, defense: number | null }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [playerRes, statsRes, ratingsRes] = await Promise.all([
        fetch(`/api/players/${id}`),
        fetch(`/api/players/${id}/stats`),
        fetch(`/api/players/${id}/ratings`),
      ]);
      const playerData  = await playerRes.json();
      const statsData   = await statsRes.json();
      setPlayer(playerData);
      setStats(statsData);
      if (ratingsRes.ok) {
        setRatings(await ratingsRes.json());
      } else {
        setRatings(null);
      }

      // Fetch percentiles for each season with enough games
      const seasonIds = statsData
        .filter((s) => s.gp >= 30)
        .map((s) => s.season_id);

      const pctResults = await Promise.all(
        seasonIds.map((sid: string) =>
          fetch(`/api/players/${id}/ratings?season=${sid}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => [sid, {
              overall: d?.percentiles?.overall ?? null,
              offense: d?.percentiles?.offense ?? null,
              defense: d?.percentiles?.defense ?? null,
            }])
        )
      );
      setSeasonPercentiles(Object.fromEntries(pctResults));
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#060b14", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontFamily: "'DM Sans', sans-serif" }}>
      Loading player…
    </div>
  );

  if (!player) return (
    <div style={{ minHeight: "100vh", background: "#060b14", display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171", fontFamily: "'DM Sans', sans-serif" }}>
      Player not found.
    </div>
  );

  const orderedStats = SEASONS_ORDERED
    .map(sid => stats.find(s => s.season_id === sid))
    .filter(Boolean)
    .filter(s => s.gp > 0);

  const chartData = orderedStats
    .filter(s => seasonPercentiles[s.season_id] !== undefined)
    .map(s => ({
      season:  s.season_id.slice(0, 4),
      Overall: seasonPercentiles[s.season_id]?.overall ?? null,
      Offense: seasonPercentiles[s.season_id]?.offense ?? null,
      Defense: seasonPercentiles[s.season_id]?.defense ?? null,
    }));

  const bestSeason = orderedStats.reduce((best, s) =>
    s.pts > (best?.pts ?? 0) ? s : best, null);

  const careerGP  = orderedStats.reduce((sum, s) => sum + s.gp, 0);
  const careerG   = orderedStats.reduce((sum, s) => sum + s.g, 0);
  const careerA   = orderedStats.reduce((sum, s) => sum + s.a, 0);
  const careerPTS = orderedStats.reduce((sum, s) => sum + s.pts, 0);

  return (
    <div style={{ minHeight: "100vh", background: "#060b14", color: "#e2e8f0", fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Bebas+Neue&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .card { background: #0d1623; border: 1px solid #1e2d40; border-radius: 16px; }
        .mini-stat { background: #111c2d; border-radius: 10px; padding: 14px; }
        .tr-hover:hover { background: #131f30; }
        .pill { display: inline-flex; align-items: center; gap: 4px; background: #22d3ee15; color: #22d3ee; border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 700; }
      `}</style>

      <header style={{ borderBottom: "1px solid #1e2d40", padding: "0 32px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", height: 64, display: "flex", alignItems: "center" }}>
          <button onClick={() => router.back()}
            style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "1px solid #1e2d40", borderRadius: 10, padding: "8px 16px", color: "#94a3b8", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: 14 }}>
            <ArrowLeft size={15} /> Back
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 32px 80px", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Player Card Header */}
        <div className="card" style={{ padding: 32 }}>
          <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 8 }}>
            {player.position} · {player.current_team_id?.toUpperCase() ?? "—"}
          </div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 56, letterSpacing: ".04em", lineHeight: 1, marginBottom: 12 }}>
            {player.full_name}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span className="pill">Career GP: {careerGP}</span>
            <span className="pill">Career G: {careerG}</span>
            <span className="pill">Career A: {careerA}</span>
            <span className="pill">Career PTS: {careerPTS}</span>
            {careerGP > 0 && <span className="pill">Career PPG: {(careerPTS / careerGP).toFixed(2)}</span>}
          </div>
        </div>

        {/* Percentile Ratings */}
        {ratings && (
          <div className="card" style={{ padding: 28 }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, marginBottom: 4 }}>
              Player Ratings
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 24 }}>
              Percentile rank among {ratings.positionGroup} · {ratings.groupSize} qualified players · min 30 GP
              {ratings.hasAdvanced
                ? " · Defense includes MoneyPuck advanced metrics"
                : " · Defense pending MoneyPuck data"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {[
                { label: "Overall",       value: ratings.percentiles.overall,      color: "#f59e0b" },
                { label: "5v5 Offense",   value: ratings.percentiles.offense,      color: "#22d3ee" },
                { label: "5v5 Defense",   value: ratings.percentiles.defense,      color: "#4ade80" },
                { label: "Power Play",    value: ratings.percentiles.powerPlay,    color: "#818cf8" },
                { label: "Penalty Kill",  value: ratings.percentiles.penaltyKill,  color: "#f87171" },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>{label}</span>
                    {value !== null ? (
                      <span style={{ fontSize: 13, fontWeight: 800, color }}>
                        {ordinal(value)} percentile
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: "#475569" }}>
                        {label === "Power Play" ? "Not enough PP ice time" :
                         label === "Penalty Kill" ? "Not enough PK ice time" :
                         "MoneyPuck data pending"}
                      </span>
                    )}
                  </div>
                  {value !== null && (
                    <div style={{ height: 6, background: "#111c2d", borderRadius: 999 }}>
                      <div style={{
                        height: "100%",
                        width: `${value}%`,
                        background: color,
                        borderRadius: 999,
                        transition: "width 0.6s ease",
                      }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chart */}
        {chartData.length > 1 && (
          <div className="card" style={{ padding: 28 }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, marginBottom: 4 }}>
              Percentile Rank Per Season
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
              Percentile among {ratings?.positionGroup ?? "skaters"} · min 30 GP
            </div>
            {/* Legend */}
            <div style={{ display: "flex", gap: 20, marginBottom: 20 }}>
              {[
                { label: "Overall", color: "#f59e0b" },
                { label: "Offense", color: "#22d3ee" },
                { label: "Defense", color: "#4ade80" },
              ].map(({ label, color }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 12, height: 3, background: color, borderRadius: 2 }} />
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>{label}</span>
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2d40" />
                <XAxis dataKey="season" tick={{ fill: "#64748b", fontSize: 11 }} />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  tickFormatter={(v) => `${v}th`}
                />
                <Tooltip
                  contentStyle={{ background: "#0d1623", border: "1px solid #1e2d40", borderRadius: 8 }}
                  formatter={(value: any, name: string) =>
                    value !== null ? [`${ordinal(value)} percentile`, name] : ["No data", name]
                  }
                />
                <Line
                  type="monotone"
                  dataKey="Overall"
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "#f59e0b" }}
                  activeDot={{ r: 6 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="Offense"
                  stroke="#22d3ee"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={{ r: 3, fill: "#22d3ee" }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="Defense"
                  stroke="#4ade80"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={{ r: 3, fill: "#4ade80" }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Best Season */}
        {bestSeason && (
          <div className="card" style={{ padding: 24 }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, marginBottom: 16, color: "#f59e0b" }}>
              Career Best Season — {bestSeason.season_id}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
              {[["GP", bestSeason.gp], ["G", bestSeason.g], ["A", bestSeason.a], ["PTS", bestSeason.pts],
                ["Shots", bestSeason.shots], ["SH%", bestSeason.shots > 0 ? `${((bestSeason.g/bestSeason.shots)*100).toFixed(1)}%` : "—"],
                ["PPG", (bestSeason.pts/bestSeason.gp).toFixed(2)],
                ["Rating", calcRating(bestSeason.gp, bestSeason.pts, bestSeason.g, bestSeason.shots)]
              ].map(([l, v]) => (
                <div key={l} className="mini-stat">
                  <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>{l}</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Year by Year Table */}
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "20px 24px 0" }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, marginBottom: 16 }}>Year by Year</div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ background: "#111c2d", color: "#64748b" }}>
                  {["Season","Team","GP","G","A","PTS","Shots","SH%","PPG","Rating"].map(h => (
                    <th key={h} style={{ padding: "12px 16px", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: ".06em", textAlign: "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...orderedStats].reverse().map(s => (
                  <tr key={s.season_id} className="tr-hover" style={{ borderTop: "1px solid #1e2d40" }}>
                    <td style={{ padding: "13px 16px", fontWeight: 700, color: "#22d3ee" }}>{s.season_id}</td>
                    <td style={{ color: "#64748b" }}>{s.team_id?.toUpperCase() ?? "—"}</td>
                    <td>{s.gp}</td>
                    <td>{s.g}</td>
                    <td>{s.a}</td>
                    <td style={{ fontWeight: 800 }}>{s.pts}</td>
                    <td>{s.shots}</td>
                    <td>{s.shots > 0 ? `${((s.g/s.shots)*100).toFixed(1)}%` : "—"}</td>
                    <td>{(s.pts/s.gp).toFixed(2)}</td>
                    <td><span className="pill"><Star size={11} />{calcRating(s.gp, s.pts, s.g, s.shots)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
