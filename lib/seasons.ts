// NHL seasons run roughly October -> June. Before July we're still in the
// season that started the previous calendar year; from July onward (offseason
// signings, then October puck drop) we're already in the season starting this year.
export function getCurrentSeasonId(date: Date = new Date()): string {
  const month = date.getMonth() + 1; // 1-12
  const year = date.getFullYear();
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

export function getPreviousSeasonId(seasonId: string): string {
  const startYear = parseInt(seasonId.split('-')[0], 10) - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

export function seasonIdToCode(seasonId: string): number {
  const startYear = parseInt(seasonId.split('-')[0], 10);
  return startYear * 10000 + (startYear + 1);
}

// 2004-05 was cancelled by the lockout - no games, no season row.
const SEASONS_WITHOUT_PLAY = new Set(['2004-05']);

// All season ids from startYear up through whatever season is current right
// now, newest first. Extends itself automatically once a new season starts.
export function getAllSeasonIds(startYear = 2000, date: Date = new Date()): string[] {
  const currentStartYear = parseInt(getCurrentSeasonId(date).split('-')[0], 10);
  const ids: string[] = [];
  for (let year = currentStartYear; year >= startYear; year--) {
    const id = `${year}-${String(year + 1).slice(-2)}`;
    if (!SEASONS_WITHOUT_PLAY.has(id)) ids.push(id);
  }
  return ids;
}
