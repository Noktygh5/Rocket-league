import type { IncomingMessage, ServerResponse } from 'node:http';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join, resolve } from 'node:path';

// Player feedback: POST /api/feedback stores one JSON line per message; GET /feedback?key=... shows
// them (newest first) to whoever knows the key. Names and messages are untrusted text: always escaped.

const FILE = resolve(process.env.FEEDBACK_FILE ?? join(process.cwd(), 'feedback.jsonl'));
const KEY_FILE = resolve(process.env.FEEDBACK_KEY_FILE ?? join(process.cwd(), '.feedback-key'));
const MAX_BODY = 4096;
const MAX_MESSAGE = 1000;
const MAX_NAME = 40;
const PER_HOUR = 5; // submissions per visitor per hour

interface Entry { time: string; name: string; message: string }

/** The key that unlocks the inbox: FEEDBACK_KEY, else a random one kept in .feedback-key. */
function loadKey(): string {
  if (process.env.FEEDBACK_KEY) return process.env.FEEDBACK_KEY;
  try {
    if (existsSync(KEY_FILE)) {
      const k = readFileSync(KEY_FILE, 'utf8').trim();
      if (k) return k;
    }
  } catch { /* fall through and make a new one */ }
  const k = randomBytes(12).toString('hex');
  try { writeFileSync(KEY_FILE, k + '\n', { mode: 0o600 }); } catch { /* in-memory only */ }
  return k;
}

const KEY = loadKey();
export const feedbackInboxPath = `/feedback?key=${KEY}`;

const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_HOUR) { hits.set(ip, recent); return true; }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}
setInterval(() => { const now = Date.now(); for (const [ip, ts] of hits) if (ts.every((t) => now - t > 3_600_000)) hits.delete(ip); }, 600_000).unref();

function clientIp(req: IncomingMessage): string {
  const xf = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xf) ? xf[0] : xf)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

/** Trims, drops control characters (keeping newlines) and caps the length. */
function clean(v: unknown, max: number, keepNewlines: boolean): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const stripped = v.replace(keepNewlines ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, '');
  return stripped.trim().slice(0, max);
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

function keyOk(given: string | null): boolean {
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readAll(): Entry[] {
  if (!existsSync(FILE)) return [];
  const out: Entry[] = [];
  for (const line of readFileSync(FILE, 'utf8').split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line) as Entry); } catch { /* skip a damaged line */ }
  }
  return out.reverse();
}

function inboxHtml(entries: Entry[]): string {
  const rows = entries.map((e) => `<article><header><b>${esc(e.name || 'Anonymous')}</b><time>${esc(e.time)}</time></header><p>${esc(e.message)}</p></article>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Feedback inbox</title><meta name="robots" content="noindex">
<style>body{margin:0;padding:24px 16px;background:#0a0e16;color:#e8ecf4;font:16px/1.5 system-ui,sans-serif}main{max-width:720px;margin:0 auto}
h1{margin:0 0 4px}small{opacity:.6}article{margin:14px 0;padding:14px 16px;background:#121a2a;border-left:4px solid #ff9a3c}
header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}time{opacity:.55;font-size:13px}p{margin:8px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}</style></head>
<body><main><h1>Feedback inbox</h1><small>${entries.length} message${entries.length === 1 ? '' : 's'}, newest first</small>${rows || '<p>Nothing yet.</p>'}</main></body></html>`;
}

/** Handles /api/feedback and /feedback. Returns true when the request was answered. */
export function handleFeedback(req: IncomingMessage, res: ServerResponse, path: string): boolean {
  if (path === '/api/feedback') {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return true; }
    if (req.method !== 'POST') { res.writeHead(405, cors).end(); return true; }
    let size = 0;
    const chunks: Buffer[] = [];
    let aborted = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { aborted = true; res.writeHead(413, cors).end(); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      let body: { name?: unknown; message?: unknown };
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.writeHead(400, cors).end(); return; }
      const message = clean(body?.message, MAX_MESSAGE, true);
      if (message.length < 3) { res.writeHead(400, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'Please write a little more' })); return; }
      if (limited(clientIp(req))) { res.writeHead(429, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'Thanks! You have sent a few already, try again later' })); return; }
      const entry: Entry = { time: new Date().toISOString(), name: clean(body?.name, MAX_NAME, false), message };
      try { appendFileSync(FILE, JSON.stringify(entry) + '\n'); } catch (e) {
        console.error('feedback write failed', e);
        res.writeHead(500, cors).end();
        return;
      }
      res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
    });
    return true;
  }
  if (path === '/feedback') {
    const given = new URL(req.url ?? '/', 'http://x').searchParams.get('key');
    if (!keyOk(given)) { res.writeHead(404).end(); return true; } // do not reveal that an inbox exists
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
    res.end(inboxHtml(readAll()));
    return true;
  }
  return false;
}
