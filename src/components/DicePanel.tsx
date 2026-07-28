import { SHAPE_BY_ID, transformShape } from '../game/dice';
import type { DiceResult } from '../game/types';

const TYPE_NAME: Record<string, string> = {
  wohn: 'Wohngebäude',
  gewerbe: 'Gewerbe',
  oeffentlich: 'Öffentlich',
};

export function ShapePreview({
  shapeId,
  rot,
  mirrored,
  type,
}: {
  shapeId: string;
  rot: number;
  mirrored: boolean;
  type: string;
}) {
  const cells = transformShape(shapeId, rot, mirrored);
  const maxR = Math.max(...cells.map((c) => c[0])) + 1;
  const maxC = Math.max(...cells.map((c) => c[1])) + 1;
  const set = new Set(cells.map(([r, c]) => r + ',' + c));
  const out = [];
  for (let r = 0; r < maxR; r++) {
    for (let c = 0; c < maxC; c++) {
      const filled = set.has(r + ',' + c);
      out.push(
        <div
          key={r + ',' + c}
          className={
            'mini-cell' + (filled ? ' filled built-' + type : ' empty-mini')
          }
        >
          {filled && type === 'oeffentlich' ? <span className="x-mark">✕</span> : null}
        </div>
      );
    }
  }
  return (
    <div className="mini-grid" style={{ gridTemplateColumns: `repeat(${maxC}, 22px)` }}>
      {out}
    </div>
  );
}

export default function DicePanel({ dice }: { dice: DiceResult }) {
  const shape = SHAPE_BY_ID[dice.shapeId];
  return (
    <div className="dice-panel">
      <ShapePreview shapeId={dice.shapeId} rot={0} mirrored={false} type={dice.type} />
      <div className="dice-label">
        <b>{shape.name}</b>
        <span>{TYPE_NAME[dice.type]}</span>
      </div>
    </div>
  );
}
