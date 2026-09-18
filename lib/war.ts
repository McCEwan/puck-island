// WAR (Wins Above Replacement) for skaters.
//
// Scope: this implements the parts of a modern WAR model that are buildable
// from data we actually have — it is NOT full shift-level RAPM. Two
// simplifications versus a "real" model like Evolving-Hockey/JFresh:
//
//  1. On-ice impact (xgf/xga while a player is on the ice) is used directly
//     as a proxy for isolated impact, instead of a true RAPM regression that
//     controls for teammates/opponents/zone starts via shift-level data. We
//     don't have shift-level play-by-play, so this is the standard fallback.
//  2. No arena scorer-bias correction (no source for rink bias factors).
//
// Everything else — position-specific replacement level, per-situation
// (5v5/PP/PK) components, Bayesian-shrunk finishing adjustment, and the
// goals -> wins conversion — is real and derived from data, not guessed.

// MoneyPuck's `icetime` column is in SECONDS (verified against known TOI/GP).
export function per60Min(stat: number, icetimeSeconds: number): number {
  return icetimeSeconds > 0 ? (stat * 3600) / icetimeSeconds : 0;
}

export type TeamSeasonRow = { gp: number; wins: number; gf: number; ga: number };

// Empirical wins-per-goal, fit from team_season_stats: wins ~ a + b * goalDiff,
// both normalized to an 82-game season. Falls back to the standard "~6 goals
// = 1 win" heuristic (1/6 ≈ 0.1667) if there isn't enough data to fit.
export function deriveWinsPerGoal(teamSeasons: TeamSeasonRow[]): number {
  const pts = teamSeasons
    .filter(t => t.gp > 0)
    .map(t => {
      const scale = 82 / t.gp;
      return { x: (t.gf - t.ga) * scale, y: t.wins * scale };
    });

  const n = pts.length;
  if (n < 10) return 1 / 6;

  const sumX  = pts.reduce((s, p) => s + p.x, 0);
  const sumY  = pts.reduce((s, p) => s + p.y, 0);
  const sumXY = pts.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = pts.reduce((s, p) => s + p.x * p.x, 0);

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 1 / 6;

  return (n * sumXY - sumX * sumY) / denom;
}

export type IceTimeEntry = { icetimeSeconds: number; value60: number };

// Replacement level = TOI-weighted average per-60 rate among the bottom
// `replacementFraction` of a position group by ice time — i.e. the calibre of
// player who'd actually be available to replace someone (depth players),
// not the league-average player.
export function replacementRate60(entries: IceTimeEntry[], replacementFraction = 1 / 3): number {
  if (entries.length === 0) return 0;
  const sorted = [...entries].sort((a, b) => a.icetimeSeconds - b.icetimeSeconds);
  const cut = Math.max(1, Math.floor(sorted.length * replacementFraction));
  const pool = sorted.slice(0, cut);
  const totalIce = pool.reduce((s, e) => s + e.icetimeSeconds, 0);
  if (totalIce <= 0) return 0;
  return pool.reduce((s, e) => s + e.value60 * e.icetimeSeconds, 0) / totalIce;
}

// Goals-above-replacement for one situation: (player rate - replacement rate)
// * TOI, in 60-minute units. `invert` flips the sign for against-type stats
// (xga) where lower is better.
export function gar(value60: number, replacement60: number, icetimeSeconds: number, invert = false): number {
  const diff = invert ? replacement60 - value60 : value60 - replacement60;
  return diff * (icetimeSeconds / 3600);
}

// Bayesian-shrunk finishing adjustment: how many goals a player scored above
// what their shot volume + shot quality (individual xG) would predict,
// regressed toward the league-average finishing rate when shots are few.
export function finishingGAR(
  actualGoals: number,
  individualXG: number,
  shots: number,
  leagueAvgFinishingRate: number,
  fullCredibilityShots = 100
): number {
  if (shots <= 0) return 0;
  const rawRate = (actualGoals - individualXG) / shots;
  const credibility = Math.min(shots / fullCredibilityShots, 1);
  const adjustedRate = credibility * rawRate + (1 - credibility) * leagueAvgFinishingRate;
  return adjustedRate * shots;
}

export type WARComponents = {
  offenseGAR: number;
  defenseGAR: number;
  ppGAR: number;
  pkGAR: number;
  finishingGAR: number;
  totalGAR: number;
  war: number;
};

export function assembleWAR(components: Omit<WARComponents, 'totalGAR' | 'war'>, winsPerGoal: number): WARComponents {
  const totalGAR = components.offenseGAR + components.defenseGAR + components.ppGAR + components.pkGAR + components.finishingGAR;
  return { ...components, totalGAR, war: totalGAR * winsPerGoal };
}
