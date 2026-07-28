import type { BuildingType, Cell, DiceResult } from './types';

// ------------------------------------------------------------------
// Die beiden blauen Würfel werden als echte Würfelseiten modelliert.
// Jede Seite ist ein 2x2-Raster mit 0-3 weißen Quadraten. Der graue
// Halbkreis sitzt an der Verbindungskante (Würfel A: rechts, Würfel B:
// links) zwischen den beiden Zeilen. Beim Zusammenstecken ergeben die
// Halbkreise einen Vollkreis; die Quadrate beider Seiten bilden
// zusammen die Gebäudeform.
//
// Koordinaten: [Zeile, Spalte] im eigenen 2x2-Raster.
// Würfel A: Spalte 1 liegt an der Verbindungskante.
// Würfel B: Spalte 0 liegt an der Verbindungskante.
// ------------------------------------------------------------------

export interface DieFace {
  id: string;
  cells: Cell[];
  special?: 'blank' | 'zirkel';
}

// Rekonstruiert nach der 36er-Auszählung der Original-Würfel
// (Einer 11,1 % · Zweier 22,2 % · Dreier-Reihe 8,3 % · Vierer-Reihe 2,7 %
//  · Dreier-L 22,2 % · Vierer-L 13,8 % · U-Gebäude 5,5 %):
// Würfel A hat keine Leerseite; Leerseite UND Zirkel liegen auf Würfel B.
export const DIE_A_FACES: DieFace[] = [
  { id: 'a-winkel', cells: [[0, 0], [1, 0], [1, 1]] },
  { id: 'a-senkrecht-1', cells: [[0, 1], [1, 1]] },
  { id: 'a-senkrecht-2', cells: [[0, 1], [1, 1]] },
  { id: 'a-einzel-1', cells: [[1, 1]] },
  { id: 'a-einzel-2', cells: [[1, 1]] },
  { id: 'a-waagrecht', cells: [[1, 0], [1, 1]] },
];

export const DIE_B_FACES: DieFace[] = [
  { id: 'b-einzel', cells: [[1, 0]] },
  { id: 'b-senkrecht-1', cells: [[0, 0], [1, 0]] },
  { id: 'b-senkrecht-2', cells: [[0, 0], [1, 0]] },
  { id: 'b-waagrecht', cells: [[1, 0], [1, 1]] },
  { id: 'b-leer', cells: [], special: 'blank' },
  { id: 'b-zirkel', cells: [], special: 'zirkel' },
];

const BUILDING_TYPES: BuildingType[] = ['wohn', 'gewerbe', 'oeffentlich'];

export function rollDice(): DiceResult {
  // Würfel A zeigt immer Quadrate, daher entsteht immer ein Gebäude.
  const a = Math.floor(Math.random() * 6);
  const b = Math.floor(Math.random() * 6);
  const type = BUILDING_TYPES[Math.floor(Math.random() * 3)];
  return { a, b, type };
}

// Kombinierte Gebäudeform: Würfel A belegt Spalten 0-1, Würfel B 2-3.
export function combinedCells(a: number, b: number): Cell[] {
  const cells: Cell[] = [
    ...DIE_A_FACES[a].cells.map(([r, c]) => [r, c] as Cell),
    ...DIE_B_FACES[b].cells.map(([r, c]) => [r, c + 2] as Cell),
  ];
  return normalize(cells);
}

export function shapeName(cells: Cell[]): string {
  const n = cells.length;
  const h = Math.max(...cells.map((c) => c[0])) + 1;
  const w = Math.max(...cells.map((c) => c[1])) + 1;
  if (n === 1) return 'Einer';
  if (n === 2) return 'Zweier';
  if (n === 3) return h === 1 || w === 1 ? 'Dreier-Reihe' : 'Dreier-L';
  if (n === 4) {
    if (h === 1 || w === 1) return 'Vierer-Reihe';
    if (h === 2 && w === 2) return 'Quadrat';
    return 'Vierer-L';
  }
  if (n === 5) return h * w === 6 ? 'U-Gebäude' : 'Fünfer-L';
  return 'Großes Gebäude';
}

// ---- Formen-Transformationen (drehen & spiegeln erlaubt) ----

export function normalize(cells: Cell[]): Cell[] {
  const minR = Math.min(...cells.map((c) => c[0]));
  const minC = Math.min(...cells.map((c) => c[1]));
  return cells
    .map(([r, c]) => [r - minR, c - minC] as Cell)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// Prüft, ob zwei Zellmengen dieselbe Form sind (Drehen & Spiegeln erlaubt).
export function shapesEqual(a: Cell[], b: Cell[]): boolean {
  if (a.length !== b.length) return false;
  const key = (cs: Cell[]) => normalize(cs).map(([r, c]) => r + ',' + c).join(';');
  const ka = key(a);
  for (const m of [false, true]) {
    for (let r = 0; r < 4; r++) {
      if (key(transformCells(b, r, m)) === ka) return true;
    }
  }
  return false;
}

export function transformCells(base: Cell[], rot: number, mirrored: boolean): Cell[] {
  let cells = base;
  if (mirrored) cells = cells.map(([r, c]) => [r, -c] as Cell);
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) {
    cells = cells.map(([r, c]) => [c, -r] as Cell);
  }
  return normalize(cells);
}
