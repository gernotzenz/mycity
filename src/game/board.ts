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

// Zelle für Zelle nach dem Foto des Original-Blatts:
// Gebirge T-förmig links (r2-r4, breiteste Stelle r3), 6 Steine,
// Doppelbäume (1,8) (2,6) (5,2) (5,6), Waldecke oben rechts (2 Zellen),
// Wald-Treppe unten rechts.
const SPIEL_1_LAYOUT = [
  'TTTTTTTTTTF',
  'S.......D.F',
  'M.....D....',
  'MM........S',
  'MS.......FF',
  '..D...D..FF',
  'S.......SFF',
  '.....S.FFFF',
];
// Flusslauf (per Rasterkalibrierung vom Foto abgenommen):
// oben zwischen c4|c5 hinein (x5), Zeilen 2-3 links (x4),
// Zeilen 4-5 rechts (x5), Zeile 6 links (x4), Austritt unten an der
// linken oberen Ecke des Steins (7,5) -> x5.
const RIVER_1: RiverPoint[] = [
  [0, 5],
  [2, 5],
  [2, 4],
  [4, 4],
  [4, 5],
  [6, 5],
  [6, 4],
  [7, 4],
  [7, 5],
  [8, 5],
];

// Innerhalb eines Kapitels ist die Karte identisch – Spiel 2 nutzt das
// Spiel-1-Blatt, Spiel 3 zusätzlich mit Brunnen im Osten.
const SPIEL_2_LAYOUT = SPIEL_1_LAYOUT;
const RIVER_2 = RIVER_1;

const SPIEL_3_LAYOUT = SPIEL_1_LAYOUT.map((row, r) =>
  r === 3 ? row.slice(0, 7) + 'W' + row.slice(8) : row
);

// ---- Kapitel 2: Die Kirchen (Spiele 4-6) ----
// Gemeinsame Karte (nach Foto von Blatt 5); Spiel 5+6 mit 2 Brunnen,
// Spiel 6 zusätzlich mit gedruckter Kirche am Fluss.

const SPIEL_4_LAYOUT = [
  '.......D.FF',
  '..D.......F',
  'S.....D..SF',
  'MM....D..FF',
  'MS.......FF',
  'SS.D.....FF',
  '...S....S..',
  'S....D.....',
];
const RIVER_4: RiverPoint[] = [
  [0, 4],
  [2, 4],
  [2, 3],
  [3, 3],
  [3, 4],
  [4, 4],
  [4, 6],
  [6, 6],
  [6, 5],
  [8, 5],
];

const SPIEL_5_LAYOUT = SPIEL_4_LAYOUT.map((row, r) => {
  if (r === 1) return row.slice(0, 5) + 'W' + row.slice(6);
  if (r === 2) return row.slice(0, 8) + 'W' + row.slice(9);
  return row;
});

const SPIEL_6_LAYOUT = SPIEL_5_LAYOUT.map((row, r) =>
  r === 3 ? row.slice(0, 4) + 'K' + row.slice(5) : row
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
// Karte nach dem frontalen Foto von Blatt 8.
const SPIEL_8_LAYOUT = [
  '...S.D....F',
  'F..S....D.F',
  'F..S..D...F',
  'MM........F',
  'MF......D.F',
  'F.....D..FF',
  '.SD..S...FF',
  'SS....ZZ.FF',
];
const RIVER_8: RiverPoint[] = [[0, 4], [2, 4], [2, 3], [4, 3], [4, 5], [6, 5], [6, 0]];

// Spiel 9: gleiche Karte wie Spiel 8, aber 5 Felder zeigen Gold (G);
// Wald weiterhin bebaubar; Zirkel ohne Bedeutung.
const SPIEL_9_LAYOUT = SPIEL_8_LAYOUT.map((row, r) => {
  const set = (s: string, c: number) => s.slice(0, c) + 'G' + s.slice(c + 1);
  let out = row;
  if (r === 0) out = set(out, 3);
  if (r === 1) out = set(out, 0);
  if (r === 2) out = set(out, 0);
  if (r === 4) out = set(out, 1);
  if (r === 7) out = set(out, 0);
  return out;
});
const RIVER_9 = RIVER_8;

// ---- Kapitel 4: Banditen (Spiele 10-12) ----

// Gemeinsame Kapitel-4-Karte (nach dem frontalen Foto von Blatt 12);
// je Spiel unterschiedliche Banditen/Festungen.
const K4_TERRAIN = [
  'S.D.......S',
  'S......D.D.',
  'M....D....S',
  'MM.........',
  'S.S......DS',
  '..D...D....',
  'S..........',
  '.....S.S.S.',
];
const RIVER_K4: RiverPoint[] = [[0, 4], [2, 4], [2, 3], [4, 3], [4, 4], [6, 4], [6, 3], [8, 3]];

function withMarks(terrain: string[], marks: [number, number, string][]): string[] {
  const grid = terrain.map((r) => r.split(''));
  for (const [r, c, ch] of marks) grid[r][c] = ch;
  return grid.map((r) => r.join(''));
}

const SPIEL_10_LAYOUT = withMarks(K4_TERRAIN, [
  [1, 6, 'B'],
  [3, 3, 'B'],
  [4, 8, 'B'],
  [6, 4, 'B'],
]);

const SPIEL_11_LAYOUT = withMarks(K4_TERRAIN, [
  [0, 6, 'B'],
  [1, 3, 'B'],
  [3, 5, 'B'],
  [5, 8, 'B'],
  [6, 2, 'B'],
]);

// Spiel 12: 2 gedruckte Festungen (P) + 2 gedruckte Banditen.
const SPIEL_12_LAYOUT = withMarks(K4_TERRAIN, [
  [1, 3, 'P'],
  [6, 4, 'P'],
  [3, 7, 'B'],
  [4, 2, 'B'],
]);
const RIVER_12 = RIVER_K4;

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
  10: parse(SPIEL_10_LAYOUT, RIVER_K4),
  11: parse(SPIEL_11_LAYOUT, RIVER_K4),
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
