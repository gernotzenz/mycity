export type BuildingType = 'wohn' | 'gewerbe' | 'oeffentlich';

export type Cell = [number, number]; // [row, col]

export interface Placement {
  cells: Cell[];
  type: BuildingType;
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
  shapeId: string;
  type: BuildingType;
}

export interface SharedState {
  status: 'lobby' | 'playing' | 'scoring';
  gameNo: 1 | 2 | 3;
  round: number;
  rollerSeat: 1 | 2;
  dice: DiceResult | null;
}

export interface GameRow {
  id: string;
  code: string;
  shared: SharedState;
  p1: PlayerState | null;
  p2: PlayerState | null;
}

export const BUILDING_LABEL: Record<BuildingType, string> = {
  wohn: 'Wohngebäude (ausgemalt)',
  gewerbe: 'Gewerbegebäude (schraffiert)',
  oeffentlich: 'Öffentliches Gebäude (gekreuzt)',
};

export const PASS_PENALTY = [0, -1, -2, -3, -5, -7, -10];
export const MAX_PASSES = 6;
