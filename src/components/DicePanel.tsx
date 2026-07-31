import { useEffect, useState } from 'react';
import { churchShapesFor, DIE_A_FACES, DIE_B_FACES, combinedCells, shapeName } from '../game/dice';
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

// ---------- Zirkel-Symbol ----------

function ZirkelIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26">
      <circle cx="12" cy="5" r="2.2" fill="none" stroke="#fff" strokeWidth="1.6" />
      <path d="M11 7 L6.5 20 M13 7 L17.5 20" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.2 15.5 A7 7 0 0 0 15.8 15.5" fill="none" stroke="#fff" strokeWidth="1.2" />
    </svg>
  );
}

// ---------- Blaue Würfelseiten (echte Seiten, 2x2 + Halbkreis) ----------

function BlueDieFace({ face, side }: { face: { cells: Cell[]; special?: string }; side: 'A' | 'B' }) {
  const set = new Set(face.cells.map(([r, c]) => r + ',' + c));
  const squares = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      squares.push(
        <div key={r + ',' + c} className={'die-sq' + (set.has(r + ',' + c) ? ' on' : '')} />
      );
    }
  }
  return (
    <div className={'blue-die connector-' + (side === 'A' ? 'right' : 'left')}>
      {face.special === 'zirkel' ? (
        <div className="zirkel-face">
          <ZirkelIcon />
        </div>
      ) : (
        squares
      )}
      <span className="connector-dot" />
    </div>
  );
}

// ---------- Würfel-Panel mit Wurf-Animation ----------

export default function DicePanel({
  dice,
  gameNo,
  rollKey,
}: {
  dice: DiceResult;
  gameNo: number;
  rollKey: string;
}) {
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

  const faceA = DIE_A_FACES[dice.a];
  const faceB = DIE_B_FACES[dice.b];
  const cells = combinedCells(dice.a, dice.b);
  const hasZirkel = faceB.special === 'zirkel';

  // Festungsrunde (Kapitel 4): Zirkel gewürfelt -> Festung bauen
  if (dice.fort) {
    return (
      <div className="dice-panel result-pop">
        <div className="dice-row">
          <BlueDieFace face={faceB} side="B" />
          <span className="dice-plus">→</span>
          <div className="mini-grid" style={{ gridTemplateColumns: 'repeat(1, 20px)' }}>
            <div className="mini-cell filled built-festung">
              <span className="fort-mark">▲</span>
            </div>
          </div>
        </div>
        <div className="dice-label">
          <b>Festung bauen!</b>
        </div>
        <div className="dice-note">
          Beliebiges freies Feld, keine Angrenzung nötig – Festungen müssen gebaut werden.
        </div>
      </div>
    );
  }

  // Kirchenrunde (Spiele 4-8): Zirkel gewürfelt -> alle bauen dieselbe Kirche
  if (dice.church != null) {
    const shapes = churchShapesFor(gameNo);
    const church = shapes[dice.church];
    const maxR = Math.max(...church.map((c) => c[0])) + 1;
    const maxC = Math.max(...church.map((c) => c[1])) + 1;
    const set = new Set(church.map(([r, c]) => r + ',' + c));
    const out = [];
    for (let r = 0; r < maxR; r++) {
      for (let c = 0; c < maxC; c++) {
        const filled = set.has(r + ',' + c);
        out.push(
          <div key={r + ',' + c} className={'mini-cell' + (filled ? ' filled built-kirche' : ' empty-mini')}>
            {filled ? <span className="circle-mark">◯</span> : null}
          </div>
        );
      }
    }
    return (
      <div className="dice-panel result-pop">
        <div className="dice-row">
          <BlueDieFace face={faceB} side="B" />
          <span className="dice-plus">→</span>
          <div className="mini-grid" style={{ gridTemplateColumns: `repeat(${maxC}, 20px)` }}>
            {out}
          </div>
        </div>
        <div className="dice-label">
          <b>Kirche bauen!</b> ({dice.church + 1}/{shapes.length})
        </div>
        <div className="dice-note">Zirkel gewürfelt: alle zeichnen diese Kirche ein (◯)</div>
      </div>
    );
  }

  return (
    <div className="dice-panel result-pop">
      <div className="dice-row">
        <div className="dice-pair">
          <BlueDieFace face={faceA} side="A" />
          <BlueDieFace face={faceB} side="B" />
        </div>
        <span className="dice-plus">+</span>
        <div className="white-die">
          <HouseIcon type={dice.type} />
        </div>
      </div>
      <div className="dice-label">
        <b>{shapeName(cells)}</b> · {TYPE_NAME[dice.type]}
      </div>
      {hasZirkel && (
        <div className="dice-note">Zirkel: zählt gerade als leere Seite – nur der linke Würfel zählt</div>
      )}
      {faceB.special === 'blank' && (
        <div className="dice-note">Leere Seite: es zählt nur der linke Würfel</div>
      )}
    </div>
  );
}
