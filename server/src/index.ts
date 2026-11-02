import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { ClientMsg, PROTOCOL_VERSION } from '@turboball/shared';
import { Player, Room, cleanName } from './room';

const port = Number(process.env.PORT ?? 8080);
const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const staticDir = process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : '';
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 100);
const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS ?? 400);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
};

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
  if (staticDir) {
    let file = normalize(join(staticDir, url === '/' ? 'index.html' : url));
    if (!file.startsWith(staticDir)) { res.writeHead(403).end(); return; }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(staticDir, 'index.html');
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': file.includes('/assets/') ? 'public,max-age=31536000,immutable' : 'no-cache' });
      res.end(body);
    } catch { res.writeHead(404).end(); }
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
let connections = 0;

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
  let room: Room | null = null;
  let player: Player | null = null;
  let strikes = 0;

  const err = (msg: string): void => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'err', msg })); };

  ws.on('message', (data, isBinary) => {
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

      if (m.t === 'create' || m.t === 'join') {
        if (room) return;
        if (m.v !== PROTOCOL_VERSION) { err('Version mismatch: please reload the page'); ws.close(1008, 'version'); return; }
        const name = cleanName(m.name);
        if (m.t === 'create') {
          if (rooms.size >= MAX_ROOMS) { err('Server is full, try again later'); return; }
          const code = newCode();
          if (!code) { err('Could not allocate a room'); return; }
          const mode = m.mode === 3 ? 3 : m.mode === 2 ? 2 : 1;
          room = new Room(code, mode, (r) => { setTimeout(() => { if (r.players.size === 0 || ![...r.players.values()].some((p) => p.connected)) rooms.delete(r.code); }, 5000); });
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
    if (room && player) room.remove(player.id);
  });
  ws.on('error', () => ws.close());
});

// expire stale empty rooms
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (r.emptySince && now - r.emptySince > 30_000) { rooms.delete(code); }
  }
}, 10_000).unref();

http.listen(port, () => console.log(`turboball server listening on :${port}${staticDir ? ` (serving ${staticDir})` : ''}`));
