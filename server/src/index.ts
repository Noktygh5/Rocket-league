import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { WebSocketServer, WebSocket } from 'ws';
import { ClientMsg, PROTOCOL_VERSION } from '@turboball/shared';
import { Player, Room, cleanName } from './room';
import { feedbackInboxPath, handleFeedback } from './feedback';

const port = Number(process.env.PORT ?? 8080);
const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const staticDir = process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : '';
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 100);
const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS ?? 400);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
};

const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.map']);
// The built client never changes while the server runs, so each file is read and compressed once.
const fileCache = new Map<string, { body: Buffer; gz: Buffer | null; type: string }>();

function loadFile(file: string): { body: Buffer; gz: Buffer | null; type: string } {
  let f = fileCache.get(file);
  if (!f) {
    const ext = extname(file);
    const body = readFileSync(file);
    f = { body, gz: COMPRESSIBLE.has(ext) ? gzipSync(body, { level: 9 }) : null, type: MIME[ext] ?? 'application/octet-stream' };
    fileCache.set(file, f);
  }
  return f;
}

const rooms = new Map<string, Room>();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O

function newCode(): string {
  for (let tries = 0; tries < 50; tries++) {
    let c = '';
    for (let i = 0; i < 5; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  return '';
}

function originOk(origin: string | undefined, host: string | undefined): boolean {
  if (allowed.length === 0) return true; // dev default: any origin
  if (!origin) return false;
  if (allowed.includes('*') || allowed.includes(origin)) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

const http = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, protocol: PROTOCOL_VERSION }));
    return;
  }
  if (handleFeedback(req, res, url)) return;
  if (staticDir) {
    let file = normalize(join(staticDir, url === '/' ? 'index.html' : url));
    if (!file.startsWith(staticDir)) { res.writeHead(403).end(); return; }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(staticDir, 'index.html');
    try {
      const f = loadFile(file);
      const gz = f.gz !== null && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
      const body = gz ? (f.gz as Buffer) : f.body;
      res.writeHead(200, {
        'content-type': f.type, 'content-length': body.length, vary: 'accept-encoding',
        ...(gz ? { 'content-encoding': 'gzip' } : {}),
        'cache-control': file.includes('/assets/') ? 'public,max-age=31536000,immutable' : 'no-cache',
      });
      res.end(body);
    } catch { res.writeHead(404).end(); }
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
let connections = 0;

// Heartbeat: ping every socket regularly. Dead (half-open) connections get dropped so rooms notice quickly,
// and the steady traffic stops Render's proxy from closing idle lobby connections.
const live = new WeakSet<WebSocket>();
setInterval(() => {
  for (const ws of wss.clients) {
    if (!live.has(ws)) { ws.terminate(); continue; }
    live.delete(ws);
    try { ws.ping(); } catch { /* socket is closing */ }
  }
}, 15_000).unref();

http.on('upgrade', (req, socket, head) => {
  if (!originOk(req.headers.origin, req.headers.host) || connections >= MAX_CONNECTIONS) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws: WebSocket) => {
  connections++;
  live.add(ws);
  ws.on('pong', () => live.add(ws));
  let room: Room | null = null;
  let player: Player | null = null;
  let strikes = 0;

  const err = (msg: string): void => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'err', msg })); };

  ws.on('message', (data, isBinary) => {
    live.add(ws);
    try {
      if (isBinary) {
        if (room && player) {
          const b = data as Buffer;
          room.onBinary(player, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
        }
        return;
      }
      let m: ClientMsg;
      try { m = JSON.parse(data.toString()) as ClientMsg; } catch { if (++strikes > 5) ws.close(1008); return; }
      if (!m || typeof m.t !== 'string') return;

      if (m.t === 'rejoin') {
        if (room) return;
        if (m.v !== PROTOCOL_VERSION) { err('Version mismatch: please reload the page'); ws.close(1008, 'version'); return; }
        const r = rooms.get(String(m.code ?? '').toUpperCase().slice(0, 5));
        const p = r?.rejoin(ws, String(m.token ?? '').slice(0, 64));
        if (!r || !p) { err('That match is no longer available'); return; }
        room = r; player = p;
        return;
      }
      if (m.t === 'create' || m.t === 'join') {
        if (room) return;
        if (m.v !== PROTOCOL_VERSION) { err('Version mismatch: please reload the page'); ws.close(1008, 'version'); return; }
        const name = cleanName(m.name);
        if (m.t === 'create') {
          if (rooms.size >= MAX_ROOMS) { err('Server is full, try again later'); return; }
          const code = newCode();
          if (!code) { err('Could not allocate a room'); return; }
          const mode = m.mode === 3 ? 3 : m.mode === 2 ? 2 : 1;
          room = new Room(code, mode);
          rooms.set(code, room);
        } else {
          const r = rooms.get(String(m.code ?? '').toUpperCase().slice(0, 5));
          if (!r) { err('Room not found'); return; }
          room = r;
        }
        player = room.add(ws, name);
        if (!player) { err(room.state === 'playing' ? 'Match already in progress' : 'Room is full'); room = null; }
        return;
      }
      if (room && player) room.onMessage(player, m);
    } catch (e) {
      console.error('message error', e);
    }
  });

  ws.on('close', () => {
    connections--;
    if (room && player) room.remove(player.id, ws);
  });
  ws.on('error', () => ws.close());
});

// expire rooms nobody is connected to (a running match gets a longer grace period so players can reconnect)
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (r.emptySince && now - r.emptySince > r.emptyGraceMs) { rooms.delete(code); }
  }
}, 5_000).unref();

// Render sends SIGTERM when it redeploys: tell players instead of dropping them silently.
process.on('SIGTERM', () => {
  for (const ws of wss.clients) {
    try { ws.send(JSON.stringify({ t: 'err', msg: 'Server is restarting for an update' })); ws.close(1012); } catch { /* ignore */ }
  }
  setTimeout(() => process.exit(0), 1000);
});

http.listen(port, () => {
  console.log(`turboball server listening on :${port}${staticDir ? ` (serving ${staticDir})` : ''}`);
  console.log(`feedback inbox: http://localhost:${port}${feedbackInboxPath}`);
});
