import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import { boardForGame } from './game/board';
import { rollDice, transformShape, SHAPE_BY_ID } from './game/dice';
import { scoreGame, validatePlacement } from './game/rules';
import type { Cell, GameRow, PlayerState, SharedState } from './game/types';
import { BUILDING_LABEL, MAX_PASSES } from './game/types';
import BoardView from './components/BoardView';
import DicePanel from './components/DicePanel';

// ---------------- Hilfsfunktionen ----------------

function newPlayer(name: string): PlayerState {
  return { name, placements: [], passes: 0, finished: false, doneRound: 0 };
}

function randomCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function bothDone(shared: SharedState, p1: PlayerState | null, p2: PlayerState | null): boolean {
  const done = (p: PlayerState | null) => !!p && (p.finished || p.doneRound >= shared.round);
  return done(p1) && done(p2);
}

// ---------------- App ----------------

export default function App() {
  const [name, setName] = useState<string>(() => localStorage.getItem('mc:name') ?? '');
  const [row, setRow] = useState<GameRow | null>(null);
  const [seat, setSeat] = useState<1 | 2>(1);
  const [joinCode, setJoinCode] = useState<string>(
    () => new URLSearchParams(location.search).get('code')?.toUpperCase() ?? ''
  );
  const [error, setError] = useState<string>('');
  const rowRef = useRef<GameRow | null>(null);
  rowRef.current = row;

  useEffect(() => {
    localStorage.setItem('mc:name', name);
  }, [name]);

  // ---- Sync: Realtime + Polling-Fallback ----
  useEffect(() => {
    if (!supabase || !row) return;
    const code = row.code;
    const channel = supabase
      .channel('game-' + code)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `code=eq.${code}` },
        (payload) => setRow(payload.new as GameRow)
      )
      .subscribe();
    const poll = setInterval(async () => {
      const { data } = await supabase!.from('games').select('*').eq('code', code).single();
      if (data) setRow(data as GameRow);
    }, 4000);
    return () => {
      supabase!.removeChannel(channel);
      clearInterval(poll);
    };
  }, [row?.code]);

  const persist = useCallback(
    async (patch: Partial<GameRow>) => {
      if (!supabase || !rowRef.current) return;
      const merged = { ...rowRef.current, ...patch };
      setRow(merged);
      await supabase.from('games').update(patch).eq('code', rowRef.current.code);
    },
    []
  );

  // Rundenfortschritt: der Würfelnde schaltet weiter, sobald beide fertig sind.
  // Hat der Würfelnde sein Spiel beendet, übernimmt der andere Spieler.
  useEffect(() => {
    if (!row || row.shared.status !== 'playing' || !row.shared.dice) return;
    const rollerPlayer = row.shared.rollerSeat === 1 ? row.p1 : row.p2;
    const advancerSeat: 1 | 2 =
      rollerPlayer && !rollerPlayer.finished
        ? row.shared.rollerSeat
        : row.shared.rollerSeat === 1
          ? 2
          : 1;
    if (advancerSeat !== seat) return;
    if (!bothDone(row.shared, row.p1, row.p2)) return;
    const p1f = row.p1?.finished ?? false;
    const p2f = row.p2?.finished ?? false;
    if (p1f && p2f) {
      persist({ shared: { ...row.shared, status: 'scoring', dice: null } });
    } else {
      // Nächster Würfler: abwechselnd, aber nie ein Spieler, der schon fertig ist.
      const toggled: 1 | 2 = row.shared.rollerSeat === 1 ? 2 : 1;
      const toggledPlayer = toggled === 1 ? row.p1 : row.p2;
      const nextRoller: 1 | 2 =
        toggledPlayer && !toggledPlayer.finished ? toggled : row.shared.rollerSeat;
      const nextRollerPlayer = nextRoller === 1 ? row.p1 : row.p2;
      const finalRoller: 1 | 2 =
        nextRollerPlayer && !nextRollerPlayer.finished ? nextRoller : toggled;
      persist({
        shared: {
          ...row.shared,
          dice: null,
          round: row.shared.round + 1,
          rollerSeat: finalRoller,
        },
      });
    }
  }, [row, seat, persist]);

  // Beide fertig → Wertung (falls der Würfelnde offline ist, greift das hier auch)
  useEffect(() => {
    if (!row || row.shared.status !== 'playing') return;
    if (row.p1?.finished && row.p2?.finished) {
      persist({ shared: { ...row.shared, status: 'scoring', dice: null } });
    }
  }, [row, persist]);

  // ---- Aktionen ----

  async function createGame(gameNo: 1 | 2 | 3) {
    if (!supabase) return;
    setError('');
    const code = randomCode();
    const shared: SharedState = { status: 'lobby', gameNo, round: 0, rollerSeat: 1, dice: null };
    const { data, error: err } = await supabase
      .from('games')
      .insert({ code, shared, p1: newPlayer(name || 'Spieler 1'), p2: null })
      .select()
      .single();
    if (err || !data) {
      setError('Spiel konnte nicht erstellt werden: ' + (err?.message ?? ''));
      return;
    }
    localStorage.setItem('mc:seat:' + code, '1');
    setSeat(1);
    setRow(data as GameRow);
  }

  async function joinGame(codeRaw: string) {
    if (!supabase) return;
    setError('');
    const code = codeRaw.trim().toUpperCase();
    const { data } = await supabase.from('games').select('*').eq('code', code).single();
    if (!data) {
      setError('Kein Spiel mit Code ' + code + ' gefunden.');
      return;
    }
    const g = data as GameRow;
    const savedSeat = localStorage.getItem('mc:seat:' + code);
    if (savedSeat === '1' || savedSeat === '2') {
      setSeat(Number(savedSeat) as 1 | 2);
      setRow(g);
      return;
    }
    if (g.p2) {
      setError('Dieses Spiel ist schon voll.');
      return;
    }
    const p2 = newPlayer(name || 'Spieler 2');
    await supabase.from('games').update({ p2 }).eq('code', code);
    localStorage.setItem('mc:seat:' + code, '2');
    setSeat(2);
    setRow({ ...g, p2 });
  }

  function startGame() {
    if (!row) return;
    persist({ shared: { ...row.shared, status: 'playing', round: 1, rollerSeat: 1, dice: null } });
  }

  function doRoll() {
    if (!row) return;
    persist({ shared: { ...row.shared, dice: rollDice() } });
  }

  async function updateMe(patch: Partial<PlayerState>) {
    if (!row) return;
    const me = seat === 1 ? row.p1! : row.p2!;
    const updated = { ...me, ...patch };
    await persist(seat === 1 ? { p1: updated } : { p2: updated });
  }

  function restart(gameNo: 1 | 2 | 3) {
    if (!row) return;
    persist({
      shared: { status: 'playing', gameNo, round: 1, rollerSeat: 1, dice: null },
      p1: row.p1 ? newPlayer(row.p1.name) : null,
      p2: row.p2 ? newPlayer(row.p2.name) : null,
    });
  }

  // ---- Screens ----

  if (!supabase) {
    return (
      <div className="page">
        <h1>My City – Würfelspiel</h1>
        <div className="card">
          <p>
            <b>Konfiguration fehlt:</b> Lege die Umgebungsvariablen{' '}
            <code>VITE_SUPABASE_URL</code> und <code>VITE_SUPABASE_ANON_KEY</code> an (lokal in
            einer <code>.env</code>-Datei, auf Vercel unter Settings → Environment Variables).
            Details stehen in der README.
          </p>
        </div>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="page">
        <h1 className="logo">My City</h1>
        <p className="tagline">Würfelspiel · Kapitel 1</p>
        <div className="card">
          <label>Dein Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        </div>
        <div className="card">
          <h2>Neues Spiel</h2>
          <div className="row-buttons">
            <button className="primary" onClick={() => createGame(1)}>Spiel 1</button>
            <button onClick={() => createGame(2)}>Spiel 2</button>
            <button onClick={() => createGame(3)}>Spiel 3</button>
          </div>
          <p className="hint">Kapitel 1: Das neue Land</p>
        </div>
        <div className="card">
          <h2>Spiel beitreten</h2>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="CODE"
            maxLength={4}
          />
          <button className="primary" onClick={() => joinGame(joinCode)} disabled={joinCode.length !== 4}>
            Beitreten
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  if (row.shared.status === 'lobby') {
    const link = `${location.origin}${location.pathname}?code=${row.code}`;
    return (
      <div className="page">
        <h1>Warteraum</h1>
        <div className="card center">
          <p>Spiel-Code:</p>
          <div className="big-code">{row.code}</div>
          <p className="hint">Link teilen:</p>
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
          <p>
            Spieler 1: <b>{row.p1?.name}</b>
            <br />
            Spieler 2: <b>{row.p2?.name ?? '– wartet –'}</b>
          </p>
          {seat === 1 && (
            <button className="primary big" onClick={startGame} disabled={!row.p2}>
              Spiel starten
            </button>
          )}
          {seat === 2 && <p className="hint">Warte, bis {row.p1?.name} startet …</p>}
        </div>
      </div>
    );
  }

  if (row.shared.status === 'scoring') {
    return <ScoringScreen row={row} seat={seat} onRestart={restart} />;
  }

  return <GameScreen row={row} seat={seat} onRoll={doRoll} updateMe={updateMe} />;
}

// ---------------- Spiel-Screen ----------------

function GameScreen({
  row,
  seat,
  onRoll,
  updateMe,
}: {
  row: GameRow;
  seat: 1 | 2;
  onRoll: () => void;
  updateMe: (patch: Partial<PlayerState>) => Promise<void>;
}) {
  const shared = row.shared;
  const board = useMemo(() => boardForGame(shared.gameNo), [shared.gameNo]);
  const me = seat === 1 ? row.p1! : row.p2!;
  const other = seat === 1 ? row.p2 : row.p1;
  const myTurnToRoll = shared.rollerSeat === seat && !shared.dice && !me.finished;
  const canAct = !!shared.dice && !me.finished && me.doneRound < shared.round;

  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [rot, setRot] = useState(0);
  const [mirrored, setMirrored] = useState(false);

  // Bei neuem Wurf Auswahl zurücksetzen
  useEffect(() => {
    setAnchor(null);
    setRot(0);
    setMirrored(false);
  }, [shared.round, shared.dice?.shapeId]);

  const previewCells: Cell[] | null = useMemo(() => {
    if (!shared.dice || !anchor) return null;
    const rel = transformShape(shared.dice.shapeId, rot, mirrored);
    return rel.map(([r, c]) => [r + anchor[0], c + anchor[1]] as Cell);
  }, [shared.dice, anchor, rot, mirrored]);

  const validation = useMemo(() => {
    if (!previewCells) return null;
    return validatePlacement(board, me.placements, previewCells);
  }, [previewCells, board, me.placements]);

  async function confirmPlace() {
    if (!previewCells || !validation?.ok || !shared.dice) return;
    await updateMe({
      placements: [
        ...me.placements,
        { cells: previewCells, type: shared.dice.type, round: shared.round },
      ],
      doneRound: shared.round,
    });
    setAnchor(null);
  }

  async function doPass() {
    if (me.passes >= MAX_PASSES) return;
    if (!confirm('Wirklich passen? (Kreis ' + (me.passes + 1) + ' von 6 wird ausgemalt)')) return;
    await updateMe({ passes: me.passes + 1, doneRound: shared.round });
  }

  async function doFinish() {
    if (!confirm('Spiel für dich beenden? Du kannst danach keine Gebäude mehr einzeichnen.')) return;
    await updateMe({ finished: true, doneRound: shared.round });
  }

  const waitingForOther =
    !me.finished && !canAct && !myTurnToRoll && shared.dice != null;

  return (
    <div className="page game">
      <header className="game-header">
        <span>Kapitel 1 · Spiel {shared.gameNo}</span>
        <span>Runde {shared.round}</span>
        <span>Passen: {me.passes}/6</span>
      </header>

      <div className="dice-area">
        {shared.dice ? (
          <DicePanel
            dice={shared.dice}
            rollKey={shared.round + '-' + shared.dice.shapeId + '-' + shared.dice.type}
          />
        ) : me.finished ? (
          <p className="hint">Du hast dein Spiel beendet – warte auf {other?.name ?? 'Mitspieler'} …</p>
        ) : myTurnToRoll ? (
          <button className="primary big" onClick={onRoll}>
            🎲 Würfeln
          </button>
        ) : (
          <p className="hint">{other?.name ?? 'Mitspieler'} würfelt …</p>
        )}
      </div>

      <BoardView
        board={board}
        placements={me.placements}
        preview={
          previewCells && canAct ? { cells: previewCells, valid: validation?.ok ?? false } : null
        }
        onTapCell={canAct ? (r, c) => setAnchor([r, c]) : undefined}
      />

      {canAct && (
        <div className="controls">
          {anchor ? (
            <>
              <div className="row-buttons">
                <button onClick={() => setRot((r) => r + 1)}>↻ Drehen</button>
                <button onClick={() => setMirrored((m) => !m)}>⇄ Spiegeln</button>
              </div>
              {!validation?.ok && validation?.reason && (
                <p className="error small">{validation.reason}</p>
              )}
              <button className="primary big" disabled={!validation?.ok} onClick={confirmPlace}>
                ✔ Einzeichnen
              </button>
            </>
          ) : (
            <p className="hint">Tippe auf ein Feld, um die Form zu platzieren.</p>
          )}
          <div className="row-buttons">
            <button onClick={doPass} disabled={me.passes >= MAX_PASSES}>
              Passen ({me.passes}/6)
            </button>
            <button className="danger" onClick={doFinish}>
              Spiel beenden
            </button>
          </div>
        </div>
      )}

      {waitingForOther && (
        <p className="hint center">Eingezeichnet ✔ – warte auf {other?.name ?? 'Mitspieler'} …</p>
      )}

      {other && (
        <div className="opponent">
          <h3>
            {other.name} · Gebäude: {other.placements.length} · Passen: {other.passes}/6{' '}
            {other.finished ? '· fertig' : ''}
          </h3>
          <BoardView board={board} placements={other.placements} small />
        </div>
      )}
    </div>
  );
}

// ---------------- Wertung ----------------

function ScoringScreen({
  row,
  seat,
  onRestart,
}: {
  row: GameRow;
  seat: 1 | 2;
  onRestart: (gameNo: 1 | 2 | 3) => void;
}) {
  const board = boardForGame(row.shared.gameNo);
  const players = [row.p1, row.p2].filter(Boolean) as PlayerState[];
  const scores = players.map((p) => scoreGame(board, p, row.shared.gameNo));
  const winner =
    scores.length === 2
      ? scores[0].total === scores[1].total
        ? 'Unentschieden!'
        : scores[0].total > scores[1].total
          ? `${players[0].name} gewinnt!`
          : `${players[1].name} gewinnt!`
      : '';

  return (
    <div className="page">
      <h1>Wertung – Spiel {row.shared.gameNo}</h1>
      <table className="score-table">
        <thead>
          <tr>
            <th></th>
            {players.map((p) => (
              <th key={p.name}>{p.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Gebäude nicht bauen</td>
            {scores.map((s, i) => (
              <td key={i}>{s.passPoints}</td>
            ))}
          </tr>
          <tr>
            <td>Baum +1</td>
            {scores.map((s, i) => (
              <td key={i}>+{s.treePoints}</td>
            ))}
          </tr>
          <tr>
            <td>Stein −1</td>
            {scores.map((s, i) => (
              <td key={i}>{s.stonePoints}</td>
            ))}
          </tr>
          <tr>
            <td>Leeres Feld −1</td>
            {scores.map((s, i) => (
              <td key={i}>{s.emptyPoints}</td>
            ))}
          </tr>
          {row.shared.gameNo >= 2 && (
            <>
              {(['wohn', 'gewerbe', 'oeffentlich'] as const).map((t) => (
                <tr key={t}>
                  <td>Größte Gruppe {BUILDING_LABEL[t].split(' ')[0]}</td>
                  {scores.map((s, i) => (
                    <td key={i}>+{s.groupPoints?.[t] ?? 0}</td>
                  ))}
                </tr>
              ))}
            </>
          )}
          {row.shared.gameNo >= 3 && (
            <tr>
              <td>Brunnen</td>
              {scores.map((s, i) => (
                <td key={i}>+{s.wellPoints ?? 0}</td>
              ))}
            </tr>
          )}
          <tr className="total-row">
            <td>Summe</td>
            {scores.map((s, i) => (
              <td key={i}>
                <b>{s.total}</b>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <h2 className="center">{winner}</h2>

      <div className="boards-final">
        {players.map((p) => (
          <div key={p.name}>
            <h3>{p.name}</h3>
            <BoardView board={board} placements={p.placements} small />
          </div>
        ))}
      </div>

      {seat === 1 && (
        <div className="card">
          <h2>Nochmal spielen</h2>
          <div className="row-buttons">
            <button className="primary" onClick={() => onRestart(1)}>Spiel 1</button>
            <button className="primary" onClick={() => onRestart(2)}>Spiel 2</button>
            <button className="primary" onClick={() => onRestart(3)}>Spiel 3</button>
          </div>
        </div>
      )}
    </div>
  );
}
