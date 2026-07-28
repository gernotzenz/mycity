export type BuildingType = 'wohn' | 'gewerbe' | 'oeffentlich';
export type PlacementType = BuildingType | 'kirche';

export type Cell = [number, number]; // [row, col]

export interface Placement {
  cells: Cell[];
  type: PlacementType;
  round: number;
}

export interface PlayerState {
  name: string;
  placements: Placement[];
  passes: number;
  finished: boolean;
  doneRound: number; // letzte Runde, in der der Spieler gehandelt hat
}

export interface DiceResult {
  a: number; // Seite von Würfel A (0-5)
  b: number; // Seite von Würfel B (0-5)
  type: BuildingType;
  church?: number | null; // Kirchen-Index, wenn Zirkel gewürfelt (ab Spiel 4)
}

export interface SharedState {
  status: 'lobby' | 'playing' | 'scoring';
  gameNo: number; // 1-6
  round: number;
  rollerSeat: 1 | 2;
  dice: DiceResult | null;
  churchesUsed: number; // wie viele Kirchen-Kreise schon ausgemalt sind
}

export interface HistoryEntry {
  gameNo: number;
  p1: number;
  p2: number;
}

export interface GameRow {
  id: string;
  code: string;
  shared: SharedState;
  p1: PlayerState | null;
  p2: PlayerState | null;
  history: HistoryEntry[] | null;
}

export function chapterOf(gameNo: number): number {
  return Math.ceil(gameNo / 3);
}

export const BUILDING_LABEL: Record<BuildingType, string> = {
  wohn: 'Wohngebäude (ausgemalt)',
  gewerbe: 'Gewerbegebäude (schraffiert)',
  oeffentlich: 'Öffentliches Gebäude (gekreuzt)',
};

export const PASS_PENALTY = [0, -1, -2, -3, -5, -7, -10];
export const MAX_PASSES = 6;
