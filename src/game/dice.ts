import type { BuildingType, Cell, DiceResult } from './types';

// Die 9 Gebäudeformen, die aus den 36 Kombinationen der beiden blauen
// Würfel entstehen können. Gewichte gemäß der realen Würfelverteilung
// (2er und 3er-L am häufigsten, 4er-Reihe am seltensten – siehe Hinweis
// auf dem Spielblatt von Spiel 1).
export interface ShapeDef {
  id: string;
  name: string;
  cells: Cell[];
  weight: number; // von 36
}

export const SHAPES: ShapeDef[] = [
  { id: 'I1', name: 'Einer', cells: [[0, 0]], weight: 4 },
  { id: 'I2', name: 'Zweier', cells: [[0, 0], [0, 1]], weight: 8 },
  { id: 'I3', name: 'Dreier-Reihe', cells: [[0, 0], [0, 1], [0, 2]], weight: 3 },
  { id: 'L3', name: 'Dreier-L', cells: [[0, 0], [0, 1], [1, 0]], weight: 8 },
  { id: 'I4', name: 'Vierer-Reihe', cells: [[0, 0], [0, 1], [0, 2], [0, 3]], weight: 1 },
  { id: 'L4', name: 'Vierer-L', cells: [[0, 0], [0, 1], [0, 2], [1, 0]], weight: 5 },
  { id: 'O4', name: 'Quadrat', cells: [[0, 0], [0, 1], [1, 0], [1, 1]], weight: 3 },
  { id: 'S4', name: 'S-Gebäude', cells: [[0, 1], [0, 2], [1, 0], [1, 1]], weight: 2 },
  { id: 'T4', name: 'U-Gebäude', cells: [[0, 0], [0, 1], [0, 2], [1, 1]], weight: 2 },
];

export const SHAPE_BY_ID: Record<string, ShapeDef> = Object.fromEntries(
  SHAPES.map((s) => [s.id, s])
);

const BUILDING_TYPES: BuildingType[] = ['wohn', 'gewerbe', 'oeffentlich'];

export function rollDice(): DiceResult {
  const total = SHAPES.reduce((a, s) => a + s.weight, 0);
  let r = Math.random() * total;
  let shapeId = SHAPES[0].id;
  for (const s of SHAPES) {
    r -= s.weight;
    if (r <= 0) {
      shapeId = s.id;
      break;
    }
  }
  const type = BUILDING_TYPES[Math.floor(Math.random() * 3)];
  return { shapeId, type };
}

// ---- Formen-Transformationen (drehen & spiegeln erlaubt) ----

export function normalize(cells: Cell[]): Cell[] {
  const minR = Math.min(...cells.map((c) => c[0]));
  const minC = Math.min(...cells.map((c) => c[1]));
  return cells
    .map(([r, c]) => [r - minR, c - minC] as Cell)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

export function transformShape(shapeId: string, rot: number, mirrored: boolean): Cell[] {
  let cells = SHAPE_BY_ID[shapeId].cells;
  if (mirrored) cells = cells.map(([r, c]) => [r, -c] as Cell);
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) {
    cells = cells.map(([r, c]) => [c, -r] as Cell);
  }
  return normalize(cells);
}
