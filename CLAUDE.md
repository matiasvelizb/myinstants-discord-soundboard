# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start            # run the bot (reads .env if present)
npm run dev          # same, with --watch
docker compose up -d --build   # bot + flaresolverr
docker compose logs -f bot
node --check <file>  # syntax check; there is no linter, test suite or build step
```

Requires Node 24+ (uses the built-in `node:sqlite`) and `ffmpeg` on `PATH` when running outside Docker.

Inspecting state while running:
```bash
sqlite3 data/soundboard.db 'SELECT guild_id, title, play_count FROM sounds ORDER BY play_count DESC LIMIT 10;'
ls data/audio            # one .mp3 per sha1(sound_url)
tail -f logs/soundboard-$(date +%F).log
```

## Architecture

Discord soundboard bot. A sound is a MyInstants page that has been scraped, downloaded once and saved per guild; afterwards playback is local and never touches the network. It also reads text aloud (`/read`).

**Wiring** — `src/index.js` constructs everything (plain constructor injection, no DI container) and is also the single interaction router. There is no command/handler auto-discovery: adding a command means adding it to the `commands` map and to the `registerCommands([...])` array. Commands expose a `static get definition()` so registration does not need instances.

**Data flow of `/play`** — `PlayCommand.resolveSound` turns the option value into a sound row: `saved:<id>` from autocomplete, a myinstants.com link, or free text (guild search first, then a live MyInstants search). Anything new goes through `addFromMyInstants`: scrape → download (before the DB write, so unfetchable sounds never enter the library) → `SoundRepository.add` → refresh open soundboards. Playback itself always goes through `AudioService.play`, which resolves the file via `AudioStore`, plays it and increments `play_count`.

**Text to speech** (`src/tts/`) — `/read` cleans the text, `TtsService.synthesize` returns the audio as a Buffer (nothing is written to disk) and `VoiceService.read` plays or queues it. `voices.js` is the single voice catalog, a static list of the Edge Spanish voices. `EdgeTtsProvider` uses the unofficial Edge endpoint through msedge-tts, one client per request (the library cannot switch voices on a used instance) and XML-escapes the text because it is embedded in SSML. Each user's default voice lives in `user_voices`; `/voice` sets it, and an id that is no longer in the catalog falls back to `config.tts.defaultVoice`.

**Playback queue** (`VoiceService`) — every item is an `sfx` (soundboard) or a `read`. Sounds interrupt sounds. A read is never interrupted: sounds that arrive during a read go to `sfxQueue`, reads that arrive while anything plays go to `readQueue`, and when the player goes idle `advance` takes sounds first. `halt` empties both queues before stopping the player, because `player.stop` emits Idle synchronously and would otherwise start the next item.

**Storage** (`src/database/`) — `db.js` opens SQLite (WAL) and creates the schema on boot; `SoundRepository` is fully synchronous; `AudioStore` keeps audio as `data/audio/<sha1(sound_url)>.mp3`, shared across guilds. Because files are shared, deleting a sound must go through `AudioService.releaseAudio`, which only unlinks when no guild references that URL.

**Scraping** (`src/myinstants/`) — `HttpClient` wraps impit (Chrome TLS fingerprint); plain HTTP clients get 403 from Cloudflare. On a 403/429/503 `ScraperService` retries through `FlareSolverrClient` (headless Chrome, separate container) and reuses its clearance cookies for binary downloads, which FlareSolverr cannot proxy. `ScraperService.search` deliberately skips the FlareSolverr fallback because autocomplete must answer fast.

**UI** (`src/discord/`) — `builders/SoundboardView.js` is the only place that builds messages, using Components V2 (`MessageFlags.IsComponentsV2`, so no `content`/`embeds` on those messages). `DashboardService` renders, tracks public boards per guild and re-renders them when the library changes; delete boards are ephemeral and therefore not tracked.

## Constraints to respect

- **40 components per message, nested included.** A full soundboard page is 39: container + header + 5 rows x (row + 5 buttons) + separator + nav row. Adding anything to the layout means cutting elsewhere.
- **Custom IDs are the state.** Format `sb:<action>:<args>` (`sb:play:<id>:<sort>:<page>`, `sb:nav:<mode>:<sort>:<page>:<tag>`), max 100 chars, and must be unique within a message — that is what the nav tag is for. `index.js` splits on `:`, so no `:` in values.
- **Autocomplete must respond within 3 s** and to at most 25 choices with names and values of at most 100 chars; the MyInstants search is raced against a 2 s timer and falls back to guild-local results.
- **Validate MyInstants URLs with `ScraperService.toMyInstantsUrl`**, never a substring check — it parses the URL and verifies the hostname for both pages and audio files.
- **Voice autocomplete is local only** (`voiceChoices` in `src/tts/voices.js`), no network.
- **`Logger.activity(action, status, interaction, details)`** writes the user-facing log line (PLAY/ADD/DELETE/STOP/READ/VOICE, OK/ERROR/SKIP); `Logger.debug` is console-only. Keep new user actions logged through `activity`.
- Errors from an interaction bubble up to the router in `index.js`, which replies once; commands should not add their own catch-all.
