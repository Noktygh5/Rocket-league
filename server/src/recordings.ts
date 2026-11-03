import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local-only: the vs-Bot "record match" feature streams a fixed-camera video and bot telemetry here,
// one folder per match under recordings/. Refused for anything that is not this machine's own localhost.

export const recordingsDir = process.env.RECORDINGS_DIR
  ? resolve(process.env.RECORDINGS_DIR)
  : resolve(dirname(fileURLToPath(import.meta.url)), '../../recordings');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_RE = /^(video\.(mp4|webm)|telemetry\.ndjson|meta\.json)$/;
const MAX_REQUEST = 64 * 1024 * 1024;
const MAX_FILE = 3 * 1024 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function hostname(hostHeader: string): string {
  return hostHeader.replace(/:\d+$/, '').toLowerCase();
}

/** True only for requests from this machine addressed to localhost (a public tunnel carries another Host). */
function isLocalRequest(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  if (!loopback || !LOCAL_HOSTS.has(hostname(String(req.headers.host ?? '')))) return false;
  const origin = req.headers.origin;
  if (origin) { // a web page on another site must not be able to write files here
    try { if (!LOCAL_HOSTS.has(new URL(origin).hostname)) return false; } catch { return false; }
  }
  return true;
}

/** Handles /api/recordings/<id>/<file>: POST appends, PUT replaces. Returns false for other URLs. */
export function handleRecording(req: IncomingMessage, res: ServerResponse, url: string): boolean {
  if (!url.startsWith('/api/recordings/')) return false;
  const reply = (code: number, body = ''): void => {
    res.writeHead(code, {
      'access-control-allow-origin': String(req.headers.origin ?? ''),
      'access-control-allow-methods': 'POST, PUT, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'content-type': 'text/plain',
    });
    res.end(body);
  };
  if (!isLocalRequest(req)) { reply(403, 'Recording is only available on localhost'); return true; }
  if (req.method === 'OPTIONS') { reply(204); return true; }
  if (req.method !== 'POST' && req.method !== 'PUT') { reply(405); return true; }
  const [, , , id = '', file = ''] = url.split('/');
  if (!ID_RE.test(id) || !FILE_RE.test(file)) { reply(400, 'Bad recording path'); return true; }

  const dir = join(recordingsDir, id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  const existing = req.method === 'POST' && existsSync(path) ? statSync(path).size : 0;
  const out = createWriteStream(path, { flags: req.method === 'PUT' ? 'w' : 'a' });
  let n = 0, aborted = false;
  req.on('data', (c: Buffer) => {
    n += c.length;
    if (!aborted && (n > MAX_REQUEST || existing + n > MAX_FILE)) { aborted = true; out.destroy(); reply(413); }
  });
  req.on('error', () => out.destroy());
  out.on('finish', () => { if (!aborted) reply(204); });
  out.on('error', () => { if (!aborted) { aborted = true; reply(500); } });
  req.pipe(out);
  return true;
}
