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

function calcRating(gp, pts, g, shots) {
  if (gp === 0) return 0;
  return Math.round(((pts/gp)*45 + (g/gp)*25 + (shots/gp)*5) * 10) / 10;
}

function gradeFromRating(r) {
  if (r >= 80) return { grade: 'S', color: '#f59e0b' };
  if (r >= 60) return { grade: 'A', color: '#22d3ee' };
  if (r >= 40) return { grade: 'B', color: '#4ade80' };
  if (r >= 25) return { grade: 'C', color: '#94a3b8' };
  return { grade: 'D', color: '#f87171' };
}

export default function PlayerDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [player, setPlayer] = useState(null);
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [playerRes, statsRes] = await Promise.all([
        fetch(`/api/players/${id}`),
        fetch(`/api/players/${id}/stats`),
      ]);
      const playerData = await playerRes.json();
      const statsData = await statsRes.json();
      setPlayer(playerData);
      setStats(statsData);
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

  const chartData = orderedStats.map(s => ({
    season: s.season_id.slice(0, 4),
    PTS: s.pts,
    G: s.g,
    A: s.a,
  }));

  const bestSeason = orderedStats.reduce((best, s) =>
    s.pts > (best?.pts ?? 0) ? s : best, null);

  const careerGP  = orderedStats.reduce((sum, s) => sum + s.gp, 0);
  const careerG   = orderedStats.reduce((sum, s) => sum + s.g, 0);
  const careerA   = orderedStats.reduce((sum, s) => sum + s.a, 0);
  const careerPTS = orderedStats.reduce((sum, s) => sum + s.pts, 0);

  const latestSeason = orderedStats[orderedStats.length - 1];
  const rating = latestSeason ? calcRating(latestSeason.gp, latestSeason.pts, latestSeason.g, latestSeason.shots) : 0;
  const { grade, color: gradeColor } = gradeFromRating(rating);

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
        <div className="card" style={{ padding: 32, display: "grid", gridTemplateColumns: "1fr auto", gap: 24, alignItems: "start" }}>
          <div>
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
          <div style={{ textAlign: "center", background: "#111c2d", borderRadius: 16, padding: "20px 28px" }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".08em" }}>Grade</div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 72, color: gradeColor, lineHeight: 1 }}>{grade}</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Rating: {rating}</div>
          </div>
        </div>

        {/* Chart */}
        {chartData.length > 1 && (
          <div className="card" style={{ padding: 28 }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, marginBottom: 20 }}>Points Per Season</div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2d40" />
                <XAxis dataKey="season" tick={{ fill: "#64748b", fontSize: 11 }} />
                <YAxis tick={{ fill: "#64748b", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#0d1623", border: "1px solid #1e2d40", borderRadius: 8 }} />
                <Line type="monotone" dataKey="PTS" stroke="#22d3ee" strokeWidth={2.5} dot={{ r: 3, fill: "#22d3ee" }} />
                <Line type="monotone" dataKey="G"   stroke="#4ade80" strokeWidth={1.5} dot={{ r: 2, fill: "#4ade80" }} />
                <Line type="monotone" dataKey="A"   stroke="#818cf8" strokeWidth={1.5} dot={{ r: 2, fill: "#818cf8" }} />
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
