// Spielfelder aller 12 Spiele – rekonstruiert nach Fotos der Original-Blätter.
//
// Der (schmale) Fluss verläuft AUF DEN LINIEN zwischen den Feldern und wird
// als Pfad aus Gitterpunkten [y, x] definiert (y: 0..h, x: 0..w).
// In Spiel 7 gibt es zusätzlich BREITE Flussfelder (R), die Felder bedecken:
// dort ist Bauen unmöglich und gegenüberliegende Gebäude grenzen NICHT an.
//
// Zell-Legende:
//   .  = leeres Feld (bebaubar, am Ende -1 wenn leer)
//   T  = Baum (+1 wenn nicht überbaut)     D = Doppelbaum (+2)
//   S  = Stein (-1 wenn nicht überbaut)
//   M  = Gebirge (nicht bebaubar)          F = Wald (Spiele 8+9 bebaubar!)
//   W  = Brunnen (+4 wenn 4 Gebäude angrenzen)
//   K  = gedruckte Kirche (Spiel 6, Startgebäude)
//   R  = breites Flussfeld (Spiel 7, nicht bebaubar, keine Angrenzung darüber)
//   H  = Hochebene (Spiel 7, bebaubar; alle 4 überbaut -> Bonus)
//   G  = Goldfeld (Spiel 9, bebaubar; alle 5 überbaut -> Bonus, leer kein Abzug)
//   Z  = Sägewerk (Spiele 7-9, Startgebäude, nicht bebaubar)
//   P  = gedruckte Festung (Spiel 12, Startgebäude, nicht bebaubar)
//   B  = Bandit (Kapitel 4; nicht bebaubar, umzingeln!)

export type CellType =
  | '.' | 'T' | 'D' | 'S' | 'M' | 'F' | 'W' | 'K'
  | 'R' | 'H' | 'G' | 'Z' | 'P' | 'B';

export type RiverPoint = [number, number]; // [y, x] Gitterpunkt
export type StartRule = 'river' | 'church' | 'sawmill' | 'fortress';

export interface BoardDef {
  w: number;
  h: number;
  grid: CellType[][];
  riverPath: RiverPoint[];
  blockedEdges: Set<string>;
  riverCells: Set<string>;
  startAt: StartRule;
  forestBuildable: boolean;
}

export function edgeKey(r1: number, c1: number, r2: number, c2: number): string {
  return r1 < r2 || (r1 === r2 && c1 < c2)
    ? `${r1},${c1}|${r2},${c2}`
    : `${r2},${c2}|${r1},${c1}`;
}

function parse(
  layout: string[],
  riverPath: RiverPoint[],
  startAt: StartRule = 'river',
  forestBuildable = false
): BoardDef {
  const grid = layout.map((row) => row.split('') as CellType[]);
  const w = grid[0].length;
  const h = grid.length;
  const blockedEdges = new Set<string>();
  const riverCells = new Set<string>();

  const addPair = (r1: number, c1: number, r2: number, c2: number) => {
    const in1 = r1 >= 0 && r1 < h && c1 >= 0 && c1 < w;
    const in2 = r2 >= 0 && r2 < h && c2 >= 0 && c2 < w;
    if (in1) riverCells.add(r1 + ',' + c1);
    if (in2) riverCells.add(r2 + ',' + c2);
    if (in1 && in2) blockedEdges.add(edgeKey(r1, c1, r2, c2));
  };

  for (let i = 0; i < riverPath.length - 1; i++) {
    const [y1, x1] = riverPath[i];
    const [y2, x2] = riverPath[i + 1];
    if (x1 === x2) {
      for (let y = Math.min(y1, y2); y < Math.max(y1, y2); y++) addPair(y, x1 - 1, y, x1);
    } else if (y1 === y2) {
      for (let x = Math.min(x1, x2); x < Math.max(x1, x2); x++) addPair(y1 - 1, x, y1, x);
    }
  }

  // Breite Flussfelder (R) zählen als "am Fluss" für das Startgebäude.
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (grid[r][c] !== 'R') continue;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < h && nc >= 0 && nc < w && grid[nr][nc] !== 'R') {
          riverCells.add(nr + ',' + nc);
        }
      }
    }
  }

  return { w, h, grid, riverPath, blockedEdges, riverCells, startAt, forestBuildable };
}

// ---- Kapitel 1: Das neue Land (Spiele 1-3) ----

const SPIEL_1_LAYOUT = [
  'TTTTTTTTTTF',
  'S.......D.F',
  'MM....D...S',
  'MS.........',
  '.D....D..FF',
  'S........FF',
  'S......SFFF',
  '.....S.FFFF',
];
const RIVER_1: RiverPoint[] = [[0, 5], [2, 5], [2, 4], [4, 4], [4, 5], [6, 5], [6, 4], [8, 4]];

const SPIEL_2_LAYOUT = [
  '..D....D.FF',
  'S........SF',
  'S.....D...F',
  'MM........F',
  'M....D...FF',
  '..D......FF',
  'S.......FFF',
  '...S..S.FFF',
];
const RIVER_2: RiverPoint[] = [[0, 4], [2, 4], [2, 3], [4, 3], [4, 4], [6, 4], [6, 5], [8, 5]];

const SPIEL_3_LAYOUT = SPIEL_2_LAYOUT.map((row, r) =>
  r === 3 ? row.slice(0, 7) + 'W' + row.slice(8) : row
);

// ---- Kapitel 2: Die Kirchen (Spiele 4-6) ----

const SPIEL_4_LAYOUT = [
  '..D......SF',
  'S.......DFF',
  'M.....D...F',
  'MM.....S...',
  'MS....D..SF',
  '.....D...FF',
  'S......SFFF',
  '..S.....FFF',
];
const RIVER_4: RiverPoint[] = [[0, 4], [2, 4], [2, 3], [4, 3], [4, 2], [6, 2], [6, 1], [8, 1]];

const SPIEL_5_LAYOUT = SPIEL_4_LAYOUT.map((row, r) => {
  if (r === 1) return row.slice(0, 5) + 'W' + row.slice(6);
  if (r === 2) return row.slice(0, 8) + 'W' + row.slice(9);
  return row;
});

const SPIEL_6_LAYOUT = SPIEL_5_LAYOUT.map((row, r) =>
  r === 3 ? row.slice(0, 3) + 'K' + row.slice(4) : row
);

// ---- Kapitel 3: Herausforderungen (Spiele 7-9) ----

// Spiel 7: breiter Fluss (R), Hochebenen (H) am Gebirge, Sägewerk (Z).
const SPIEL_7_LAYOUT = [
  '....R.D...F',
  '..S.R..D..F',
  'HHS.R......',
  'MM.RR...S.F',
  'M....D...FF',
  'HH.D.....FF',
  '...S.....FF',
  '.....S.ZZFF',
];
const RIVER_7: RiverPoint[] = [[4, 3], [4, 2], [6, 2], [6, 1], [8, 1]];

// Spiel 8: Waldfelder (F) dürfen/sollen überbaut werden.
const SPIEL_8_LAYOUT = [
  '...S..D...F',
  'F..S......F',
  'F..S..D..DF',
  'MM.........',
  'MF........F',
  'F..DSS...FF',
  '.SS...D..FF',
  '.......ZZFF',
];
const RIVER_8: RiverPoint[] = [[0, 3], [2, 3], [2, 4], [4, 4], [4, 1], [6, 1], [6, 0]];

// Spiel 9: Goldfelder (G); Wald weiterhin bebaubar; Zirkel ohne Bedeutung.
const SPIEL_9_LAYOUT = [
  '...G.D....F',
  'GS.....D..F',
  'G..S......F',
  'MM.....DD..',
  'MG.......FF',
  '..D.S....FF',
  '.D.S...ZZ.F',
  'G....S.....',
];
const RIVER_9: RiverPoint[] = [[0, 3], [2, 3], [2, 2], [4, 2], [4, 4], [6, 4], [6, 0]];

// ---- Kapitel 4: Banditen (Spiele 10-12) ----

const SPIEL_10_LAYOUT = [
  'S..D......S',
  'S.....B..D.',
  '.....D....S',
  'MM.B.......',
  'M.......B.S',
  '..D....D...',
  'S...B.....S',
  '...S....S..',
];
const RIVER_10: RiverPoint[] = [[0, 4], [2, 4], [2, 5], [4, 5], [4, 4], [6, 4], [6, 5], [8, 5]];

const SPIEL_11_LAYOUT = [
  'S.B......DS',
  '.D.....B..S',
  'S....D.....',
  'MM...B....S',
  'M.........S',
  '..D.....B..',
  'S.B......S.',
  '....S...S..',
];

// Spiel 12: gedruckte Festungen (P), gedruckte Banditen, 14 Bäume (7 Doppel).
const SPIEL_12_LAYOUT = [
  'S.D.......S',
  'S..P...D.D.',
  'M....D....S',
  'MM.....B...',
  'S.B......DS',
  '..D...D....',
  'S...P......',
  '.....S.S.S.',
];
const RIVER_12: RiverPoint[] = [[0, 4], [2, 4], [2, 3], [4, 3], [4, 4], [6, 4], [6, 3], [8, 3]];

const BOARDS: Record<number, BoardDef> = {
  1: parse(SPIEL_1_LAYOUT, RIVER_1),
  2: parse(SPIEL_2_LAYOUT, RIVER_2),
  3: parse(SPIEL_3_LAYOUT, RIVER_2),
  4: parse(SPIEL_4_LAYOUT, RIVER_4),
  5: parse(SPIEL_5_LAYOUT, RIVER_4),
  6: parse(SPIEL_6_LAYOUT, RIVER_4, 'church'),
  7: parse(SPIEL_7_LAYOUT, RIVER_7, 'sawmill'),
  8: parse(SPIEL_8_LAYOUT, RIVER_8, 'sawmill', true),
  9: parse(SPIEL_9_LAYOUT, RIVER_9, 'sawmill', true),
  10: parse(SPIEL_10_LAYOUT, RIVER_10),
  11: parse(SPIEL_11_LAYOUT, RIVER_10),
  12: parse(SPIEL_12_LAYOUT, RIVER_12, 'fortress'),
};

export function boardForGame(gameNo: number, extraBandits?: [number, number][]): BoardDef {
  const base = BOARDS[gameNo] ?? BOARDS[1];
  if (!extraBandits || extraBandits.length === 0) return base;
  // Übertragene Banditen (Kapitel 4) auf das Blatt zeichnen.
  const grid = base.grid.map((row) => [...row]);
  for (const [r, c] of extraBandits) {
    if (r >= 0 && r < base.h && c >= 0 && c < base.w && grid[r][c] === '.') grid[r][c] = 'B';
  }
  return { ...base, grid };
}

export function isBuildable(t: CellType, forestBuildable = false): boolean {
  if (t === 'F') return forestBuildable;
  return t === '.' || t === 'T' || t === 'D' || t === 'S' || t === 'W' || t === 'H' || t === 'G';
}

// Gedruckte Gebäude zählen für Angrenzung (und als Startgebäude).
export function isPrintedBuilding(t: CellType): boolean {
  return t === 'K' || t === 'Z' || t === 'P';
}

export function treeCount(t: CellType): number {
  return t === 'T' ? 1 : t === 'D' ? 2 : 0;
}

export function totalTrees(board: BoardDef): number {
  let n = 0;
  for (const row of board.grid) for (const t of row) n += treeCount(t);
  return n;
}

export function cellsOfType(board: BoardDef, type: CellType): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < board.h; r++)
    for (let c = 0; c < board.w; c++) if (board.grid[r][c] === type) out.push([r, c]);
  return out;
}
