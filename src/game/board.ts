// Spielfeld Kapitel 1 – rekonstruiert nach Fotos des Original-Spielblatts.
// Legende:
//   .  = leeres Feld (bebaubar, am Ende -1 wenn leer)
//   ~  = Fluss (nicht bebaubar, zählt nicht als leeres Feld)
//   T  = Baum (bebaubar, +1 wenn nicht überbaut)
//   D  = Doppelbaum (bebaubar, +2 wenn nicht überbaut)
//   S  = Stein (bebaubar, -1 wenn nicht überbaut)
//   M  = Gebirge (nicht bebaubar)
//   F  = Wald (nicht bebaubar)
//   W  = Brunnen (nur Spiel 3; bebaubar, +4 wenn 4 Gebäude angrenzen)
//
// Das Raster lässt sich hier einfach anpassen, falls einzelne Felder vom
// Original abweichen.

//   K  = gedruckte Kirche (nur Spiel 6; nicht bebaubar, gilt als erstes Gebäude)
export type CellType = '.' | '~' | 'T' | 'D' | 'S' | 'M' | 'F' | 'W' | 'K';

export interface BoardDef {
  w: number;
  h: number;
  grid: CellType[][];
}

const SPIEL_1_LAYOUT = [
  'TTTTT~TTTTF',
  'S...~~..D.F',
  'M...~.D..S.',
  'MM..~~.....',
  '.S...~....F',
  '..D.~~.D.FF',
  'S..~~..S.FF',
  '...~.SFFFFF',
];

function parse(layout: string[]): BoardDef {
  const grid = layout.map((row) => row.split('') as CellType[]);
  return { w: grid[0].length, h: grid.length, grid };
}

export const BOARD_SPIEL_1 = parse(SPIEL_1_LAYOUT);

// Spiel 2 verwendet dasselbe Grundlayout (Wertung ändert sich).
export const BOARD_SPIEL_2 = parse(SPIEL_1_LAYOUT);

// Spiel 3: Brunnen "im Osten der Siedlung".
const SPIEL_3_LAYOUT = SPIEL_1_LAYOUT.map((row, r) =>
  r === 3 ? row.slice(0, 7) + 'W' + row.slice(8) : row
);
export const BOARD_SPIEL_3 = parse(SPIEL_3_LAYOUT);

// Kapitel 2 (Spiele 4-6) – rekonstruiert nach Foto des Spiel-4-Blatts.
const SPIEL_4_LAYOUT = [
  '..D.~....SF',
  'S...~...DFF',
  'M..~~.D...F',
  'MM~~...S...',
  'MS~...D..SF',
  '.~~..D...FF',
  'S~.....SFFF',
  '~~S.....FFF',
];
export const BOARD_SPIEL_4 = parse(SPIEL_4_LAYOUT);

// Spiel 5: wie Spiel 4, aber mit 2 Brunnen.
const SPIEL_5_LAYOUT = SPIEL_4_LAYOUT.map((row, r) => {
  if (r === 2) return row.slice(0, 8) + 'W' + row.slice(9);
  if (r === 5) return row.slice(0, 7) + 'W' + row.slice(8);
  return row;
});
export const BOARD_SPIEL_5 = parse(SPIEL_5_LAYOUT);

// Spiel 6: wie Spiel 5, zusätzlich gedruckte Kirche am Fluss.
const SPIEL_6_LAYOUT = SPIEL_5_LAYOUT.map((row, r) =>
  r === 4 ? row.slice(0, 3) + 'K' + row.slice(4) : row
);
export const BOARD_SPIEL_6 = parse(SPIEL_6_LAYOUT);

const BOARDS: Record<number, BoardDef> = {
  1: BOARD_SPIEL_1,
  2: BOARD_SPIEL_2,
  3: BOARD_SPIEL_3,
  4: BOARD_SPIEL_4,
  5: BOARD_SPIEL_5,
  6: BOARD_SPIEL_6,
};

export function boardForGame(gameNo: number): BoardDef {
  return BOARDS[gameNo] ?? BOARD_SPIEL_1;
}

export function isBuildable(t: CellType): boolean {
  return t === '.' || t === 'T' || t === 'D' || t === 'S' || t === 'W';
}

export function treeCount(t: CellType): number {
  return t === 'T' ? 1 : t === 'D' ? 2 : 0;
}

export function totalTrees(board: BoardDef): number {
  let n = 0;
  for (const row of board.grid) for (const t of row) n += treeCount(t);
  return n;
}
