// Per-60 helper — icetime is in minutes in MoneyPuck
function per60(stat: number, icetime: number) {
  return icetime > 0 ? (stat / icetime) * 60 : 0;
}

// Percentile rank within an array (0-100)
function percentileRank(value: number, values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const below = sorted.filter(v => v < value).length;
  return Math.round((below / sorted.length) * 100);
}

export type SituationStats = {
  situation: string;
  icetime: number;
  games_played: number;
  xgf: number; xga: number;
  cf: number;  ca: number;
  ff: number;  fa: number;
  scf: number; sca: number;
  points: number;
  goals: number;
  shots_blocked: number;
};

export type PlayerRatings = {
  overall: number | null;
  offense: number | null;
  defense: number | null;
  powerPlay: number | null;
  penaltyKill: number | null;
  ppEligible: boolean;
  pkEligible: boolean;
  grade: string;
  gradeColor: string;
};

// Call this with one player's stats array + ALL players' stats for percentile context
export function calcPlayerRatings(
  playerStats: SituationStats[],
  allPlayerStats: SituationStats[][],
  position: string
): PlayerRatings {
  const isD = position === 'D';

  const get = (sit: string) => playerStats.find(s => s.situation === sit);
  const v5  = get('5on5');
  const pp  = get('5on4');
  const pk  = get('4on5');

  // Minimum thresholds (icetime in minutes)
  const ppEligible = !!pp && (pp.icetime / (v5?.games_played || 1)) >= 0.5;
  const pkEligible = !!pk && (pk.icetime / (v5?.games_played || 1)) >= 0.5;

  // Build percentile lookup arrays from all players
  function buildPctArray(sit: string, fn: (s: SituationStats) => number) {
    return allPlayerStats
      .map(ps => ps.find(s => s.situation === sit))
      .filter(Boolean)
      .map(s => fn(s!));
  }

  // 5v5 offense
  let offense: number | null = null;
  if (v5 && v5.icetime > 0) {
    const xgf60  = per60(v5.xgf, v5.icetime);
    const cf60   = per60(v5.cf,  v5.icetime);
    const ff60   = per60(v5.ff,  v5.icetime);
    const pts60  = per60(v5.points, v5.icetime);

    const xgf60s = buildPctArray('5on5', s => per60(s.xgf, s.icetime));
    const cf60s  = buildPctArray('5on5', s => per60(s.cf,  s.icetime));
    const ff60s  = buildPctArray('5on5', s => per60(s.ff,  s.icetime));
    const pts60s = buildPctArray('5on5', s => per60(s.points, s.icetime));

    if (isD) {
      offense = Math.round(
        percentileRank(xgf60, xgf60s) * 0.30 +
        percentileRank(cf60,  cf60s)  * 0.25 +
        percentileRank(ff60,  ff60s)  * 0.20 +
        percentileRank(pts60, pts60s) * 0.25
      );
    } else {
      offense = Math.round(
        percentileRank(xgf60, xgf60s) * 0.40 +
        percentileRank(cf60,  cf60s)  * 0.30 +
        percentileRank(ff60,  ff60s)  * 0.20 +
        percentileRank(pts60, pts60s) * 0.10
      );
    }
  }

  // 5v5 defense (lower xga/ca/fa = better, so invert)
  let defense: number | null = null;
  if (v5 && v5.icetime > 0) {
    const xga60 = per60(v5.xga, v5.icetime);
    const ca60  = per60(v5.ca,  v5.icetime);
    const fa60  = per60(v5.fa,  v5.icetime);
    const sca60 = per60(v5.sca, v5.icetime);
    const blk60 = per60(v5.shots_blocked, v5.icetime);

    const xga60s = buildPctArray('5on5', s => per60(s.xga, s.icetime));
    const ca60s  = buildPctArray('5on5', s => per60(s.ca,  s.icetime));
    const fa60s  = buildPctArray('5on5', s => per60(s.fa,  s.icetime));
    const sca60s = buildPctArray('5on5', s => per60(s.sca, s.icetime));
    const blk60s = buildPctArray('5on5', s => per60(s.shots_blocked, s.icetime));

    // Invert prevention stats (lower = better → higher percentile)
    const invPct = (v: number, arr: number[]) => 100 - percentileRank(v, arr);

    if (isD) {
      defense = Math.round(
        invPct(xga60, xga60s) * 0.40 +
        invPct(ca60,  ca60s)  * 0.25 +
        invPct(fa60,  fa60s)  * 0.20 +
        invPct(sca60, sca60s) * 0.15
      );
    } else {
      defense = Math.round(
        invPct(xga60, xga60s) * 0.40 +
        invPct(ca60,  ca60s)  * 0.30 +
        invPct(fa60,  fa60s)  * 0.20 +
        invPct(sca60, sca60s) * 0.10
      );
    }
  }

  // Power play
  let powerPlay: number | null = null;
  if (ppEligible && pp && pp.icetime > 0) {
    const xgf60 = per60(pp.xgf,    pp.icetime);
    const cf60  = per60(pp.cf,     pp.icetime);
    const pts60 = per60(pp.points, pp.icetime);

    const xgf60s = buildPctArray('5on4', s => per60(s.xgf,    s.icetime));
    const cf60s  = buildPctArray('5on4', s => per60(s.cf,     s.icetime));
    const pts60s = buildPctArray('5on4', s => per60(s.points, s.icetime));

    if (isD) {
      powerPlay = Math.round(
        percentileRank(xgf60, xgf60s) * 0.40 +
        percentileRank(cf60,  cf60s)  * 0.25 +
        percentileRank(pts60, pts60s) * 0.35
      );
    } else {
      powerPlay = Math.round(
        percentileRank(xgf60, xgf60s) * 0.45 +
        percentileRank(cf60,  cf60s)  * 0.30 +
        percentileRank(pts60, pts60s) * 0.25
      );
    }
  }

  // Penalty kill
  let penaltyKill: number | null = null;
  if (pkEligible && pk && pk.icetime > 0) {
    const xga60 = per60(pk.xga,   pk.icetime);
    const ca60  = per60(pk.ca,    pk.icetime);
    const ga60  = per60(pk.goals, pk.icetime); // goals against
    const sca60 = per60(pk.sca,   pk.icetime);
    const blk60 = per60(pk.shots_blocked, pk.icetime);

    const xga60s = buildPctArray('4on5', s => per60(s.xga,   s.icetime));
    const ca60s  = buildPctArray('4on5', s => per60(s.ca,    s.icetime));
    const ga60s  = buildPctArray('4on5', s => per60(s.goals, s.icetime));
    const sca60s = buildPctArray('4on5', s => per60(s.sca,   s.icetime));
    const blk60s = buildPctArray('4on5', s => per60(s.shots_blocked, s.icetime));

    const invPct = (v: number, arr: number[]) => 100 - percentileRank(v, arr);

    if (isD) {
      penaltyKill = Math.round(
        invPct(xga60, xga60s) * 0.40 +
        invPct(ca60,  ca60s)  * 0.25 +
        invPct(ga60,  ga60s)  * 0.20 +
        invPct(sca60, sca60s) * 0.15
      );
    } else {
      penaltyKill = Math.round(
        invPct(xga60, xga60s) * 0.50 +
        invPct(ca60,  ca60s)  * 0.30 +
        invPct(ga60,  ga60s)  * 0.20
      );
    }
  }

  // Overall — redistribute weights if PP or PK missing
  let overall: number | null = null;
  if (offense !== null && defense !== null) {
    if (isD) {
      if (powerPlay !== null && penaltyKill !== null) {
        overall = Math.round(offense * 0.30 + defense * 0.40 + powerPlay * 0.15 + penaltyKill * 0.15);
      } else if (powerPlay !== null) {
        overall = Math.round(offense * 0.35 + defense * 0.47 + powerPlay * 0.18);
      } else if (penaltyKill !== null) {
        overall = Math.round(offense * 0.35 + defense * 0.47 + penaltyKill * 0.18);
      } else {
        overall = Math.round(offense * 0.43 + defense * 0.57);
      }
    } else {
      if (powerPlay !== null && penaltyKill !== null) {
        overall = Math.round(offense * 0.45 + defense * 0.25 + powerPlay * 0.20 + penaltyKill * 0.10);
      } else if (powerPlay !== null) {
        overall = Math.round(offense * 0.50 + defense * 0.28 + powerPlay * 0.22);
      } else if (penaltyKill !== null) {
        overall = Math.round(offense * 0.56 + defense * 0.31 + penaltyKill * 0.13);
      } else {
        overall = Math.round(offense * 0.64 + defense * 0.36);
      }
    }
  }

  const { grade, gradeColor } = getGrade(overall ?? 0);

  return { overall, offense, defense, powerPlay, penaltyKill, ppEligible, pkEligible, grade, gradeColor };
}

function getGrade(overall: number) {
  if (overall >= 90) return { grade: 'S+', gradeColor: '#f59e0b' };
  if (overall >= 80) return { grade: 'S',  gradeColor: '#f59e0b' };
  if (overall >= 70) return { grade: 'A+', gradeColor: '#22d3ee' };
  if (overall >= 60) return { grade: 'A',  gradeColor: '#22d3ee' };
  if (overall >= 50) return { grade: 'B+', gradeColor: '#4ade80' };
  if (overall >= 40) return { grade: 'B',  gradeColor: '#4ade80' };
  if (overall >= 30) return { grade: 'C',  gradeColor: '#94a3b8' };
  return { grade: 'D', gradeColor: '#f87171' };
}
