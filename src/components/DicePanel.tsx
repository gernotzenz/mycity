import { useEffect, useState } from 'react';
import { SHAPE_BY_ID, normalize } from '../game/dice';
import type { BuildingType, Cell, DiceResult } from '../game/types';

const TYPE_NAME: Record<string, string> = {
  wohn: 'Wohngebäude',
  gewerbe: 'Gewerbegebäude',
  oeffentlich: 'Öffentliches Gebäude',
};

// ---------- Haus-Symbol (weißer Würfel) ----------

function HouseIcon({ type, size = 34 }: { type: BuildingType; size?: number }) {
  const fill =
    type === 'wohn' ? '#274b8f' : type === 'oeffentlich' ? '#ffffff' : 'url(#hatch)';
  return (
    <svg viewBox="0 0 24 24" width={size} height={size}>
      <defs>
        <pattern id="hatch" width="3" height="3" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill="#ffffff" />
          <line x1="0" y1="0" x2="0" y2="3" stroke="#274b8f" strokeWidth="1.6" />
        </pattern>
      </defs>
      <path
        d="M3 11 L12 3 L21 11 V21 H3 Z"
        fill={fill}
        stroke="#1e2f57"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {type === 'oeffentlich' && (
        <g stroke="#1e2f57" strokeWidth="2.2" strokeLinecap="round">
          <line x1="8" y1="12" x2="16" y2="19" />
          <line x1="16" y1="12" x2="8" y2="19" />
        </g>
      )}
    </svg>
  );
}

// ---------- Blaue Würfelhälften ----------

function splitHalves(cells: Cell[]): [Cell[], Cell[]] {
  const sorted = [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const half = Math.ceil(sorted.length / 2);
  const left = sorted.slice(0, half);
  const right = sorted.slice(half);
  return [
    left.length ? normalize(left) : [],
    right.length ? normalize(right) : [],
  ];
}

function BlueDieFace({ cells, connector }: { cells: Cell[]; connector: 'right' | 'left' }) {
  const set = new Set(cells.map(([r, c]) => r + ',' + c));
  const squares = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      squares.push(
        <div key={r + ',' + c} className={'die-sq' + (set.has(r + ',' + c) ? ' on' : '')} />
      );
    }
  }
  return (
    <div className={'blue-die connector-' + connector}>
      {squares}
      <span className="connector-dot" />
    </div>
  );
}

// ---------- Ergebnis: kombinierte Form ----------

export function CombinedShape({ shapeId, type }: { shapeId: string; type: BuildingType }) {
  const cells = SHAPE_BY_ID[shapeId].cells;
  const maxR = Math.max(...cells.map((c) => c[0])) + 1;
  const maxC = Math.max(...cells.map((c) => c[1])) + 1;
  const set = new Set(cells.map(([r, c]) => r + ',' + c));
  const out = [];
  for (let r = 0; r < maxR; r++) {
    for (let c = 0; c < maxC; c++) {
      const filled = set.has(r + ',' + c);
      out.push(
        <div key={r + ',' + c} className={'mini-cell' + (filled ? ' filled built-' + type : ' empty-mini')}>
          {filled && type === 'oeffentlich' ? <span className="x-mark">✕</span> : null}
        </div>
      );
    }
  }
  return (
    <div className="mini-grid" style={{ gridTemplateColumns: `repeat(${maxC}, 20px)` }}>
      {out}
    </div>
  );
}

// ---------- Würfel-Panel mit Wurf-Animation ----------

export default function DicePanel({ dice, rollKey }: { dice: DiceResult; rollKey: string }) {
  const [rolling, setRolling] = useState(true);

  useEffect(() => {
    setRolling(true);
    const t = setTimeout(() => setRolling(false), 1100);
    return () => clearTimeout(t);
  }, [rollKey]);

  if (rolling) {
    return (
      <div className="dice-panel rolling">
        <div className="tumble-die blue d1">?</div>
        <div className="tumble-die blue d2">?</div>
        <div className="tumble-die white d3">?</div>
      </div>
    );
  }

  const shape = SHAPE_BY_ID[dice.shapeId];
  const [left, right] = splitHalves(shape.cells);

  return (
    <div className="dice-panel result-pop">
      <div className="dice-row">
        <BlueDieFace cells={left} connector="right" />
        <BlueDieFace cells={right} connector="left" />
        <span className="dice-eq">=</span>
        <CombinedShape shapeId={dice.shapeId} type={dice.type} />
        <span className="dice-plus">+</span>
        <div className="white-die">
          <HouseIcon type={dice.type} />
        </div>
      </div>
      <div className="dice-label">
        <b>{shape.name}</b> · {TYPE_NAME[dice.type]}
      </div>
    </div>
  );
}
