// Usage: npx tsx scripts/smoke.ts   (from /server). Spawns the server, plays a tiny 1v1 over real WebSockets.
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { CarInput, MSG_SNAPSHOT, PROTOCOL_VERSION, decodeSnapshot, encodeInputPacket } from '@turboball/shared';

const PORT = 18080;
const srv = spawn('npx', ['tsx', 'src/index.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function client(name: string): { ws: WebSocket; msgs: Record<string, unknown>[]; snaps: number; lastTick: number } {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const c = { ws, msgs: [] as Record<string, unknown>[], snaps: 0, lastTick: 0 };
  ws.on('message', (d, bin) => {
    if (bin) {
      const b = d as Buffer;
      const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      if (new DataView(ab).getUint8(0) === MSG_SNAPSHOT) { c.snaps++; const s = decodeSnapshot(ab); if (s) c.lastTick = s.tick; }
    } else c.msgs.push(JSON.parse(d.toString()));
  });
  void name;
  return c;
}

async function main(): Promise<void> {
  await sleep(2500);
  const a = client('A'), b = client('B');
  await sleep(300);
  a.ws.send(JSON.stringify({ t: 'create', name: 'Alice', mode: 1, v: PROTOCOL_VERSION }));
  await sleep(300);
  const welcome = a.msgs.find((m) => m.t === 'welcome') as { code: string } | undefined;
  if (!welcome) throw new Error('no welcome');
  b.ws.send(JSON.stringify({ t: 'join', name: 'Bob', code: welcome.code, v: PROTOCOL_VERSION }));
  await sleep(300);
  b.ws.send(JSON.stringify({ t: 'ready', ready: true }));
  await sleep(200);
  a.ws.send(JSON.stringify({ t: 'start' }));
  await sleep(500);
  const start = a.msgs.find((m) => m.t === 'start');
  if (!start) throw new Error('no start message');
  // bad version is rejected
  const c = client('C');
  await sleep(200);
  c.ws.send(JSON.stringify({ t: 'join', name: 'Eve', code: welcome.code, v: 999 }));
  await sleep(300);
  const rejected = c.msgs.some((m) => m.t === 'err');
  // drive for 4 s
  const inp = Object.assign(new CarInput(), { throttle: 1, boost: true });
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    const tick = b.lastTick + 20;
    b.ws.send(encodeInputPacket(tick, [inp, inp, inp, inp]));
    await sleep(16);
  }
  const ok = a.snaps > 150 && b.snaps > 150 && rejected;
  console.log(`snapshots A=${a.snaps} B=${b.snaps} lastTick=${a.lastTick} badVersionRejected=${rejected}`);
  console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED');
  srv.kill();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
