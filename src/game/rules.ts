import type { BoardDef } from './board';
import { isBuildable, treeCount } from './board';
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

// Nachbarn eines Feldes; über Flussfelder hinweg zählt das erste
// Nicht-Fluss-Feld als angrenzend ("Gebäude gelten auch dann als
// angrenzend, wenn der Fluss zwischen ihnen verläuft").
function neighborsAcrossRiver(board: BoardDef, r: number, c: number): Cell[] {
  const out: Cell[] = [];
  for (const [dr, dc] of DIRS) {
    let nr = r + dr;
    let nc = c + dc;
    while (inBounds(board, nr, nc) && board.grid[nr][nc] === '~') {
      nr += dr;
      nc += dc;
    }
    if (inBounds(board, nr, nc)) out.push([nr, nc]);
  }
  return out;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validatePlacement(
  board: BoardDef,
  placements: Placement[],
  cells: Cell[]
): ValidationResult {
  const covered = coveredMap(placements);
  for (const [r, c] of cells) {
    if (!inBounds(board, r, c)) return { ok: false, reason: 'Außerhalb des Spielfelds' };
    const t = board.grid[r][c];
    if (t === '~') return { ok: false, reason: 'Nicht über den Fluss bauen' };
    if (!isBuildable(t)) return { ok: false, reason: 'Gebirge und Wald dürfen nicht überbaut werden' };
    if (covered.has(key(r, c))) return { ok: false, reason: 'Feld ist schon bebaut' };
  }

  if (placements.length === 0) {
    // Erstes Gebäude: muss mit mindestens einer Seite an den Fluss angrenzen.
    const touchesRiver = cells.some(([r, c]) =>
      DIRS.some(([dr, dc]) => {
        const nr = r + dr;
        const nc = c + dc;
        return inBounds(board, nr, nc) && board.grid[nr][nc] === '~';
      })
    );
    if (!touchesRiver) return { ok: false, reason: 'Das erste Gebäude muss an den Fluss angrenzen' };
    return { ok: true };
  }

  // Weitere Gebäude: an ein vorhandenes Gebäude angrenzen (auch über den Fluss).
  const own = new Set(cells.map(([r, c]) => key(r, c)));
  const adjacent = cells.some(([r, c]) =>
    neighborsAcrossRiver(board, r, c).some(
      ([nr, nc]) => !own.has(key(nr, nc)) && covered.has(key(nr, nc))
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
  wellPoints: number | null; // ab Spiel 3
  total: number;
}

export function scoreGame(
  board: BoardDef,
  player: PlayerState,
  gameNo: 1 | 2 | 3
): ScoreBreakdown {
  const covered = coveredMap(player.placements);
  let treePoints = 0;
  let stonePoints = 0;
  let emptyPoints = 0;

  for (let r = 0; r < board.h; r++) {
    for (let c = 0; c < board.w; c++) {
      const t = board.grid[r][c];
      if (covered.has(key(r, c))) continue;
      if (t === 'T' || t === 'D') treePoints += treeCount(t);
      else if (t === 'S') stonePoints -= 1;
      else if (t === '.') emptyPoints -= 1;
    }
  }

  const passPoints = PASS_PENALTY[Math.min(player.passes, PASS_PENALTY.length - 1)];

  // Gebäudegruppen (ab Spiel 2): größte zusammenhängende Gruppe je Gebäudeart.
  let groupPoints: Record<BuildingType, number> | null = null;
  if (gameNo >= 2) {
    groupPoints = { wohn: 0, gewerbe: 0, oeffentlich: 0 };
    const n = player.placements.length;
    // Adjazenz zwischen Gebäuden gleicher Art (auch über den Fluss).
    const adj: number[][] = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
      for (const [r, c] of player.placements[i].cells) {
        for (const [nr, nc] of neighborsAcrossRiverExport(board, r, c)) {
          const j = covered.get(key(nr, nc));
          if (j !== undefined && j !== i && player.placements[j].type === player.placements[i].type) {
            adj[i].push(j);
          }
        }
      }
    }
    const seen = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      if (seen[i]) continue;
      const type = player.placements[i].type;
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
      if (size > groupPoints[type]) groupPoints[type] = size;
    }
  }

  // Brunnen (Spiel 3): +4 wenn an allen 4 Seiten Gebäude angrenzen
  // (4 verschiedene Gebäude) und der Brunnen nicht überbaut wurde.
  let wellPoints: number | null = null;
  if (gameNo >= 3) {
    wellPoints = 0;
    for (let r = 0; r < board.h; r++) {
      for (let c = 0; c < board.w; c++) {
        if (board.grid[r][c] !== 'W' || covered.has(key(r, c))) continue;
        const neighborBuildings = new Set<number>();
        let allSidesBuilt = true;
        for (const [dr, dc] of DIRS) {
          const nr = r + dr;
          const nc = c + dc;
          const idx = inBounds(board, nr, nc) ? covered.get(key(nr, nc)) : undefined;
          if (idx === undefined) {
            allSidesBuilt = false;
          } else {
            neighborBuildings.add(idx);
          }
        }
        if (allSidesBuilt && neighborBuildings.size >= 4) wellPoints += 4;
      }
    }
  }

  const groupSum = groupPoints
    ? groupPoints.wohn + groupPoints.gewerbe + groupPoints.oeffentlich
    : 0;
  const total =
    passPoints + treePoints + stonePoints + emptyPoints + groupSum + (wellPoints ?? 0);

  return {
    passes: player.passes,
    passPoints,
    treePoints,
    stonePoints,
    emptyPoints,
    groupPoints,
    wellPoints,
    total,
  };
}

function neighborsAcrossRiverExport(board: BoardDef, r: number, c: number): Cell[] {
  return neighborsAcrossRiver(board, r, c);
}
