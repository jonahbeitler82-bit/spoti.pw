# Obsidian Universe

Dein Obsidian-Vault als leuchtendes 3D-Universum: jeder Top-Level-Ordner ist eine Galaxie, jede Notiz ein
Stern, jeder `[[Wikilink]]` eine leuchtende Bahn. Mit Leertaste morpht alles in ein Gehirn. Läuft komplett
lokal im Browser, nichts verlässt deinen Rechner.

## Starten

```bash
cd obsidian-universe
npm install
npm run dev
```

Der Browser öffnet sich auf <http://localhost:5173>.

### Welcher Vault?

Ohne Einstellung sucht die App im iCloud-Ordner von Obsidian
(`~/Library/Mobile Documents/iCloud~md~obsidian/Documents`) und nimmt den zuletzt benutzten Vault.
Ein anderer Vault oder ein bestimmter aus mehreren: `vault.config.example.json` nach `vault.config.json`
kopieren und `vaultPath` setzen, dann neu starten.

```json
{ "vaultPath": "~/Library/Mobile Documents/iCloud~md~obsidian/Documents/MeinVault", "name": "Dein Vorname" }
```

`name` ist der Vorname für die Begrüßung. Fehlt er, fragt das Dashboard einmal danach („Set your name“).
Auch per Umgebungsvariable: `VAULT_PATH=… npm run dev`.

Wird kein Vault gefunden, legt die App einen Demo-Vault an (`demo-vault/`, ~120 verlinkte Notizen in
12 Ordnern) und zeigt einen Hinweis. `npm run demo` baut ihn neu.

## Was sie mit deinem Vault macht

- **Liest** alle `.md`-Dateien: Ordner, Titel, `[[Wikilinks]]` (auch Aliase und `[text](note.md)`),
  Erstellungsdatum (`created:`/`date:` im Frontmatter, sonst Dateiname bei Daily Notes, sonst Dateidatum)
  und `mood: 1–5` aus Daily Notes.
- **Schreibt nur an einer Stelle:** Das Capture-Feld hängt eine Zeile `- HH:mm Text` ans Ende der heutigen
  Daily Note an (Ordner, Format und Vorlage aus den Obsidian-Einstellungen „Daily notes“ bzw. „Periodic
  Notes“). Gibt es die Notiz noch nicht, wird sie angelegt. Bestehender Inhalt wird nie verändert.
- Der Server lauscht nur auf `localhost`; Schreibzugriffe nimmt er nur von der eigenen Seite an.

## Bedienung

| Taste | |
|---|---|
| Klick auf einen Stern | Vorschau der Notiz, mit Links und „Open in Obsidian“ |
| `Space` | Morph Galaxie ⇄ Gehirn (3 s) |
| `G` | Watch it grow: Timeline mit Play, Monat, Zähler und Scrubber |
| `R` | Aufnahme starten/stoppen (MP4 bzw. WebM, mit Labels, ohne UI) |
| `C` | Clean View, blendet die komplette UI aus |
| `⌘K` | Suche, fliegt zum Stern |
| `L` | Galaxie-Labels an/aus |
| `H` | Kamera zurücksetzen |
| `F` | FPS-Anzeige |
| `Esc` | Vorschau/Suche schließen, zurück zum Dashboard |

Farbschemata oben rechts: Neon, Aurora, Synthwave, Ember, Ice.

## Hinweise

- **iCloud:** Ist „Mac-Speicher optimieren“ an, liegen manche Notizen nur in der Cloud und fehlen, bis sie
  geladen sind. In Obsidian einmal öffnen oder im Finder „Jetzt laden“.
- **Erstellungsdatum:** iCloud setzt Dateidaten beim Sync manchmal neu. Für eine stimmige Timeline hilft
  ein `created: 2025-03-14` im Frontmatter (viele Vorlagen setzen das ohnehin).
- Technik: Vite, Three.js (Partikel mit eigenen Shadern, additives Blending, UnrealBloom), keine weiteren
  Laufzeit-Abhängigkeiten.
