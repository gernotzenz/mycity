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
  cells: Cell[],
  startAtChurch = false // Spiel 6: erstes Gebäude an der gedruckten Kirche
): ValidationResult {
  const covered = coveredMap(placements);
  for (const [r, c] of cells) {
    if (!inBounds(board, r, c)) return { ok: false, reason: 'Außerhalb des Spielfelds' };
    const t = board.grid[r][c];
    if (t === '~') return { ok: false, reason: 'Nicht über den Fluss bauen' };
    if (!isBuildable(t)) return { ok: false, reason: 'Dieses Feld darf nicht überbaut werden' };
    if (covered.has(key(r, c))) return { ok: false, reason: 'Feld ist schon bebaut' };
  }

  if (placements.length === 0) {
    if (startAtChurch) {
      const touchesChurch = cells.some(([r, c]) =>
        DIRS.some(([dr, dc]) => {
          const nr = r + dr;
          const nc = c + dc;
          return inBounds(board, nr, nc) && board.grid[nr][nc] === 'K';
        })
      );
      if (!touchesChurch)
        return { ok: false, reason: 'Das erste Gebäude muss an die gedruckte Kirche angrenzen' };
      return { ok: true };
    }
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

  // Weitere Gebäude: an ein vorhandenes Gebäude angrenzen (auch über den
  // Fluss hinweg). Die gedruckte Kirche zählt ebenfalls als Gebäude.
  const own = new Set(cells.map(([r, c]) => key(r, c)));
  const adjacent = cells.some(([r, c]) =>
    neighborsAcrossRiver(board, r, c).some(
      ([nr, nc]) =>
        !own.has(key(nr, nc)) &&
        (covered.has(key(nr, nc)) || board.grid[nr][nc] === 'K')
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
  wellPoints: number | null; // Spiele mit Brunnen
  churchPoints: number | null; // ab Spiel 5
  total: number;
}

const BUILDING_TYPES_3: BuildingType[] = ['wohn', 'gewerbe', 'oeffentlich'];

export function scoreGame(
  board: BoardDef,
  player: PlayerState,
  gameNo: number
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

  // Spiel 6: Passen ist nicht möglich, daher auch keine Strafpunkte.
  const passPoints =
    gameNo === 6 ? 0 : PASS_PENALTY[Math.min(player.passes, PASS_PENALTY.length - 1)];

  // Gebäudegruppen (ab Spiel 2): größte zusammenhängende Gruppe je Gebäudeart.
  // Kirchen zählen zu keiner der drei Gebäudearten.
  let groupPoints: Record<BuildingType, number> | null = null;
  if (gameNo >= 2) {
    groupPoints = { wohn: 0, gewerbe: 0, oeffentlich: 0 };
    const n = player.placements.length;
    // Adjazenz zwischen Gebäuden gleicher Art (auch über den Fluss).
    const adj: number[][] = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
      if (player.placements[i].type === 'kirche') continue;
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
      if (seen[i] || player.placements[i].type === 'kirche') continue;
      const type = player.placements[i].type as BuildingType;
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

  // Brunnen: +4 wenn an allen 4 Seiten Gebäude angrenzen (4 verschiedene
  // Gebäude) und der Brunnen nicht überbaut wurde. Nur auf Blättern mit Brunnen.
  let wellPoints: number | null = null;
  const hasWells = board.grid.some((row) => row.includes('W'));
  if (hasWells) {
    wellPoints = 0;
    for (let r = 0; r < board.h; r++) {
      for (let c = 0; c < board.w; c++) {
        if (board.grid[r][c] !== 'W' || covered.has(key(r, c))) continue;
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
          if (idx !== undefined) {
            neighborBuildings.add('p' + idx);
          } else if (board.grid[nr][nc] === 'K') {
            neighborBuildings.add('k'); // gedruckte Kirche zählt als Gebäude
          } else {
            allSidesBuilt = false;
          }
        }
        if (allSidesBuilt && neighborBuildings.size >= 4) wellPoints += 4;
      }
    }
  }

  // Kirchenpunkte (ab Spiel 5): +3 je Kirche, an die Gebäude aller
  // 3 Gebäudearten angrenzen. Gilt auch für die gedruckte Kirche (Spiel 6).
  let churchPoints: number | null = null;
  if (gameNo >= 5) {
    churchPoints = 0;
    const churchAreas: Cell[][] = player.placements
      .filter((p) => p.type === 'kirche')
      .map((p) => p.cells);
    const printed: Cell[] = [];
    for (let r = 0; r < board.h; r++)
      for (let c = 0; c < board.w; c++) if (board.grid[r][c] === 'K') printed.push([r, c]);
    if (printed.length) churchAreas.push(printed);

    for (const area of churchAreas) {
      const own = new Set(area.map(([r, c]) => key(r, c)));
      const types = new Set<string>();
      for (const [r, c] of area) {
        for (const [nr, nc] of neighborsAcrossRiverExport(board, r, c)) {
          if (own.has(key(nr, nc))) continue;
          const idx = covered.get(key(nr, nc));
          if (idx !== undefined) {
            const t = player.placements[idx].type;
            if (t !== 'kirche') types.add(t);
          }
        }
      }
      if (BUILDING_TYPES_3.every((t) => types.has(t))) churchPoints += 3;
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
    (churchPoints ?? 0);

  return {
    passes: player.passes,
    passPoints,
    treePoints,
    stonePoints,
    emptyPoints,
    groupPoints,
    wellPoints,
    churchPoints,
    total,
  };
}

function neighborsAcrossRiverExport(board: BoardDef, r: number, c: number): Cell[] {
  return neighborsAcrossRiver(board, r, c);
}
