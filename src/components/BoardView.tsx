import type { BoardDef, CellType } from '../game/board';
import type { Cell, Placement } from '../game/types';
import { coveredMap } from '../game/rules';

interface Props {
  board: BoardDef;
  placements: Placement[];
  preview?: { cells: Cell[]; valid: boolean } | null;
  onTapCell?: (r: number, c: number) => void;
  small?: boolean;
}

const CELL_BG: Record<CellType, string> = {
  '.': 'cell-normal',
  '~': 'cell-river',
  T: 'cell-normal',
  D: 'cell-normal',
  S: 'cell-normal',
  M: 'cell-mountain',
  F: 'cell-forest',
  W: 'cell-normal',
};

const CELL_ICON: Record<CellType, string> = {
  '.': '',
  '~': '',
  T: '🌲',
  D: '🌲🌲',
  S: '🪨',
  M: '⛰️',
  F: '',
  W: '⛲',
};

export default function BoardView({ board, placements, preview, onTapCell, small }: Props) {
  const covered = coveredMap(placements);
  const previewSet = new Set((preview?.cells ?? []).map(([r, c]) => r + ',' + c));

  const cells = [];
  for (let r = 0; r < board.h; r++) {
    for (let c = 0; c < board.w; c++) {
      const t = board.grid[r][c];
      const k = r + ',' + c;
      const pIdx = covered.get(k);
      const placement = pIdx !== undefined ? placements[pIdx] : undefined;
      const classes = ['cell', CELL_BG[t]];
      if (placement) {
        classes.push('built', 'built-' + placement.type);
        // dickere Ränder an Gebäudegrenzen
        const sameB = (rr: number, cc: number) => covered.get(rr + ',' + cc) === pIdx;
        if (!sameB(r - 1, c)) classes.push('b-top');
        if (!sameB(r + 1, c)) classes.push('b-bottom');
        if (!sameB(r, c - 1)) classes.push('b-left');
        if (!sameB(r, c + 1)) classes.push('b-right');
      }
      if (previewSet.has(k)) classes.push(preview!.valid ? 'preview-ok' : 'preview-bad');

      cells.push(
        <div
          key={k}
          className={classes.join(' ')}
          onClick={onTapCell ? () => onTapCell(r, c) : undefined}
        >
          {placement?.type === 'oeffentlich' ? (
            <span className="x-mark">✕</span>
          ) : placement ? null : (
            <span className="cell-icon">{CELL_ICON[t]}</span>
          )}
        </div>
      );
    }
  }

  return (
    <div
      className={'board' + (small ? ' board-small' : '')}
      style={{ gridTemplateColumns: `repeat(${board.w}, 1fr)` }}
    >
      {cells}
    </div>
  );
}
