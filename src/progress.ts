// ─── Progress Persistence ────────────────────────────────────────────────────
//
// Reads and writes per-file reading progress to:
//   $XDG_DATA_HOME/mdr/progress.json  (or ~/.local/share/mdr/progress.json)
//
// Keyed by absolute resolved file path.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface ProgressEntry {
  /** Absolute file path — duplicated here for convenience when iterating values */
  filePath: string;
  /** Document title (first heading, or basename) */
  title: string;
  /** Current frame index */
  frameIndex: number;
  /** Total frames in document at time of save */
  totalFrames: number;
  /** WPM setting at time of quit */
  wpm: number;
  /** ISO timestamp of last read session */
  lastRead: string;
}

export type ProgressStore = Record<string, ProgressEntry>;

// ─── Storage location ────────────────────────────────────────────────────────

export function progressStorePath(): string {
  const xdgData =
    process.env['XDG_DATA_HOME'] ?? path.join(os.homedir(), '.local', 'share');
  return path.join(xdgData, 'mdr', 'progress.json');
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

export function loadProgressStore(): ProgressStore {
  const p = progressStorePath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as ProgressStore;
  } catch {
    return {};
  }
}

export function saveProgressEntry(entry: ProgressEntry): void {
  const p = progressStorePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const store = loadProgressStore();
  store[entry.filePath] = entry;
  fs.writeFileSync(p, JSON.stringify(store, null, 2), 'utf-8');
}

export function deleteProgressEntry(filePath: string): void {
  const p = progressStorePath();
  const store = loadProgressStore();
  if (!store[filePath]) return;
  delete store[filePath];
  fs.writeFileSync(p, JSON.stringify(store, null, 2), 'utf-8');
}

export function updateProgressEntryPath(oldPath: string, newPath: string): void {
  const p = progressStorePath();
  const store = loadProgressStore();
  const entry = store[oldPath];
  if (!entry) return;
  store[newPath] = { ...entry, filePath: newPath };
  delete store[oldPath];
  fs.writeFileSync(p, JSON.stringify(store, null, 2), 'utf-8');
}
