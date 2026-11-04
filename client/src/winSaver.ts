// Saves the video of a won Ultrahard Boss match to the player's own computer.
// A web page cannot write to Documents by itself, so the player picks a folder once (the picker opens in
// Documents); the browser remembers it. The video streams into that folder while the match runs and is
// deleted again if the player loses, so only wins are kept. Browsers without folder access (Firefox,
// Safari) download the video when the match is won instead.

export type SaveResult = 'folder' | 'download' | 'discarded' | 'error';

interface Perm { queryPermission(o: { mode: string }): Promise<string>; requestPermission(o: { mode: string }): Promise<string> }
export type Dir = FileSystemDirectoryHandle & Perm;
interface Writable { write(b: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }
interface FileHandle { createWritable(): Promise<Writable> }
interface DirApi {
  getFileHandle(name: string, o: { create: boolean }): Promise<FileHandle>;
  removeEntry(name: string): Promise<void>;
}

const picker = (): ((o: object) => Promise<Dir>) | undefined =>
  (window as unknown as { showDirectoryPicker?: (o: object) => Promise<Dir> }).showDirectoryPicker;

export function canRecordWins(): boolean {
  return typeof MediaRecorder !== 'undefined';
}

// ---- remember the chosen folder between visits (IndexedDB can store folder handles)
function idb(run: (s: IDBObjectStore) => IDBRequest, mode: IDBTransactionMode): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open('turboball-wins', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('h');
      open.onerror = () => resolve(undefined);
      open.onsuccess = () => {
        const req = run(open.result.transaction('h', mode).objectStore('h'));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      };
    } catch { resolve(undefined); }
  });
}

/**
 * The folder wins are saved in, or null when the browser cannot save to a folder or the player cancelled
 * (wins are then downloaded). Call it straight from a click: the folder picker needs one.
 */
export async function getSaveFolder(): Promise<Dir | null> {
  const pick = picker();
  if (!pick) return null;
  try {
    const saved = (await idb((s) => s.get('dir'), 'readonly')) as Dir | undefined;
    if (saved) {
      const o = { mode: 'readwrite' };
      if ((await saved.queryPermission(o)) === 'granted' || (await saved.requestPermission(o)) === 'granted') return saved;
    }
    const dir = await pick({ id: 'turboball-wins', mode: 'readwrite', startIn: 'documents' });
    await idb((s) => s.put(dir, 'dir'), 'readwrite');
    return dir;
  } catch { return null; }
}

export class WinSink {
  private name = '';
  private parts: Blob[] = [];
  private w: Writable | null = null;
  private chain: Promise<void> = Promise.resolve();
  private broken = false;
  private type = 'video/webm';

  constructor(private dir: Dir | null, private base: string) {}

  /** Creates the file (when saving to a folder). Falls back to an in-memory copy if the folder is not usable. */
  async open(ext: string, type: string): Promise<void> {
    this.name = `${this.base}.${ext}`;
    this.type = type.split(';')[0];
    if (!this.dir) return;
    try {
      this.w = await (await (this.dir as unknown as DirApi).getFileHandle(this.name, { create: true })).createWritable();
    } catch { this.w = null; this.dir = null; }
  }

  write(b: Blob): void {
    const w = this.w;
    if (!w) { this.parts.push(b); return; }
    this.chain = this.chain.then(() => w.write(b)).catch(() => { this.broken = true; });
  }

  /** keep = the player won. Resolves with where the video ended up, and its file name. */
  async finish(keep: boolean): Promise<{ result: SaveResult; name: string }> {
    await this.chain;
    const name = this.name;
    const w = this.w;
    if (w) {
      this.w = null;
      if (keep && !this.broken) {
        try { await w.close(); return { result: 'folder', name }; } catch { /* fall through to cleanup */ }
      } else {
        try { await w.abort(); } catch { /* already closed */ }
      }
      try { await (this.dir as unknown as DirApi).removeEntry(name); } catch { /* nothing to remove */ }
      return { result: keep ? 'error' : 'discarded', name };
    }
    if (!keep) { this.parts = []; return { result: 'discarded', name }; }
    const url = URL.createObjectURL(new Blob(this.parts, { type: this.type }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    this.parts = [];
    return { result: 'download', name };
  }
}
