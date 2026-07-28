# My City – Würfelspiel (Web-App, 2 Spieler live)

Zweispieler-Webapp angelehnt an *My City Roll & Write* (Kapitel 1, Spiele 1–3).
Wie im Original gilt ein Würfelwurf für beide: Abwechselnd würfelt eine Person,
dann zeichnen beide dieselbe Gebäudeform auf ihr eigenes Spielfeld ein.
Live-Sync über Supabase Realtime, Hosting über Vercel.

## Features

- Spiel erstellen → 4-stelliger Code / Link zum Beitreten
- 3 Würfel wie im Original: kombinierte Gebäudeform (9 Formen mit
  Original-Wahrscheinlichkeiten) + Gebäudeart (ausgemalt / schraffiert / gekreuzt)
- Platzieren per Tippen, Drehen und Spiegeln
- Alle Grundregeln: am Fluss beginnen, angrenzend bauen, nicht über den Fluss,
  Gebirge/Wald gesperrt, Passen (max. 6, mit Strafpunkten −1/−2/−3/−5/−7/−10),
  Spiel für sich beenden
- Wertung Spiel 1 (Baum +1, Stein −1, leeres Feld −1),
  Spiel 2 (+ größte Gruppe je Gebäudeart), Spiel 3 (+ Brunnen +4)
- Gegner-Spielfeld live sichtbar

## Setup (~10 Minuten)

### 1. Supabase

1. Auf [supabase.com](https://supabase.com) ein kostenloses Projekt anlegen.
2. Im Dashboard: **SQL Editor** → Inhalt von `supabase/schema.sql` einfügen → **Run**.
3. Unter **Settings → API** kopieren: *Project URL* und *anon public key*.

### 2. Lokal testen

```bash
npm install
cp .env.example .env    # URL und Anon-Key eintragen
npm run dev
```

### 3. Vercel-Deploy

1. Projekt in ein GitHub-Repo pushen.
2. Auf [vercel.com](https://vercel.com): **Add New → Project** → Repo importieren
   (Framework: Vite, wird automatisch erkannt).
3. Unter **Environment Variables** eintragen:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. **Deploy** – fertig. Die URL aufs Handy schicken, Spiel erstellen, Code teilen.

## Spielfeld anpassen

Das Spielfeld ist nach Fotos des Originalblatts rekonstruiert und liegt als
einfaches Text-Raster in `src/game/board.ts` (Legende im Dateikopf).
Einzelne Felder (Baum, Stein, Fluss, …) lassen sich dort direkt ändern.

## Roadmap

- Exaktes Nachziehen der Blätter Spiel 2 + 3 (eigene Layouts, Brunnen-Position)
- Kapitel-Gesamtwertung (Spiel 1+2+3)
- Kapitel 2–4 (Kirchen, Geldbeutel, Banditen, Festungen)
