import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import { boardForGame } from './game/board';
import { rollDice, combinedCells, shapesEqual } from './game/dice';
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

  // Nach einem Seiten-Reload (z. B. Pull-to-Refresh) laufendes Spiel wiederherstellen
  useEffect(() => {
    if (!supabase) return;
    const code = localStorage.getItem('mc:current');
    if (!code) return;
    const savedSeat = localStorage.getItem('mc:seat:' + code);
    if (savedSeat !== '1' && savedSeat !== '2') return;
    supabase
      .from('games')
      .select('*')
      .eq('code', code)
      .single()
      .then(({ data }) => {
        if (data) {
          setSeat(Number(savedSeat) as 1 | 2);
          setRow(data as GameRow);
        } else {
          localStorage.removeItem('mc:current');
        }
      });
  }, []);

  function leaveGame() {
    if (!confirm('Zur Startseite? Mit dem Spiel-Code kannst du jederzeit wieder beitreten.')) return;
    localStorage.removeItem('mc:current');
    setRow(null);
  }

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
    localStorage.setItem('mc:current', code);
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
      localStorage.setItem('mc:current', code);
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
    localStorage.setItem('mc:current', code);
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
          <button onClick={leaveGame}>Verlassen</button>
        </div>
      </div>
    );
  }

  if (row.shared.status === 'scoring') {
    return <ScoringScreen row={row} seat={seat} onRestart={restart} onLeave={leaveGame} />;
  }

  return (
    <GameScreen row={row} seat={seat} onRoll={doRoll} updateMe={updateMe} onLeave={leaveGame} />
  );
}

// ---------------- Regel-Info ----------------

function RulesModal({ gameNo, onClose }: { gameNo: 1 | 2 | 3; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Kapitel 1 · Spiel {gameNo}</h2>
        {gameNo === 1 && (
          <p className="story">
            <i>
              Als erste Siedler habt ihr das neue Land erreicht und errichtet eure Gebäude
              entlang des Flusses.
            </i>
          </p>
        )}
        {gameNo === 2 && (
          <p className="story">
            <i>
              Eure Gemeinde einigt sich auf ein geplantes Vorgehen – nun entstehen geordnete
              Stadtviertel.
            </i>
          </p>
        )}
        {gameNo === 3 && (
          <p className="story">
            <i>
              Um die Wasserversorgung zu verbessern, wird im Osten ein Brunnen gebohrt, von dem
              möglichst viele Gebäude profitieren sollen.
            </i>
          </p>
        )}
        <h3>Bauregeln</h3>
        <ul>
          <li>Das erste Gebäude muss mit einer Seite an den Fluss angrenzen.</li>
          <li>Jedes weitere Gebäude muss an ein vorhandenes angrenzen (auch über den Fluss hinweg).</li>
          <li>Nicht über den Fluss bauen; Gebirge und Wald sind gesperrt.</li>
          <li>Bäume und Steine dürfen überbaut werden.</li>
          <li>Passen kostet: −1 / −2 / −3 / −5 / −7 / −10 (max. 6-mal).</li>
          <li>Nach jedem Wurf darfst du dein Spiel freiwillig beenden.</li>
        </ul>
        <h3>Wertung</h3>
        <ul>
          <li>Jeder freie Baum: +1</li>
          <li>Jeder nicht überbaute Stein: −1</li>
          <li>Jedes leere Feld: −1</li>
          {gameNo >= 2 && (
            <li>
              Je Gebäudeart: +1 Punkt pro Gebäude in der größten zusammenhängenden Gruppe dieser
              Art.
            </li>
          )}
          {gameNo >= 3 && (
            <li>Brunnen: +4, wenn 4 Gebäude seitlich angrenzen (überbaut bringt er nichts).</li>
          )}
        </ul>
        <button className="primary big" onClick={onClose}>
          Verstanden
        </button>
      </div>
    </div>
  );
}

// ---------------- Spiel-Screen ----------------

function GameScreen({
  row,
  seat,
  onRoll,
  updateMe,
  onLeave,
}: {
  row: GameRow;
  seat: 1 | 2;
  onRoll: () => void;
  updateMe: (patch: Partial<PlayerState>) => Promise<void>;
  onLeave: () => void;
}) {
  const [showRules, setShowRules] = useState(false);
  const shared = row.shared;
  const board = useMemo(() => boardForGame(shared.gameNo), [shared.gameNo]);
  const me = seat === 1 ? row.p1! : row.p2!;
  const other = seat === 1 ? row.p2 : row.p1;
  const myTurnToRoll = shared.rollerSeat === seat && !shared.dice && !me.finished;
  const canAct = !!shared.dice && !me.finished && me.doneRound < shared.round;

  // Der Spieler zeichnet die Form selbst ein: Felder einzeln antippen.
  const [marked, setMarked] = useState<Cell[]>([]);

  // Bei neuem Wurf Auswahl zurücksetzen
  useEffect(() => {
    setMarked([]);
  }, [shared.round, shared.dice?.a, shared.dice?.b]);

  const targetCells = useMemo(
    () => (shared.dice ? combinedCells(shared.dice.a, shared.dice.b) : []),
    [shared.dice]
  );

  const occupied = useMemo(() => {
    const s = new Set<string>();
    me.placements.forEach((p) => p.cells.forEach(([r, c]) => s.add(r + ',' + c)));
    return s;
  }, [me.placements]);

  // Zeichnen per Tippen ODER Wischen: 'add' fügt Felder hinzu, 'remove'
  // (Start auf markiertem Feld) radiert entlang der Bewegung.
  function drawCell(r: number, c: number, mode: 'add' | 'remove') {
    const t = board.grid[r][c];
    const k = r + ',' + c;
    setMarked((prev) => {
      const idx = prev.findIndex(([pr, pc]) => pr === r && pc === c);
      if (mode === 'remove') {
        return idx >= 0 ? prev.filter((_, i) => i !== idx) : prev;
      }
      if (idx >= 0) return prev; // schon markiert
      if (occupied.has(k)) return prev;
      if (t === '~' || t === 'M' || t === 'F') return prev; // Fluss/Gebirge/Wald
      if (prev.length >= targetCells.length) return prev; // schon genug Felder
      return [...prev, [r, c] as Cell];
    });
  }

  const complete = marked.length === targetCells.length && targetCells.length > 0;
  const shapeOk = complete && shapesEqual(marked, targetCells);
  const validation = useMemo(
    () => (complete ? validatePlacement(board, me.placements, marked) : null),
    [complete, board, me.placements, marked]
  );
  const canConfirm = complete && shapeOk && (validation?.ok ?? false);

  const drawMessage = !complete
    ? marked.length === 0
      ? 'Zeichne die gewürfelte Form ein: tippe ' + targetCells.length + ' Felder an.'
      : 'Noch ' + (targetCells.length - marked.length) + ' Feld' +
        (targetCells.length - marked.length > 1 ? 'er' : '') + ' antippen …'
    : !shapeOk
      ? 'Das entspricht nicht der gewürfelten Form (drehen/spiegeln ist erlaubt).'
      : !validation?.ok
        ? validation?.reason ?? ''
        : 'Form korrekt – einzeichnen!';

  async function confirmPlace() {
    if (!canConfirm || !shared.dice) return;
    await updateMe({
      placements: [
        ...me.placements,
        { cells: marked, type: shared.dice.type, round: shared.round },
      ],
      doneRound: shared.round,
    });
    setMarked([]);
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
        <button className="icon-btn" onClick={() => setShowRules(true)} aria-label="Regeln">
          ⓘ
        </button>
        <span>Spiel {shared.gameNo}</span>
        <span>Runde {shared.round}</span>
        <span>Passen: {me.passes}/6</span>
        <button className="icon-btn" onClick={onLeave} aria-label="Verlassen">
          ✕
        </button>
      </header>
      {showRules && <RulesModal gameNo={shared.gameNo} onClose={() => setShowRules(false)} />}

      <div className="dice-area">
        {shared.dice ? (
          <DicePanel
            dice={shared.dice}
            rollKey={shared.round + '-' + shared.dice.a + '-' + shared.dice.b + '-' + shared.dice.type}
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
          marked.length > 0 && canAct
            ? { cells: marked, state: !complete ? 'partial' : canConfirm ? 'ok' : 'bad' }
            : null
        }
        onDrawCell={canAct ? drawCell : undefined}
      />

      {canAct && (
        <div className="controls">
          <p className={'draw-message' + (canConfirm ? ' ok' : complete ? ' bad' : '')}>
            {drawMessage}
          </p>
          <button className="primary big" disabled={!canConfirm} onClick={confirmPlace}>
            ✔ Einzeichnen
          </button>
          <div className="row-buttons">
            <button onClick={() => setMarked([])} disabled={marked.length === 0}>
              ↺ Zurücksetzen
            </button>
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
  onLeave,
}: {
  row: GameRow;
  seat: 1 | 2;
  onRestart: (gameNo: 1 | 2 | 3) => void;
  onLeave: () => void;
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
      <button className="big" onClick={onLeave}>
        Zur Startseite
      </button>
    </div>
  );
}
