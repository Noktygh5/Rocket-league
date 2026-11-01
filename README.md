# TURBOBALL

A browser-based rocket-powered car soccer game. Drive the **Striker**, boost, jump, flip, wall-ride and
hit a giant ball into the other team's goal. Play offline against a bot (Easy / Medium / Hard) or online
with friends in private rooms (1v1 or 2v2).

- TypeScript monorepo (npm workspaces): `shared` (deterministic physics + bots + netcode logic),
  `client` (Vite + Three.js), `server` (Node + `ws`, authoritative).
- Physics is custom and runs at a fixed 120 Hz, identical on client, server and bots.
- All art and sound are procedural. No asset files.

## Quick start (local)

```bash
npm install
npm run dev          # starts the game server (:8080) and the client (:5173) together
```

Open <http://localhost:5173>.

| Command | What it does |
| --- | --- |
| `npm run dev` | server + client with hot reload |
| `npm test` | Vitest suite for `/shared` (physics, arena, car, collisions, match flow, bots, netcode) |
| `npm run build` | type-check and build everything |
| `npm run typecheck` | type-check all workspaces |
| `npm run ladder` | 50 bot-vs-bot matches per pairing; proves Hard > Medium > Easy |
| `npm run tuning-doc` | regenerate `TUNING.md` from `shared/src/constants.ts` |
| `npm run start:all` | build the client and serve it from the Node server (single host) |

## Controls (rebindable in Settings)

| Key | Action |
| --- | --- |
| W / S | throttle / reverse (ground), pitch down / up (air) |
| A / D | steer (ground), yaw (air) |
| Space | jump; press again in the air for a double jump, or hold a direction to flip |
| Left Shift | boost |
| C | powerslide |
| Q / E | air roll left / right |
| F | ball cam on / off |
| Right mouse (hold) | rear view |
| Tab (hold) | scoreboard |
| Esc | pause (offline) / menu |
| Backspace or R | skip replay |

## Testing multiplayer locally with two tabs

1. `npm run dev`
2. Tab 1: open <http://localhost:5173>, **Play Online → 1 v 1** (or 2 v 2). Note the 5-letter room code.
3. Tab 2: open the invite link `http://localhost:5173/?room=ABCDE` (or **Play Online**, type the code, **Join**).
4. Tab 2 presses **Ready**, tab 1 (host) presses **Start match**.
5. For 2v2 open four tabs; players pick teams in the lobby.

Simulate bad networks by adding query parameters: `http://localhost:5173/?lag=100&jitter=20&loss=2`
(round-trip latency in ms, jitter in ms, loss in % of game packets), or use the sliders in the dev panel
(`?dev` or F2). The game stays playable at 100 ms with 2% loss.

## Deployment

### Option A: Vercel (client) + Fly.io (server)

**1. Server on Fly.io**

```bash
brew install flyctl        # or see https://fly.io/docs/flyctl/install/
fly auth login
# from the repository root
fly launch --no-deploy --copy-config --name turboball-server     # accept fly.toml, no database
fly deploy
```

`fly.toml` builds `server/Dockerfile` and exposes `/health`. Edit `ALLOWED_ORIGINS` in `fly.toml` (or
`fly secrets set ALLOWED_ORIGINS=https://your-app.vercel.app`) to your Vercel URL so only your site can
open game sockets. Your server URL is `wss://turboball-server.fly.dev`.

**2. Client on Vercel**

```bash
cd client
npx vercel            # first run: link the project, set the root directory to `client`
npx vercel env add VITE_SERVER_URL production      # value: wss://turboball-server.fly.dev
npx vercel --prod
```

(Or import the repo in the Vercel dashboard, set **Root Directory** to `client`, add the
`VITE_SERVER_URL` environment variable, and deploy.) `client/vercel.json` is included. Because the
client imports `@turboball/shared`, keep the repository root as the install location: in the Vercel
project settings enable *"Include source files outside of the Root Directory in the Build Step"*.

**3. Check it**

Open your Vercel URL, **Play Online**, create a room, send the link to a friend.

### Option B: single host (simplest, good for friends)

```bash
npm run start:all     # builds the client, then serves it and the game sockets from :8080
```

Put that behind any host that gives you TLS (Fly, Railway, Render) and share the URL.
The client automatically uses the page's own origin for WebSocket traffic.

### Railway / Render

Both can deploy `server/Dockerfile` directly (build context: repository root, Dockerfile path
`server/Dockerfile`). Set `PORT` if the platform does not (the server reads `PORT`), and set
`ALLOWED_ORIGINS`. Health check path: `/health`.

### Free-tier caveats

- Free/auto-stop instances **sleep when idle**. The first connection after a sleep can take 10-30 s;
  the client shows "Could not reach the server… try again" after 12 s. Fly is configured with
  `auto_start_machines = true`, so a retry usually succeeds.
- Free CPU is shared: 2v2 at 120 Hz is fine, but expect jitter if the host is overloaded.
- Rooms live in server memory and vanish on restart or redeploy.
- Pick a server region near your players; ping is shown in the HUD (Settings → Show ping).

## Configuration

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SERVER_URL` | client build | `wss://` URL of the game server (omit for same-origin / local dev) |
| `PORT` | server | listen port (default 8080) |
| `ALLOWED_ORIGINS` | server | comma-separated allowed WebSocket origins (empty = allow all, dev only) |
| `STATIC_DIR` | server | serve a built client from this directory (single-host mode) |
| `MAX_ROOMS`, `MAX_CONNECTIONS` | server | abuse limits (defaults 100 / 400) |

## Project layout

```
shared/   physics (arena SDF, ball, car, collisions, match flow), bots, binary protocol, prediction
client/   Three.js renderer, camera, HUD, WebAudio synth, menus, offline + online game loops
server/   rooms, lobby, 120 Hz authoritative loop, snapshots
DECISIONS.md   every judgement call made while building
TUNING.md      every tunable constant and what it changes
```

## How it works (short)

- **Determinism:** the sim uses no `Math.random` or `Date.now`; kickoff variation uses a seeded PRNG.
- **Netcode:** clients send inputs at 60 Hz (last 4 redundant) tagged with the server tick they are for.
  The server applies them in order with a small jitter buffer (repeats the last input if one is missing)
  and sends 60 Hz binary snapshots. Clients predict their own car and the ball with the shared sim, rewind
  to each snapshot and replay unacknowledged inputs, blend small errors over ~100 ms, and interpolate other
  cars ~33 ms in the past.
- **Bots** produce the exact same input struct as a human and obey the same physics.

## Legal

This is an original game. It recreates gameplay and physics only; all visuals, audio and names are
original, and no third-party assets are used.
