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

export type CellType = '.' | '~' | 'T' | 'D' | 'S' | 'M' | 'F' | 'W';

export interface BoardDef {
  w: number;
  h: number;
  grid: CellType[][];
}

const SPIEL_1_LAYOUT = [
  'TTTTT~TTTTTT',
  'S....~....FF',
  'M...~~.D..FF',
  'MM..~....S..',
  '.D.~~.......',
  'S..~.S..D..F',
  '..~~..S..FFF',
  '..~..S...FFF',
  '..~......FFF',
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
  r === 4 ? row.slice(0, 8) + 'W' + row.slice(9) : row
);
export const BOARD_SPIEL_3 = parse(SPIEL_3_LAYOUT);

export function boardForGame(gameNo: 1 | 2 | 3): BoardDef {
  return gameNo === 3 ? BOARD_SPIEL_3 : gameNo === 2 ? BOARD_SPIEL_2 : BOARD_SPIEL_1;
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
