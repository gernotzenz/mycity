import type { BoardDef, CellType } from './board';
import { cellsOfType, edgeKey, isBuildable, isPrintedBuilding, treeCount, totalTrees } from './board';
import type { BuildingType, Cell, Placement, PlayerState } from './types';
import { PASS_PENALTY } from './types';

const DIRS: Cell[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function key(r: number, c: number): string {
  return r + ',' + c;
}

export function coveredMap(placements: Placement[]): Map<string, number> {
  const m = new Map<string, number>();
  placements.forEach((p, i) => p.cells.forEach(([r, c]) => m.set(key(r, c), i)));
  return m;
}

function inBounds(board: BoardDef, r: number, c: number): boolean {
  return r >= 0 && r < board.h && c >= 0 && c < board.w;
}

// Orthogonale Nachbarn. Der schmale Fluss (auf den Linien) verhindert
// Angrenzung NICHT; breite Flussfelder (R) trennen automatisch, weil sie
// selbst Felder belegen.
function neighbors(board: BoardDef, r: number, c: number): Cell[] {
  const out: Cell[] = [];
  for (const [dr, dc] of DIRS) {
    const nr = r + dr;
    const nc = c + dc;
    if (inBounds(board, nr, nc)) out.push([nr, nc]);
  }
  return out;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export interface PlacementOptions {
  freePlacement?: boolean; // Festung: beliebiges freies Feld, keine Angrenzung
}

export function validatePlacement(
  board: BoardDef,
  placements: Placement[],
  cells: Cell[],
  opts: PlacementOptions = {}
): ValidationResult {
  const covered = coveredMap(placements);
  for (const [r, c] of cells) {
    if (!inBounds(board, r, c)) return { ok: false, reason: 'Außerhalb des Spielfelds' };
    const t = board.grid[r][c];
    if (!isBuildable(t, board.forestBuildable))
      return { ok: false, reason: 'Dieses Feld darf nicht überbaut werden' };
    if (covered.has(key(r, c))) return { ok: false, reason: 'Feld ist schon bebaut' };
  }

  // Nicht über den Fluss bauen (keine zwei Felder durch die Flusslinie getrennt).
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const [r1, c1] = cells[i];
      const [r2, c2] = cells[j];
      if (Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1) {
        if (board.blockedEdges.has(edgeKey(r1, c1, r2, c2))) {
          return { ok: false, reason: 'Nicht über den Fluss bauen' };
        }
      }
    }
  }

  // Festungen dürfen frei platziert werden.
  if (opts.freePlacement) return { ok: true };

  const isFirst = placements.length === 0;
  if (isFirst && board.startAt === 'river') {
    const touchesRiver = cells.some(([r, c]) => board.riverCells.has(key(r, c)));
    if (!touchesRiver)
      return { ok: false, reason: 'Das erste Gebäude muss an den Fluss angrenzen' };
    return { ok: true };
  }

  if (isFirst) {
    // Start an gedrucktem Gebäude (Kirche, Sägewerk oder Festung).
    const label =
      board.startAt === 'church'
        ? 'an die gedruckte Kirche'
        : board.startAt === 'sawmill'
          ? 'an das Sägewerk'
          : 'an eine Festung';
    const touches = cells.some(([r, c]) =>
      neighbors(board, r, c).some(([nr, nc]) => isPrintedBuilding(board.grid[nr][nc]))
    );
    if (!touches) return { ok: false, reason: `Das erste Gebäude muss ${label} angrenzen` };
    return { ok: true };
  }

  // Weitere Gebäude: an vorhandenes Gebäude, gedrucktes Gebäude oder eigene
  // Festung angrenzen (auch über den schmalen Fluss hinweg).
  const own = new Set(cells.map(([r, c]) => key(r, c)));
  const adjacent = cells.some(([r, c]) =>
    neighbors(board, r, c).some(
      ([nr, nc]) =>
        !own.has(key(nr, nc)) &&
        (covered.has(key(nr, nc)) || isPrintedBuilding(board.grid[nr][nc]))
    )
  );
  if (!adjacent) return { ok: false, reason: 'Muss an ein vorhandenes Gebäude angrenzen' };
  return { ok: true };
}

// ---- Wertung ----

export interface ScoreBreakdown {
  passes: number;
  passPoints: number;
  treePoints: number;
  stonePoints: number;
  emptyPoints: number;
  groupPoints: Record<BuildingType, number> | null; // ab Spiel 2
  wellPoints: number | null;
  churchPoints: number | null; // Spiele 5+6
  targetBonus: number | null; // Hochebenen/Wald/Gold komplett (+5, Kapitel 3)
  banditPoints: number | null; // Kapitel 4
  fullGroupPoints: number | null; // vollständige Gruppen (Spiele 11+12)
  bags: number; // Geldbeutel (Kapitel 3)
  total: number;
}

const BUILDING_TYPES_3: BuildingType[] = ['wohn', 'gewerbe', 'oeffentlich'];

// Zielfelder von Kapitel 3 je Spiel: Hochebenen / Waldfelder / Goldfelder.
function targetType(gameNo: number): CellType | null {
  return gameNo === 7 ? 'H' : gameNo === 8 ? 'F' : gameNo === 9 ? 'G' : null;
}

// Runde, in der der Spieler alle Zielfelder überbaut hat (oder null).
export function targetCompletionRound(board: BoardDef, player: PlayerState, gameNo: number): number | null {
  const t = targetType(gameNo);
  if (!t) return null;
  const targets = cellsOfType(board, t);
  if (targets.length === 0) return null;
  let maxRound = 0;
  for (const [r, c] of targets) {
    const p = player.placements.find((pl) => pl.cells.some(([pr, pc]) => pr === r && pc === c));
    if (!p) return null;
    maxRound = Math.max(maxRound, p.round);
  }
  return maxRound;
}

export function scoreGame(
  board: BoardDef,
  player: PlayerState,
  gameNo: number,
  firstCoverBonus = false // +5 für "als Erster alle Zielfelder überbaut"
): ScoreBreakdown {
  const covered = coveredMap(player.placements);

  let treePoints = 0;
  let stonePoints = 0;
  let emptyPoints = 0;
  let uncoveredStones = 0;
  let emptyCount = 0;

  for (let r = 0; r < board.h; r++) {
    for (let c = 0; c < board.w; c++) {
      const t = board.grid[r][c];
      if (covered.has(key(r, c))) continue;
      if (t === 'T' || t === 'D') treePoints += treeCount(t);
      else if (t === 'S') uncoveredStones++;
      else if (t === '.' || t === 'H' || (t === 'F' && board.forestBuildable)) emptyCount++;
      // Goldfelder (G) und Brunnen (W) bringen leer keinen Abzug.
    }
  }
  // Je nicht überbautem Steinfeld -1 Punkt (das Feld zeigt zwar zwei
  // Steine, zählt aber als EIN Stein).
  stonePoints = -uncoveredStones;
  emptyPoints = -emptyCount;

  // Spiel 12: Bonuswertungen
  if (gameNo === 12) {
    if (treePoints === totalTrees(board)) treePoints = 20; // alle 14 Bäume -> +20
    if (uncoveredStones === 0) stonePoints = 6;
    if (emptyCount === 0) emptyPoints = 12;
  }

  // Passen: Spiel 6 nicht möglich; Spiel 12: 0-mal passen -> +6
  let passPoints =
    gameNo === 6 ? 0 : PASS_PENALTY[Math.min(player.passes, PASS_PENALTY.length - 1)];
  if (gameNo === 12 && player.passes === 0) passPoints = 6;

  // Gebäudegruppen (ab Spiel 2): größte zusammenhängende Gruppe je Art.
  let groupPoints: Record<BuildingType, number> | null = null;
  const n = player.placements.length;
  const isNormalType = (i: number) =>
    player.placements[i].type !== 'kirche' && player.placements[i].type !== 'festung';
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (const [r, c] of player.placements[i].cells) {
      for (const [nr, nc] of neighbors(board, r, c)) {
        const j = covered.get(key(nr, nc));
        if (j !== undefined && j !== i && player.placements[j].type === player.placements[i].type) {
          adj[i].push(j);
        }
      }
    }
  }
  const componentSizes: { type: string; size: number }[] = [];
  {
    const seen = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      if (seen[i]) continue;
      let size = 0;
      const stack = [i];
      seen[i] = true;
      while (stack.length) {
        const cur = stack.pop()!;
        size++;
        for (const j of adj[cur]) {
          if (!seen[j]) {
            seen[j] = true;
            stack.push(j);
          }
        }
      }
      componentSizes.push({ type: player.placements[i].type, size });
    }
  }
  if (gameNo >= 2) {
    groupPoints = { wohn: 0, gewerbe: 0, oeffentlich: 0 };
    for (const comp of componentSizes) {
      if (comp.type === 'kirche' || comp.type === 'festung') continue;
      const t = comp.type as BuildingType;
      if (comp.size > groupPoints[t]) groupPoints[t] = comp.size;
    }
  }

  // Vollständige Gruppen (Spiel 11: +3, Spiel 12: +6): alle Gebäude einer Art
  // bilden eine einzige Gruppe.
  let fullGroupPoints: number | null = null;
  if (gameNo >= 11) {
    fullGroupPoints = 0;
    const per = gameNo === 12 ? 6 : 3;
    for (const t of BUILDING_TYPES_3) {
      const comps = componentSizes.filter((c) => c.type === t);
      if (comps.length === 1) fullGroupPoints += per;
    }
  }

  // Brunnen: +4 je Brunnen mit 4 angrenzenden Gebäuden.
  let wellPoints: number | null = null;
  const wells = cellsOfType(board, 'W');
  if (wells.length > 0) {
    wellPoints = 0;
    for (const [r, c] of wells) {
      if (covered.has(key(r, c))) continue;
      const neighborBuildings = new Set<string>();
      let allSidesBuilt = true;
      for (const [dr, dc] of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inBounds(board, nr, nc)) {
          allSidesBuilt = false;
          continue;
        }
        const idx = covered.get(key(nr, nc));
        if (idx !== undefined) neighborBuildings.add('p' + idx);
        else if (isPrintedBuilding(board.grid[nr][nc])) neighborBuildings.add(key(nr, nc));
        else allSidesBuilt = false;
      }
      if (allSidesBuilt && neighborBuildings.size >= 4) wellPoints += 4;
    }
  }

  // Kirchenpunkte (Spiele 5+6): +3 je Kirche mit allen 3 Gebäudearten angrenzend.
  let churchPoints: number | null = null;
  if (gameNo === 5 || gameNo === 6) {
    churchPoints = 0;
    const churchAreas: Cell[][] = player.placements
      .filter((p) => p.type === 'kirche')
      .map((p) => p.cells);
    const printed = cellsOfType(board, 'K');
    if (printed.length) churchAreas.push(printed);
    for (const area of churchAreas) {
      const own = new Set(area.map(([r, c]) => key(r, c)));
      const types = new Set<string>();
      for (const [r, c] of area) {
        for (const [nr, nc] of neighbors(board, r, c)) {
          if (own.has(key(nr, nc))) continue;
          const idx = covered.get(key(nr, nc));
          if (idx !== undefined) {
            const t = player.placements[idx].type;
            if (t !== 'kirche' && t !== 'festung') types.add(t);
          }
        }
      }
      if (BUILDING_TYPES_3.every((t) => types.has(t))) churchPoints += 3;
    }
  }

  // Kapitel 3: Zielfelder-Bonus und Geldbeutel.
  let targetBonus: number | null = null;
  let bags = 0;
  const tType = targetType(gameNo);
  if (tType) {
    targetBonus = firstCoverBonus ? 5 : 0;
    const completed = targetCompletionRound(board, player, gameNo) != null;
    if (completed) bags += gameNo === 9 ? 2 : 1;
    if (player.passes === 0) bags += 1; // Belohnung für "nicht passen" (Kapitel 3)
  }

  // Kapitel 4: nicht umzingelte Banditen.
  let banditPoints: number | null = null;
  if (gameNo >= 10) {
    banditPoints = 0;
    const per = gameNo === 12 ? -6 : -3;
    for (const [r, c] of cellsOfType(board, 'B')) {
      let surrounded = true;
      for (const [dr, dc] of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inBounds(board, nr, nc)) {
          surrounded = false;
          continue;
        }
        if (!covered.has(key(nr, nc)) && !isPrintedBuilding(board.grid[nr][nc])) {
          surrounded = false;
        }
      }
      if (!surrounded) banditPoints += per;
    }
  }

  const groupSum = groupPoints
    ? groupPoints.wohn + groupPoints.gewerbe + groupPoints.oeffentlich
    : 0;
  const total =
    passPoints +
    treePoints +
    stonePoints +
    emptyPoints +
    groupSum +
    (wellPoints ?? 0) +
    (churchPoints ?? 0) +
    (targetBonus ?? 0) +
    (banditPoints ?? 0) +
    (fullGroupPoints ?? 0);

  return {
    passes: player.passes,
    passPoints,
    treePoints,
    stonePoints,
    emptyPoints,
    groupPoints,
    wellPoints,
    churchPoints,
    targetBonus,
    banditPoints,
    fullGroupPoints,
    bags,
    total,
  };
}

// Nicht umzingelte Banditen (werden ins nächste Spiel übertragen).
export function unsurroundedBandits(board: BoardDef, player: PlayerState): Cell[] {
  const covered = coveredMap(player.placements);
  const out: Cell[] = [];
  for (const [r, c] of cellsOfType(board, 'B')) {
    let surrounded = true;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inBounds(board, nr, nc)) {
        surrounded = false;
        continue;
      }
      if (!covered.has(key(nr, nc)) && !isPrintedBuilding(board.grid[nr][nc])) surrounded = false;
    }
    if (!surrounded) out.push([r, c]);
  }
  return out;
}
