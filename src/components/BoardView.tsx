import { useMemo, useRef } from 'react';
import type { BoardDef, CellType } from '../game/board';
import type { Cell, Placement } from '../game/types';
import { coveredMap } from '../game/rules';
import treeUrl from '../assets/tree.png';
import stoneUrl from '../assets/stone.svg';

export type PreviewState = 'partial' | 'ok' | 'bad';
export type DrawMode = 'add' | 'remove';

interface Props {
  board: BoardDef;
  placements: Placement[];
  preview?: { cells: Cell[]; state: PreviewState } | null;
  onDrawCell?: (r: number, c: number, mode: DrawMode) => void;
  small?: boolean;
}

// ---------- Icons ----------

function MountainIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon">
      <path d="M2 21 L9 6 L13 13 L16 9 L22 21 Z" fill="#8d8578" stroke="#57503f" strokeWidth="1" strokeLinejoin="round" />
      <path d="M9 6 L11 10 L9.5 11 L8 9.5 Z" fill="#e8e4da" />
      <path d="M16 9 L17.5 12 L16 12.5 L15 11 Z" fill="#e8e4da" />
    </svg>
  );
}

function WellIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon">
      <ellipse cx="12" cy="16" rx="8" ry="4.5" fill="#8d6b45" stroke="#5c4227" strokeWidth="1.2" />
      <ellipse cx="12" cy="14.5" rx="6" ry="3" fill="#5aa7cc" stroke="#33627a" strokeWidth="0.8" />
      <path d="M6 9 L12 4 L18 9" fill="none" stroke="#7a5230" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const CELL_BG: Record<CellType, string> = {
  '.': 'cell-normal',
  '~': 'cell-normal',
  T: 'cell-normal',
  D: 'cell-normal',
  S: 'cell-normal',
  M: 'cell-mountain',
  F: 'cell-forest',
  W: 'cell-normal',
  K: 'cell-printed-church',
};

function PrintedChurchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon">
      <path d="M5 21 V12 L12 7 L19 12 V21 Z" fill="#e9dfc3" stroke="#5c4f39" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M12 2 V7 M10 4.2 H14" stroke="#5c4f39" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="12" cy="14.5" r="2.6" fill="none" stroke="#5c4f39" strokeWidth="1.3" />
    </svg>
  );
}

function cellIcon(t: CellType) {
  switch (t) {
    case 'T':
      return <img src={treeUrl} alt="" className="img-icon" draggable={false} />;
    case 'D':
      return (
        <span className="double-tree">
          <img src={treeUrl} alt="" className="img-icon" draggable={false} />
          <img src={treeUrl} alt="" className="img-icon" draggable={false} />
        </span>
      );
    case 'S':
      return <img src={stoneUrl} alt="" className="img-icon img-stone" draggable={false} />;
    case 'M':
      return <MountainIcon />;
    case 'W':
      return <WellIcon />;
    case 'K':
      return <PrintedChurchIcon />;
    default:
      return null;
  }
}

// ---------- Fluss als geschwungener SVG-Pfad ----------

function riverChain(board: BoardDef): Cell[] {
  const cells: Cell[] = [];
  for (let r = 0; r < board.h; r++)
    for (let c = 0; c < board.w; c++) if (board.grid[r][c] === '~') cells.push([r, c]);
  if (cells.length === 0) return [];
  const set = new Set(cells.map(([r, c]) => r + ',' + c));
  const start = cells.reduce((a, b) => (b[0] < a[0] ? b : a));
  const chain: Cell[] = [start];
  const seen = new Set([start[0] + ',' + start[1]]);
  while (true) {
    const [r, c] = chain[chain.length - 1];
    const next = (
      [
        [r + 1, c],
        [r, c - 1],
        [r, c + 1],
        [r - 1, c],
      ] as Cell[]
    ).find(([nr, nc]) => set.has(nr + ',' + nc) && !seen.has(nr + ',' + nc));
    if (!next) break;
    seen.add(next[0] + ',' + next[1]);
    chain.push(next);
  }
  return chain;
}

function RiverOverlay({ board }: { board: BoardDef }) {
  const d = useMemo(() => {
    const chain = riverChain(board);
    if (chain.length === 0) return '';
    const pts: [number, number][] = chain.map(([r, c]) => [c * 100 + 50, r * 100 + 50]);
    if (chain[0][0] === 0) pts.unshift([pts[0][0], 0]);
    const last = chain[chain.length - 1];
    if (last[0] === board.h - 1) pts.push([pts[pts.length - 1][0], board.h * 100]);
    let path = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      path += ` Q ${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
    }
    path += ` L ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]}`;
    return path;
  }, [board]);

  return (
    <svg
      className="river-overlay"
      viewBox={`0 0 ${board.w * 100} ${board.h * 100}`}
      preserveAspectRatio="none"
    >
      <path d={d} fill="none" stroke="#3e88ad" strokeWidth="56" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#79c6e3" strokeWidth="44" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#b6e4f2" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
    </svg>
  );
}

// ---------- Spielfeld ----------

export default function BoardView({ board, placements, preview, onDrawCell, small }: Props) {
  const covered = coveredMap(placements);
  const previewSet = new Set((preview?.cells ?? []).map(([r, c]) => r + ',' + c));
  const boardRef = useRef<HTMLDivElement | null>(null);
  const strokeRef = useRef<{ mode: DrawMode; visited: Set<string> } | null>(null);

  function cellAtPoint(clientX: number, clientY: number): Cell | null {
    const el = boardRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const c = Math.floor(((clientX - rect.left) / rect.width) * board.w);
    const r = Math.floor(((clientY - rect.top) / rect.height) * board.h);
    if (r < 0 || r >= board.h || c < 0 || c >= board.w) return null;
    return [r, c];
  }

  function handleDown(e: React.PointerEvent) {
    if (!onDrawCell) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const cell = cellAtPoint(e.clientX, e.clientY);
    if (!cell) return;
    const k = cell[0] + ',' + cell[1];
    const mode: DrawMode = previewSet.has(k) ? 'remove' : 'add';
    strokeRef.current = { mode, visited: new Set([k]) };
    onDrawCell(cell[0], cell[1], mode);
  }

  function handleMove(e: React.PointerEvent) {
    if (!onDrawCell || !strokeRef.current) return;
    const cell = cellAtPoint(e.clientX, e.clientY);
    if (!cell) return;
    const k = cell[0] + ',' + cell[1];
    if (strokeRef.current.visited.has(k)) return;
    strokeRef.current.visited.add(k);
    onDrawCell(cell[0], cell[1], strokeRef.current.mode);
  }

  function handleUp() {
    strokeRef.current = null;
  }

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
        const sameB = (rr: number, cc: number) => covered.get(rr + ',' + cc) === pIdx;
        if (!sameB(r - 1, c)) classes.push('b-top');
        if (!sameB(r + 1, c)) classes.push('b-bottom');
        if (!sameB(r, c - 1)) classes.push('b-left');
        if (!sameB(r, c + 1)) classes.push('b-right');
      }
      if (previewSet.has(k)) classes.push('preview-' + preview!.state);

      cells.push(
        <div key={k} className={classes.join(' ')}>
          {placement?.type === 'oeffentlich' ? (
            <span className="x-mark">✕</span>
          ) : placement?.type === 'kirche' ? (
            <span className="circle-mark">◯</span>
          ) : placement ? null : (
            cellIcon(t)
          )}
        </div>
      );
    }
  }

  return (
    <div className={'board-frame' + (small ? ' board-small' : '')}>
      <div
        ref={boardRef}
        className={'board' + (onDrawCell ? ' interactive' : '')}
        style={{ gridTemplateColumns: `repeat(${board.w}, 1fr)` }}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
      >
        {cells}
        <RiverOverlay board={board} />
      </div>
    </div>
  );
}
