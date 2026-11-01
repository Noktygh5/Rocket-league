/** Dev network conditions (artificial latency / jitter / loss), set from the URL or the dev panel. */
export const netCond = { latency: 0, jitter: 0, loss: 0 };

(function readUrl(): void {
  const q = new URLSearchParams(location.search);
  netCond.latency = Number(q.get('lag') ?? 0) || 0;
  netCond.jitter = Number(q.get('jitter') ?? 0) || 0;
  netCond.loss = Number(q.get('loss') ?? 0) || 0;
})();

export function serverUrl(): string {
  const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_SERVER_URL;
  if (env) return env;
  const secure = location.protocol === 'https:';
  // Vite dev server runs on 5173 and the game server on 8080; in single-host mode they share an origin.
  if (location.port === '5173') return `${secure ? 'wss' : 'ws'}://${location.hostname}:8080`;
  return `${secure ? 'wss' : 'ws'}://${location.host}`;
}

type Handler<T> = ((d: T) => void) | null;

/**
 * WebSocket wrapper. The transport is a tiny interface (send JSON / send binary / receive both) so
 * a WebRTC data channel could replace it later. Optional simulated lag applies to both directions;
 * simulated loss only drops binary game traffic (WebSocket itself is reliable, like TCP).
 */
export class Connection {
  private ws: WebSocket;
  onOpen: (() => void) | null = null;
  onJson: Handler<Record<string, unknown>> = null;
  onBinary: Handler<ArrayBuffer> = null;
  onClose: (() => void) | null = null;
  private lastJsonOut = 0;
  private lastJsonIn = 0;
  private closed = false;

  constructor(url = serverUrl()) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => this.onOpen?.();
    this.ws.onclose = () => { this.closed = true; this.onClose?.(); };
    this.ws.onerror = () => { /* surfaced through onclose */ };
    this.ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const d = JSON.parse(e.data) as Record<string, unknown>;
        this.delayed(true, () => this.onJson?.(d), 'in');
      } else {
        const b = e.data as ArrayBuffer;
        if (netCond.loss > 0 && Math.random() * 100 < netCond.loss) return;
        this.delayed(false, () => this.onBinary?.(b), 'in');
      }
    };
  }

  private delayed(ordered: boolean, fn: () => void, dir: 'in' | 'out'): void {
    const base = netCond.latency / 2;
    if (base <= 0 && netCond.jitter <= 0) { fn(); return; }
    let at = performance.now() + base + Math.random() * netCond.jitter;
    if (ordered) {
      if (dir === 'out') { at = Math.max(at, this.lastJsonOut); this.lastJsonOut = at; }
      else { at = Math.max(at, this.lastJsonIn); this.lastJsonIn = at; }
    }
    setTimeout(fn, Math.max(0, at - performance.now()));
  }

  get open(): boolean { return !this.closed && this.ws.readyState === WebSocket.OPEN; }

  sendJson(m: object): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const s = JSON.stringify(m);
    this.delayed(true, () => { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(s); }, 'out');
  }

  sendBinary(b: ArrayBuffer): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    if (netCond.loss > 0 && Math.random() * 100 < netCond.loss) return;
    this.delayed(false, () => { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(b); }, 'out');
  }

  close(): void {
    this.closed = true;
    this.ws.onclose = null;
    try { this.ws.close(); } catch { /* ignore */ }
  }
}
