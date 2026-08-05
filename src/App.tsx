import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import { boardForGame, isBuildable } from './game/board';
import {
  rollDice,
  combinedCells,
  shapesEqual,
  churchShapesFor,
  FORT_SHAPE,
  FORT_COUNT,
  DIE_B_FACES,
} from './game/dice';
import {
  scoreGame,
  targetCompletionRound,
  unsurroundedBandits,
  validatePlacement,
} from './game/rules';
import type { Cell, GameRow, HistoryEntry, PlayerState, SharedState } from './game/types';
import { BUILDING_LABEL, MAX_PASSES, chapterOf } from './game/types';
import BoardView from './components/BoardView';
import DicePanel from './components/DicePanel';
import MapEditor from './components/MapEditor';

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
  // Im Solo-Modus (kein zweiter Spieler) zählt nur Spieler 1.
  return done(p1) && (p2 ? done(p2) : true);
}

// ---------------- App ----------------

export default function App() {
  const [name, setName] = useState<string>(() => localStorage.getItem('mc:name') ?? '');
  const [row, setRow] = useState<GameRow | null>(null);
  const [seat, setSeat] = useState<1 | 2>(1);
  const [joinCode, setJoinCode] = useState<string>(
    () => new URLSearchParams(location.search).get('code')?.toUpperCase() ?? ''
  );
  const [soloMode, setSoloMode] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [error, setError] = useState<string>('');
  const rowRef = useRef<GameRow | null>(null);
  rowRef.current = row;

  useEffect(() => {
    localStorage.setItem('mc:name', name);
  }, [name]);

  // Laufendes Spiel dauerhaft merken (übersteht jeden Reload)
  useEffect(() => {
    if (row?.code) localStorage.setItem('mc:current', row.code);
  }, [row?.code]);

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

  // Nur updaten, wenn sich wirklich etwas geändert hat – verhindert
  // unnötige Re-Renders (Speicher/Akku auf dem Handy).
  const applyRow = useCallback((next: GameRow) => {
    setRow((prev) => {
      if (prev && JSON.stringify(prev) === JSON.stringify(next)) return prev;
      return next;
    });
  }, []);

  // ---- Sync: Realtime + Polling-Fallback ----
  useEffect(() => {
    if (!supabase || !row) return;
    const code = row.code;
    const channel = supabase
      .channel('game-' + code)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `code=eq.${code}` },
        (payload) => applyRow(payload.new as GameRow)
      )
      .subscribe();
    const poll = setInterval(async () => {
      if (document.hidden) return; // im Hintergrund nicht pollen
      const { data } = await supabase!.from('games').select('*').eq('code', code).single();
      if (data) applyRow(data as GameRow);
    }, 5000);
    return () => {
      supabase!.removeChannel(channel);
      clearInterval(poll);
    };
  }, [row?.code, applyRow]);

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
    const p2f = row.p2 ? row.p2.finished : true; // Solo: nur Spieler 1 zählt
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
    if (row.p1?.finished && (row.p2 ? row.p2.finished : true)) {
      persist({ shared: { ...row.shared, status: 'scoring', dice: null } });
    }
  }, [row, persist]);

  // ---- Aktionen ----

  async function createGame(gameNo: number, solo = false) {
    if (!supabase) return;
    setError('');
    const code = randomCode();
    const shared: SharedState = {
      status: solo ? 'playing' : 'lobby', // Solo startet sofort
      gameNo,
      round: solo ? 1 : 0,
      rollerSeat: 1,
      dice: null,
      churchesUsed: 0,
      solo,
    };
    const { data, error: err } = await supabase
      .from('games')
      .insert({ code, shared, p1: newPlayer(name || 'Spieler 1'), p2: null, history: [] })
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
    if (g.shared.solo) {
      setError('Das ist ein Solo-Spiel – Beitreten ist nicht möglich.');
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
    const dice = rollDice();
    const { gameNo, churchesUsed } = row.shared;
    const fortsUsed = row.shared.fortsUsed ?? 0;
    const isZirkel = DIE_B_FACES[dice.b].special === 'zirkel';
    const churches = churchShapesFor(gameNo);
    // Zirkel: Spiele 4-8 -> Kirche bauen; Spiele 11-12 -> Festung bauen.
    if (isZirkel && churches.length > 0 && churchesUsed < churches.length) {
      persist({
        shared: {
          ...row.shared,
          dice: { ...dice, church: churchesUsed },
          churchesUsed: churchesUsed + 1,
        },
      });
    } else if (isZirkel && (gameNo === 11 || gameNo === 12) && fortsUsed < FORT_COUNT) {
      persist({
        shared: {
          ...row.shared,
          dice: { ...dice, church: null, fort: true },
          fortsUsed: fortsUsed + 1,
        },
      });
    } else {
      persist({ shared: { ...row.shared, dice: { ...dice, church: null, fort: false } } });
    }
  }

  async function updateMe(patch: Partial<PlayerState>) {
    if (!row) return;
    const me = seat === 1 ? row.p1! : row.p2!;
    const updated = { ...me, ...patch };
    await persist(seat === 1 ? { p1: updated } : { p2: updated });
  }

  function restart(gameNo: number) {
    if (!row) return;
    // Ergebnis des beendeten Spiels in die Historie übernehmen (Zwischenstand)
    const prevNo = row.shared.gameNo;
    const players = [row.p1, row.p2];
    const boards = players.map((p) => (p ? boardForGame(prevNo, p.bandits) : null));
    const comps = players.map((p, i) =>
      p ? targetCompletionRound(boards[i]!, p, prevNo) : null
    );
    const isFirst = (i: number) =>
      comps[i] != null && comps.every((o, j) => j === i || o == null || comps[i]! <= o);
    const scores = players.map((p, i) =>
      p ? scoreGame(boards[i]!, p, prevNo, isFirst(i)) : null
    );
    const entry: HistoryEntry = {
      gameNo: prevNo,
      p1: scores[0]?.total ?? 0,
      p2: scores[1]?.total ?? 0,
      p1Bags: scores[0]?.bags ?? 0,
      p2Bags: scores[1]?.bags ?? 0,
    };
    // Banditen-Übertrag: Spiel 10 -> 11 und Spiel 11 -> 12
    const carry = (i: number) => {
      const p = players[i];
      if (!p) return undefined;
      if ((prevNo === 10 && gameNo === 11) || (prevNo === 11 && gameNo === 12)) {
        return unsurroundedBandits(boards[i]!, p);
      }
      return undefined;
    };
    persist({
      shared: {
        status: 'playing',
        gameNo,
        round: 1,
        rollerSeat: 1,
        dice: null,
        churchesUsed: 0,
        fortsUsed: 0,
        solo: row.shared.solo,
      },
      p1: row.p1 ? { ...newPlayer(row.p1.name), bandits: carry(0) } : null,
      p2: row.p2 ? { ...newPlayer(row.p2.name), bandits: carry(1) } : null,
      history: [...(row.history ?? []), entry],
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

  if (showEditor) {
    return <MapEditor onClose={() => setShowEditor(false)} />;
  }

  if (!row) {
    return (
      <div className="page">
        <h1 className="logo">My City</h1>
        <p className="tagline">Würfelspiel</p>
        <div className="card">
          <label>Dein Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        </div>
        <div className="card">
          <h2>Neues Spiel</h2>
          <div className="row-buttons">
            <button className={!soloMode ? 'primary' : ''} onClick={() => setSoloMode(false)}>
              👥 Zwei Spieler
            </button>
            <button className={soloMode ? 'primary' : ''} onClick={() => setSoloMode(true)}>
              🎲 Solo
            </button>
          </div>
          <p className="hint">Kapitel 1: Das neue Land</p>
          <div className="row-buttons">
            <button className="primary" onClick={() => createGame(1, soloMode)}>Spiel 1</button>
            <button onClick={() => createGame(2, soloMode)}>Spiel 2</button>
            <button onClick={() => createGame(3, soloMode)}>Spiel 3</button>
          </div>
          <p className="hint">Kapitel 2: Die Kirchen</p>
          <div className="row-buttons">
            <button onClick={() => createGame(4, soloMode)}>Spiel 4</button>
            <button onClick={() => createGame(5, soloMode)}>Spiel 5</button>
            <button onClick={() => createGame(6, soloMode)}>Spiel 6</button>
          </div>
          <p className="hint">Kapitel 3: Herausforderungen</p>
          <div className="row-buttons">
            <button onClick={() => createGame(7, soloMode)}>Spiel 7</button>
            <button onClick={() => createGame(8, soloMode)}>Spiel 8</button>
            <button onClick={() => createGame(9, soloMode)}>Spiel 9</button>
          </div>
          <p className="hint">Kapitel 4: Banditen</p>
          <div className="row-buttons">
            <button onClick={() => createGame(10, soloMode)}>Spiel 10</button>
            <button onClick={() => createGame(11, soloMode)}>Spiel 11</button>
            <button onClick={() => createGame(12, soloMode)}>Spiel 12</button>
          </div>
          {soloMode && (
            <p className="hint">Solo: du spielst allein und wirst am Ende über die Erfolgstabelle bewertet.</p>
          )}
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
        <p className="center">
          <button onClick={() => setShowEditor(true)}>🛠 Karten-Editor</button>
        </p>
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

const GAME_STORY: Record<number, string> = {
  1: 'Als erste Siedler habt ihr das neue Land erreicht und errichtet eure Gebäude entlang des Flusses.',
  2: 'Eure Gemeinde einigt sich auf ein geplantes Vorgehen – nun entstehen geordnete Stadtviertel.',
  3: 'Um die Wasserversorgung zu verbessern, wird im Osten ein Brunnen gebohrt, von dem möglichst viele Gebäude profitieren sollen.',
  4: 'Mit immer mehr Siedlern kommt auch die Kirche in eure Gemeinde. Die Kirchenbauer haben genaue Vorstellungen, welche Bauten entstehen sollen.',
  5: 'Die Kirchen gewinnen an Einfluss – alle Siedlergruppen suchen die Nähe zu den Kirchen, um gehört zu werden.',
  6: 'Die Kirchen fordern immer mehr Land. Auch andere Gruppen beanspruchen einen Teil des knappen Baulands.',
  7: 'Starker Regen lässt den Fluss über die Ufer treten. Sicherheit bieten die Hochebenen am Gebirge und das Sägewerk am Wald.',
  8: 'Nach der Überschwemmung erschließt ihr die Waldgebiete, um Bauland für den Wiederaufbau zu gewinnen.',
  9: 'Gold! Am Rand des Siedlungsgebietes wird Gold gefunden – der Run beginnt …',
  10: 'Der Goldrausch lockt Banditen an. Um die Sicherheit eurer Stadt zu erhalten, müsst ihr sie umzingeln!',
  11: 'Die Banditen bedrohen eure Stadt. Ihr errichtet über das Land verteilt Festungen, um sie in die Enge zu treiben.',
  12: 'Noch immer sind Banditen in der Stadt. Dennoch stellt ihr die Weichen für eine erfolgreiche Zukunft.',
};

const GAME_EXTRA_RULES: Record<number, string[]> = {
  7: [
    'Am Sägewerk beginnen: das erste Gebäude grenzt an das Sägewerk.',
    'Breite Flussfelder: nicht bebaubar; Gebäude gegenüber gelten dort NICHT als angrenzend.',
    'Hochebenen: Wer zuerst alle 4 überbaut: +5 Punkte. Am Ende alle überbaut: 1 💰. Leer: −1.',
    'Kapitel 3: Wer im ganzen Spiel nicht passt, erhält 1 💰.',
  ],
  8: [
    'Am Sägewerk beginnen.',
    'Waldfelder dürfen jetzt überbaut werden! Wer zuerst alle überbaut: +5. Am Ende alle: 1 💰. Leerer Wald: −1.',
    'Kapitel 3: Wer im ganzen Spiel nicht passt, erhält 1 💰.',
  ],
  9: [
    'Am Sägewerk beginnen. Wald weiterhin bebaubar.',
    'Goldfelder: Wer zuerst alle 5 überbaut: +5. Am Ende alle: 2 💰. Leer: KEIN Abzug.',
    'Der Zirkel hat in diesem Spiel keine Bedeutung.',
    'Kapitel 3: Wer im ganzen Spiel nicht passt, erhält 1 💰.',
  ],
  10: [
    'Banditen können nicht überbaut werden – umzingelt sie (Gebäude an allen 4 Seiten)!',
    'Jeder nicht umzingelte Bandit: −3 Punkte, und er wandert mit ins nächste Spiel.',
  ],
  11: [
    'Zirkel = Festung: MUSS auf einem beliebigen freien Feld gebaut werden (keine Angrenzung nötig). Von Festungen aus darf weitergebaut werden.',
    'Vollständige Gruppe einer Gebäudeart (alle Gebäude der Art zusammenhängend): +3.',
    'Nicht umzingelte Banditen: −3, Übertrag ins nächste Spiel.',
  ],
  12: [
    'An einer beliebigen gedruckten Festung beginnen.',
    'Bonuswertungen: nie gepasst +6 · alle Bäume erhalten +20 · alle Steine überbaut +6 · kein leeres Feld +12.',
    'Vollständige Gruppen: je +6. Nicht umzingelte Banditen: je −6.',
  ],
};

function RulesModal({ gameNo, onClose }: { gameNo: number; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          Kapitel {chapterOf(gameNo)} · Spiel {gameNo}
        </h2>
        <p className="story">
          <i>{GAME_STORY[gameNo]}</i>
        </p>
        <h3>Bauregeln</h3>
        <ul>
          {(GAME_EXTRA_RULES[gameNo] ?? []).map((rule, i) => (
            <li key={'x' + i}>
              <b>{rule}</b>
            </li>
          ))}
          {gameNo === 6 ? (
            <li>
              <b>An der Kirche beginnen:</b> Das erste Gebäude muss an die gedruckte Kirche
              angrenzen.
            </li>
          ) : gameNo >= 7 && gameNo <= 9 ? null : gameNo === 12 ? null : (
            <li>Das erste Gebäude muss mit einer Seite an den Fluss angrenzen.</li>
          )}
          <li>Jedes weitere Gebäude muss an ein vorhandenes angrenzen (auch über den Fluss hinweg).</li>
          <li>Nicht über den Fluss bauen; Gebirge und Wald sind gesperrt.</li>
          <li>Bäume und Steine dürfen überbaut werden.</li>
          {gameNo === 6 ? (
            <li>
              <b>Passen ist nicht möglich!</b> Kannst oder willst du nicht bauen, musst du dein
              Spiel beenden.
            </li>
          ) : (
            <li>Passen kostet: −1 / −2 / −3 / −5 / −7 / −10 (max. 6-mal).</li>
          )}
          {gameNo >= 4 && gameNo <= 8 && (
            <>
              <li>
                <b>Kirchen:</b> Wird der Zirkel gewürfelt, bauen alle die nächste Kirche aus der
                Reihe (statt des normalen Gebäudes). Kirchen sind mit ◯ markiert.
              </li>
              {gameNo !== 6 && (
                <li>Wer beim Kirchenbau passt, malt ZWEI Kreise in „Gebäude nicht bauen“ aus.</li>
              )}
            </>
          )}
          <li>Nach jedem Wurf darfst du dein Spiel freiwillig beenden.</li>
        </ul>
        <h3>Wertung</h3>
        <ul>
          <li>Jeder freie Baum: +1 (Doppelbaum-Feld: +2)</li>
          <li>Jedes nicht überbaute Steinfeld: −1</li>
          <li>Jedes leere Feld: −1</li>
          {gameNo >= 2 && (
            <li>
              Je Gebäudeart: +1 Punkt pro Gebäude in der größten zusammenhängenden Gruppe dieser
              Art (Kirchen zählen zu keiner Art).
            </li>
          )}
          {(gameNo === 3 || gameNo === 5 || gameNo === 6) && (
            <li>
              Brunnen: +4 je Brunnen, wenn 4 Gebäude seitlich angrenzen (überbaut bringt er
              nichts).
            </li>
          )}
          {(gameNo === 5 || gameNo === 6) && (
            <li>
              Kirchenpunkte: +3 je Kirche, an die Gebäude aller 3 Gebäudearten angrenzen.
            </li>
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
  const me = seat === 1 ? row.p1! : row.p2!;
  const other = seat === 1 ? row.p2 : row.p1;
  const board = useMemo(
    () => boardForGame(shared.gameNo, me.bandits),
    [shared.gameNo, JSON.stringify(me.bandits ?? [])]
  );
  const otherBoard = useMemo(
    () => boardForGame(shared.gameNo, other?.bandits),
    [shared.gameNo, JSON.stringify(other?.bandits ?? [])]
  );
  const myTurnToRoll = shared.rollerSeat === seat && !shared.dice && !me.finished;
  const canAct = !!shared.dice && !me.finished && me.doneRound < shared.round;

  // Der Spieler zeichnet die Form selbst ein: Felder einzeln antippen.
  const [marked, setMarked] = useState<Cell[]>([]);

  // Bei neuem Wurf Auswahl zurücksetzen
  useEffect(() => {
    setMarked([]);
  }, [shared.round, shared.dice?.a, shared.dice?.b]);

  const isChurchRound = shared.dice?.church != null;
  const isFortRound = !!shared.dice?.fort;
  const targetCells = useMemo(() => {
    if (!shared.dice) return [];
    if (shared.dice.church != null) return churchShapesFor(shared.gameNo)[shared.dice.church];
    if (shared.dice.fort) return FORT_SHAPE;
    return combinedCells(shared.dice.a, shared.dice.b);
  }, [shared.dice, shared.gameNo]);

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
      if (!isBuildable(t, board.forestBuildable)) return prev; // gesperrte Felder
      if (prev.length >= targetCells.length) return prev; // schon genug Felder
      return [...prev, [r, c] as Cell];
    });
  }

  const complete = marked.length === targetCells.length && targetCells.length > 0;
  const shapeOk = complete && shapesEqual(marked, targetCells);
  const validation = useMemo(
    () =>
      complete
        ? validatePlacement(board, me.placements, marked, { freePlacement: isFortRound })
        : null,
    [complete, board, me.placements, marked, isFortRound]
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
        {
          cells: marked,
          type: isFortRound ? 'festung' : isChurchRound ? 'kirche' : shared.dice.type,
          round: shared.round,
        },
      ],
      doneRound: shared.round,
    });
    setMarked([]);
  }

  // Beim Bau einer Kirche kostet Passen ZWEI Kreise; in Spiel 6 ist Passen
  // verboten; Festungen MÜSSEN gebaut werden.
  const passCost = isChurchRound ? 2 : 1;
  const canPass = shared.gameNo !== 6 && !isFortRound && me.passes + passCost <= MAX_PASSES;

  async function doPass() {
    if (!canPass) return;
    const msg = isChurchRound
      ? 'Kirche nicht bauen? Das kostet ZWEI Kreise in „Gebäude nicht bauen“.'
      : 'Wirklich passen? (Kreis ' + (me.passes + 1) + ' von 6 wird ausgemalt)';
    if (!confirm(msg)) return;
    await updateMe({ passes: me.passes + passCost, doneRound: shared.round });
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
        <span>
          Kap. {chapterOf(shared.gameNo)} · Spiel {shared.gameNo}
        </span>
        <span className="code-badge" title="Spiel-Code zum Wiedereinstieg">
          ⌗ {row.code}
        </span>
        <span>Runde {shared.round}</span>
        <span>Passen: {me.passes}/6</span>
        <button className="icon-btn" onClick={onLeave} aria-label="Verlassen">
          ✕
        </button>
      </header>
      {showRules && <RulesModal gameNo={shared.gameNo} onClose={() => setShowRules(false)} />}

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

      <div className="dice-area">
        {shared.dice ? (
          <DicePanel
            dice={shared.dice}
            gameNo={shared.gameNo}
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
            {shared.gameNo !== 6 && !isFortRound && (
              <button onClick={doPass} disabled={!canPass}>
                Passen ({me.passes}/6{isChurchRound ? ' · ×2' : ''})
              </button>
            )}
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
          <BoardView board={otherBoard} placements={other.placements} small />
        </div>
      )}
    </div>
  );
}

// Erfolgstabelle für das Solo-Spiel (laut Anleitung, je Kapitel andere Grenzen)
const RANK_TITLES = [
  'Ehrenbürger/in',
  'Bürgermeister/in',
  'Gemeinderat/-rätin',
  'Bauinspektor/in',
  'Meister/in',
  'Geselle/Gesellin',
  'Hilfskraft',
  'Einsiedler/in',
];
const RANK_MINS: Record<number, number[]> = {
  1: [70, 60, 50, 42, 34, 26, 18, 10],
  2: [70, 60, 50, 42, 34, 26, 18, 10],
  3: [80, 70, 60, 52, 44, 36, 28, 20],
  4: [120, 105, 90, 80, 70, 60, 50, 40],
};

function soloRank(points: number, chapter: number): string {
  const mins = RANK_MINS[chapter] ?? RANK_MINS[1];
  for (let i = 0; i < mins.length; i++) if (points >= mins[i]) return RANK_TITLES[i];
  return 'Landstreicher/in';
}

// ---------------- Zwischenstand (Kapitel-Gesamtrechnung) ----------------

function Zwischenstand({
  row,
  currentTotals,
  currentBags,
}: {
  row: GameRow;
  currentTotals: number[];
  currentBags: number[];
}) {
  const hasP2 = !!row.p2;
  const entries: HistoryEntry[] = [
    ...(row.history ?? []),
    {
      gameNo: row.shared.gameNo,
      p1: currentTotals[0] ?? 0,
      p2: currentTotals[1] ?? 0,
      p1Bags: currentBags[0] ?? 0,
      p2Bags: currentBags[1] ?? 0,
    },
  ];
  // Kapitel-3-Bonus: meiste Geldbeutel +20, zweitmeiste +10
  const ch3 = entries.filter((e) => chapterOf(e.gameNo) === 3);
  const bags1 = ch3.reduce((a, e) => a + (e.p1Bags ?? 0), 0);
  const bags2 = ch3.reduce((a, e) => a + (e.p2Bags ?? 0), 0);
  let bagBonus: [number, number] = [0, 0];
  if (ch3.length > 0) {
    if (!hasP2) {
      bagBonus = [bags1 >= 7 ? 20 : bags1 === 6 ? 10 : 0, 0];
    } else if (bags1 === bags2) {
      bagBonus = [20, 20];
    } else {
      bagBonus = bags1 > bags2 ? [20, 10] : [10, 20];
    }
  }
  const names = [row.p1?.name ?? 'Spieler 1', row.p2?.name ?? 'Spieler 2'];
  const chapters = [...new Set(entries.map((e) => chapterOf(e.gameNo)))].sort();

  const sum = (list: HistoryEntry[]) => [
    list.reduce((a, e) => a + e.p1, 0),
    list.reduce((a, e) => a + e.p2, 0),
  ];
  const [totalP1, totalP2] = [sum(entries)[0] + bagBonus[0], sum(entries)[1] + bagBonus[1]];

  return (
    <div className="card">
      <h2>Zwischenstand</h2>
      <table className="score-table">
        <thead>
          <tr>
            <th></th>
            <th>{names[0]}</th>
            {hasP2 && <th>{names[1]}</th>}
          </tr>
        </thead>
        <tbody>
          {chapters.map((ch) => {
            const inChapter = entries.filter((e) => chapterOf(e.gameNo) === ch);
            const [c1, c2] = sum(inChapter);
            const bonus: [number, number] = ch === 3 ? bagBonus : [0, 0];
            return (
              <FragmentRows
                key={ch}
                chapter={ch}
                entries={inChapter}
                chapterSum={[c1 + bonus[0], c2 + bonus[1]]}
                bags={ch === 3 ? [bags1, bags2] : null}
                bagBonus={ch === 3 ? bonus : null}
                hasP2={hasP2}
              />
            );
          })}
          <tr className="total-row">
            <td>Gesamt</td>
            <td>
              <b>{totalP1}</b>
            </td>
            {hasP2 && (
              <td>
                <b>{totalP2}</b>
              </td>
            )}
          </tr>
        </tbody>
      </table>
      <p className="hint">
        Der Zwischenstand wird fortgeschrieben, wenn ihr über „Weiterspielen“ das nächste Spiel
        startet.
      </p>
    </div>
  );
}

function FragmentRows({
  chapter,
  entries,
  chapterSum,
  bags,
  bagBonus,
  hasP2,
}: {
  chapter: number;
  entries: HistoryEntry[];
  chapterSum: number[];
  bags: number[] | null;
  bagBonus: number[] | null;
  hasP2: boolean;
}) {
  return (
    <>
      {entries.map((e, i) => (
        <tr key={chapter + '-' + i}>
          <td>Spiel {e.gameNo}</td>
          <td>{e.p1}</td>
          {hasP2 && <td>{e.p2}</td>}
        </tr>
      ))}
      {bags && bagBonus && (
        <tr>
          <td>Geldbeutel-Bonus ({bags[0]}{hasP2 ? ' / ' + bags[1] : ''} 💰)</td>
          <td>+{bagBonus[0]}</td>
          {hasP2 && <td>+{bagBonus[1]}</td>}
        </tr>
      )}
      <tr className="chapter-row">
        <td>Kapitel {chapter} gesamt</td>
        <td>
          <b>{chapterSum[0]}</b>
        </td>
        {hasP2 && (
          <td>
            <b>{chapterSum[1]}</b>
          </td>
        )}
      </tr>
    </>
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
  onRestart: (gameNo: number) => void;
  onLeave: () => void;
}) {
  const gameNo = row.shared.gameNo;
  const players = [row.p1, row.p2].filter(Boolean) as PlayerState[];
  const boards = players.map((p) => boardForGame(gameNo, p.bandits));
  const comps = players.map((p, i) => targetCompletionRound(boards[i], p, gameNo));
  const isFirst = (i: number) =>
    comps[i] != null && comps.every((o, j) => j === i || o == null || comps[i]! <= o);
  const scores = players.map((p, i) => scoreGame(boards[i], p, gameNo, isFirst(i)));
  const isSolo = players.length === 1;

  // Solo: Bewertung über die Erfolgstabelle der Anleitung (Kapitelsumme)
  const chapterNo = chapterOf(gameNo);
  const chapterEntries = (row.history ?? []).filter((e) => chapterOf(e.gameNo) === chapterNo);
  let chapterTotal = chapterEntries.reduce((a, e) => a + e.p1, 0) + (scores[0]?.total ?? 0);
  if (isSolo && chapterNo === 3) {
    const bagsTotal =
      chapterEntries.reduce((a, e) => a + (e.p1Bags ?? 0), 0) + (scores[0]?.bags ?? 0);
    chapterTotal += bagsTotal >= 7 ? 20 : bagsTotal === 6 ? 10 : 0;
  }
  const winner = isSolo
    ? `Kapitel ${chapterNo}: ${chapterTotal} Punkte – „${soloRank(chapterTotal, chapterNo)}“`
    : scores[0].total === scores[1].total
      ? 'Unentschieden!'
      : scores[0].total > scores[1].total
        ? `${players[0].name} gewinnt!`
        : `${players[1].name} gewinnt!`;
  const targetLabel =
    gameNo === 7 ? 'Hochebenen zuerst +5' : gameNo === 8 ? 'Wald zuerst +5' : 'Gold zuerst +5';

  return (
    <div className="page">
      <h1>Wertung – Spiel {row.shared.gameNo}</h1>
      <p className="center hint" style={{ marginTop: -6 }}>
        Spiel-Code: <b>{row.code}</b>
      </p>
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
              <td key={i}>{s.stonePoints > 0 ? '+' + s.stonePoints : s.stonePoints}</td>
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
          {scores[0]?.wellPoints != null && (
            <tr>
              <td>Brunnen</td>
              {scores.map((s, i) => (
                <td key={i}>+{s.wellPoints ?? 0}</td>
              ))}
            </tr>
          )}
          {scores[0]?.churchPoints != null && (
            <tr>
              <td>Kirchen +3</td>
              {scores.map((s, i) => (
                <td key={i}>+{s.churchPoints ?? 0}</td>
              ))}
            </tr>
          )}
          {scores[0]?.targetBonus != null && (
            <tr>
              <td>{targetLabel}</td>
              {scores.map((s, i) => (
                <td key={i}>+{s.targetBonus ?? 0}</td>
              ))}
            </tr>
          )}
          {scores[0]?.banditPoints != null && (
            <tr>
              <td>Nicht umzingelte Banditen</td>
              {scores.map((s, i) => (
                <td key={i}>{s.banditPoints ?? 0}</td>
              ))}
            </tr>
          )}
          {scores[0]?.fullGroupPoints != null && (
            <tr>
              <td>Vollständige Gruppen</td>
              {scores.map((s, i) => (
                <td key={i}>+{s.fullGroupPoints ?? 0}</td>
              ))}
            </tr>
          )}
          {chapterNo === 3 && (
            <tr>
              <td>Geldbeutel (dieses Spiel)</td>
              {scores.map((s, i) => (
                <td key={i}>{'💰'.repeat(s.bags) || '–'}</td>
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

      <Zwischenstand
        row={row}
        currentTotals={scores.map((s) => s.total)}
        currentBags={scores.map((s) => s.bags)}
      />


      <div className="boards-final">
        {players.map((p, i) => (
          <div key={p.name}>
            <h3>{p.name}</h3>
            <BoardView board={boards[i]} placements={p.placements} small />
          </div>
        ))}
      </div>

      {seat === 1 && (
        <div className="card">
          <h2>Weiterspielen</h2>
          {gameNo < 12 && (
            <button className="primary big" onClick={() => onRestart(gameNo + 1)}>
              Weiter zu Spiel {gameNo + 1}
            </button>
          )}
          <div className="row-buttons">
            {[1, 2, 3, 4, 5, 6].map((g) => (
              <button key={g} onClick={() => onRestart(g)}>{g}</button>
            ))}
          </div>
          <div className="row-buttons">
            {[7, 8, 9, 10, 11, 12].map((g) => (
              <button key={g} onClick={() => onRestart(g)}>{g}</button>
            ))}
          </div>
        </div>
      )}
      <button className="big" onClick={onLeave}>
        Zur Startseite
      </button>
    </div>
  );
}
