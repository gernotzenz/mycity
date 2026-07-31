import { useMemo, useState } from 'react';
import { boardForGame } from '../game/board';
import type { CellType, RiverPoint } from '../game/board';

// Einfacher Karten-Editor: Feldtyp wählen, Zellen antippen, Flusspfad als
// JSON bearbeiten. Der generierte Code-Block wird per Copy&Paste in
// src/game/board.ts übernommen (oder einfach an Claude geschickt).

const TYPES: [CellType, string, string][] = [
  ['.', 'leer', '#f6ecce'],
  ['T', 'Baum', '#9fd08a'],
  ['D', 'Doppelbaum', '#6db958'],
  ['S', 'Stein', '#c2bcb1'],
  ['M', 'Gebirge', '#a49b8b'],
  ['F', 'Wald', '#2f5d33'],
  ['W', 'Brunnen', '#8ec6de'],
  ['K', 'Kirche', '#e5d5a8'],
  ['R', 'breiter Fluss', '#5aa9cc'],
  ['H', 'Hochebene', '#d5e3a4'],
  ['G', 'Gold', '#ecd06e'],
  ['Z', 'Sägewerk', '#b08a5e'],
  ['P', 'Festung', '#a05f36'],
  ['B', 'Bandit', '#5a4a3a'],
];

export default function MapEditor({ onClose }: { onClose: () => void }) {
  const [gameNo, setGameNo] = useState(1);
  const [grid, setGrid] = useState<CellType[][]>(() =>
    boardForGame(1).grid.map((r) => [...r])
  );
  const [riverText, setRiverText] = useState(() =>
    JSON.stringify(boardForGame(1).riverPath)
  );
  const [brush, setBrush] = useState<CellType>('.');

  function load(g: number) {
    setGameNo(g);
    const b = boardForGame(g);
    setGrid(b.grid.map((r) => [...r]));
    setRiverText(JSON.stringify(b.riverPath));
  }

  function paint(r: number, c: number) {
    setGrid((prev) => {
      const next = prev.map((row) => [...row]);
      next[r][c] = next[r][c] === brush ? '.' : brush;
      return next;
    });
  }

  const riverPath: RiverPoint[] = useMemo(() => {
    try {
      const parsed = JSON.parse(riverText);
      if (Array.isArray(parsed)) return parsed as RiverPoint[];
    } catch {
      /* ungültiges JSON -> kein Fluss */
    }
    return [];
  }, [riverText]);

  const h = grid.length;
  const w = grid[0].length;

  const output = useMemo(() => {
    const rows = grid.map((row) => `  '${row.join('')}',`).join('\n');
    return `const SPIEL_${gameNo}_LAYOUT = [\n${rows}\n];\nconst RIVER_${gameNo}: RiverPoint[] = ${riverText};`;
  }, [grid, riverText, gameNo]);

  const riverD = useMemo(() => {
    if (riverPath.length < 2) return '';
    const pts = riverPath.map(([y, x]) => `${x * 100},${y * 100}`);
    return 'M ' + pts.join(' L ');
  }, [riverPath]);

  return (
    <div className="page">
      <h1>Karten-Editor</h1>
      <div className="card">
        <div className="row-buttons wrap">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
            <button key={g} className={g === gameNo ? 'primary' : ''} onClick={() => load(g)}>
              {g}
            </button>
          ))}
        </div>
        <div className="row-buttons wrap">
          {TYPES.map(([t, label, color]) => (
            <button
              key={t}
              className={'brush' + (brush === t ? ' primary' : '')}
              style={{ borderLeft: `10px solid ${color}` }}
              onClick={() => setBrush(t)}
            >
              {t} {label}
            </button>
          ))}
        </div>
        <p className="hint">
          Feldtyp wählen und Zellen antippen (nochmal antippen = leeren). Der Fluss läuft auf
          den LINIEN und wird unten als Punktliste [Zeile, Spalte] von Gitterpunkten bearbeitet.
        </p>
      </div>

      <div className="board-frame">
        <div className="board" style={{ gridTemplateColumns: `repeat(${w}, 1fr)`, position: 'relative' }}>
          {grid.map((row, r) =>
            row.map((t, c) => {
              const def = TYPES.find(([tt]) => tt === t);
              return (
                <div
                  key={r + ',' + c}
                  className="cell editor-cell"
                  style={{ background: def?.[2] ?? '#fff' }}
                  onClick={() => paint(r, c)}
                >
                  {t !== '.' ? t : ''}
                </div>
              );
            })
          )}
          <svg
            className="river-overlay"
            viewBox={`0 0 ${w * 100} ${h * 100}`}
            preserveAspectRatio="none"
          >
            <path d={riverD} fill="none" stroke="#3e88ad" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
          </svg>
        </div>
      </div>

      <div className="card">
        <label>Flusspfad (Gitterpunkte [Zeile, Spalte], achsenparallel verbunden)</label>
        <textarea
          value={riverText}
          onChange={(e) => setRiverText(e.target.value)}
          rows={2}
          className="editor-textarea"
        />
        <label>Generierter Code (kopieren und in board.ts einsetzen oder an Claude schicken)</label>
        <textarea readOnly value={output} rows={12} className="editor-textarea" onFocus={(e) => e.target.select()} />
        <button
          className="primary big"
          onClick={() => navigator.clipboard?.writeText(output)}
        >
          📋 Code kopieren
        </button>
        <button className="big" onClick={onClose}>
          Zurück
        </button>
      </div>
    </div>
  );
}
