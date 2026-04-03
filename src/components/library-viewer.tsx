// ─── Library Viewer ──────────────────────────────────────────────────────────
//
// Shown when `mdr` is invoked with no file argument.
// Displays reading history grouped by status, allows resuming or opening afresh.
// Missing files prompt for search/deletion.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import {
  type ProgressEntry,
  type ProgressStore,
  loadProgressStore,
  deleteProgressEntry,
  updateProgressEntryPath,
} from '../progress.js';
import { DEFAULT_WPM } from '../types.js';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface LibraryViewerProps {
  onOpen: (filePath: string, frameIndex: number, wpm: number) => void;
}

// ─── Internal types ──────────────────────────────────────────────────────────

type EntryStatus = 'in-progress' | 'completed' | 'not-found';

interface LibraryEntry {
  entry: ProgressEntry;
  status: EntryStatus;
}

type LibraryMode =
  | { type: 'list' }
  | { type: 'missing-prompt'; entry: ProgressEntry }
  | { type: 'searching'; entry: ProgressEntry }
  | { type: 'search-results'; entry: ProgressEntry; results: string[]; idx: number };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function classifyEntry(entry: ProgressEntry): EntryStatus {
  if (!fs.existsSync(entry.filePath)) return 'not-found';
  const pct = entry.totalFrames > 0 ? entry.frameIndex / entry.totalFrames : 0;
  return pct >= 0.95 ? 'completed' : 'in-progress';
}

function formatPct(entry: ProgressEntry): string {
  if (entry.totalFrames === 0) return '  0%';
  const pct = Math.round((entry.frameIndex / entry.totalFrames) * 100);
  return `${pct}%`.padStart(4);
}

function formatRelTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const d = Math.floor(diffMs / 86_400_000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function shortenPath(filePath: string, maxLen: number): string {
  const home = os.homedir();
  const p = filePath.startsWith(home) ? '~' + filePath.slice(home.length) : filePath;
  if (p.length <= maxLen) return p;
  const parts = p.split(path.sep);
  // Keep last two components
  const tail = parts.slice(-2).join(path.sep);
  return '…/' + tail;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const LibraryViewer: React.FC<LibraryViewerProps> = ({ onOpen }) => {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 100;
  const termHeight = stdout?.rows ?? 40;

  // Live store — mutated on delete/path-update
  const [store, setStore] = useState<ProgressStore>(() => loadProgressStore());

  const [viewMode, setViewMode] = useState<LibraryMode>({ type: 'list' });
  const [cursor, setCursor] = useState(0);

  // ── Classify and sort entries ──────────────────────────────
  const entries: LibraryEntry[] = useMemo(() => {
    const all = Object.values(store).map((entry) => ({
      entry,
      status: classifyEntry(entry),
    }));

    // Sort each group by lastRead descending
    const byStatus = (s: EntryStatus) =>
      all
        .filter((e) => e.status === s)
        .sort((a, b) => b.entry.lastRead.localeCompare(a.entry.lastRead));

    return [
      ...byStatus('in-progress'),
      ...byStatus('completed'),
      ...byStatus('not-found'),
    ];
  }, [store]);

  // Clamp cursor when entries change
  useEffect(() => {
    setCursor((c) => Math.max(0, Math.min(c, entries.length - 1)));
  }, [entries.length]);

  const selectedEntry = entries[cursor];

  // ── Search effect ──────────────────────────────────────────
  useEffect(() => {
    if (viewMode.type !== 'searching') return;
    const basename = path.basename(viewMode.entry.filePath);
    execFile(
      'find',
      [os.homedir(), '-name', basename, '-type', 'f', '-not', '-path', '*/.*/*'],
      { timeout: 8000 },
      (_err, stdout) => {
        const results = stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .filter((p) => p !== viewMode.entry.filePath);
        setViewMode({ type: 'search-results', entry: viewMode.entry, results, idx: 0 });
      },
    );
  }, [viewMode]);

  // ── Keyboard handling ──────────────────────────────────────
  useInput(useCallback((input, key) => {
    // ── Search results mode ──────────────────────────────────
    if (viewMode.type === 'search-results') {
      if (key.escape || input === 'q') {
        setViewMode({ type: 'list' });
        return;
      }
      if (key.upArrow || input === 'k') {
        setViewMode((m) =>
          m.type === 'search-results'
            ? { ...m, idx: Math.max(0, m.idx - 1) }
            : m,
        );
        return;
      }
      if (key.downArrow || input === 'j') {
        setViewMode((m) =>
          m.type === 'search-results'
            ? { ...m, idx: Math.min(m.results.length - 1, m.idx + 1) }
            : m,
        );
        return;
      }
      if (key.return && viewMode.results.length > 0) {
        const newPath = viewMode.results[viewMode.idx]!;
        const oldPath = viewMode.entry.filePath;
        updateProgressEntryPath(oldPath, newPath);
        setStore((prev) => {
          const next = { ...prev };
          next[newPath] = { ...prev[oldPath]!, filePath: newPath };
          delete next[oldPath];
          return next;
        });
        setViewMode({ type: 'list' });
        return;
      }
      return;
    }

    // ── Missing-file prompt mode ─────────────────────────────
    if (viewMode.type === 'missing-prompt') {
      if (key.escape || input === 'q') {
        setViewMode({ type: 'list' });
        return;
      }
      if (input === 's') {
        setViewMode({ type: 'searching', entry: viewMode.entry });
        return;
      }
      if (input === 'd') {
        const fp = viewMode.entry.filePath;
        deleteProgressEntry(fp);
        setStore((prev) => {
          const next = { ...prev };
          delete next[fp];
          return next;
        });
        setViewMode({ type: 'list' });
        return;
      }
      return;
    }

    // ── Searching mode — no-op, just wait ───────────────────
    if (viewMode.type === 'searching') {
      if (key.escape || input === 'q') {
        setViewMode({ type: 'list' });
      }
      return;
    }

    // ── Normal list mode ─────────────────────────────────────
    if (input === 'q' || (key.ctrl && input === 'c')) {
      process.exit(0);
    }

    if (key.upArrow || input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setCursor((c) => Math.min(entries.length - 1, c + 1));
      return;
    }

    if (input === 'd' && selectedEntry) {
      const fp = selectedEntry.entry.filePath;
      deleteProgressEntry(fp);
      setStore((prev) => {
        const next = { ...prev };
        delete next[fp];
        return next;
      });
      return;
    }

    if (key.return && selectedEntry) {
      if (selectedEntry.status === 'not-found') {
        setViewMode({ type: 'missing-prompt', entry: selectedEntry.entry });
        return;
      }
      onOpen(
        selectedEntry.entry.filePath,
        selectedEntry.entry.frameIndex,
        selectedEntry.entry.wpm ?? DEFAULT_WPM,
      );
    }
  }, [viewMode, entries, cursor, selectedEntry, onOpen]));

  // ── Layout helpers ─────────────────────────────────────────
  const pathColWidth = Math.max(20, Math.floor(termWidth * 0.45));
  const titleColWidth = Math.max(16, termWidth - pathColWidth - 16);

  // ── Render helpers ─────────────────────────────────────────
  function renderSectionHeader(label: string) {
    return (
      <Box key={`hdr-${label}`} marginTop={1}>
        <Text bold color="yellow">{label}</Text>
      </Box>
    );
  }

  function renderEntryRow(le: LibraryEntry, idx: number) {
    const selected = idx === cursor && viewMode.type === 'list';
    const { entry, status } = le;
    const isMissing = status === 'not-found';
    const isCompleted = status === 'completed';

    const prefix = selected ? '▶ ' : '  ';
    const titleDisplay = entry.title.slice(0, titleColWidth).padEnd(titleColWidth);
    const pathDisplay = shortenPath(entry.filePath, pathColWidth).padEnd(pathColWidth);
    const pct = isMissing ? '    ' : formatPct(entry);
    const when = formatRelTime(entry.lastRead);

    return (
      <Box key={entry.filePath}>
        <Text
          color={selected ? 'cyan' : isMissing ? 'red' : isCompleted ? 'gray' : undefined}
          dimColor={isCompleted && !selected}
          bold={selected}
        >
          {prefix}
          {isMissing ? '! ' : '  '}
          {titleDisplay}
          {'  '}
          {pathDisplay}
          {'  '}
          {pct}
          {'  '}
          {when}
        </Text>
      </Box>
    );
  }

  // ── Group entries for rendering ────────────────────────────
  const renderList = () => {
    const inProgress = entries.filter((e) => e.status === 'in-progress');
    const completed = entries.filter((e) => e.status === 'completed');
    const notFound = entries.filter((e) => e.status === 'not-found');

    const rows: React.ReactNode[] = [];

    if (inProgress.length > 0) {
      rows.push(renderSectionHeader('IN PROGRESS'));
      inProgress.forEach((le) => rows.push(renderEntryRow(le, entries.indexOf(le))));
    }
    if (completed.length > 0) {
      rows.push(renderSectionHeader('COMPLETED'));
      completed.forEach((le) => rows.push(renderEntryRow(le, entries.indexOf(le))));
    }
    if (notFound.length > 0) {
      rows.push(renderSectionHeader('NOT FOUND'));
      notFound.forEach((le) => rows.push(renderEntryRow(le, entries.indexOf(le))));
    }
    if (entries.length === 0) {
      rows.push(
        <Box key="empty" marginTop={2} marginLeft={2}>
          <Text dimColor>No reading history yet. Run </Text>
          <Text color="cyan">mdr {'<file>'}</Text>
          <Text dimColor> to start.</Text>
        </Box>,
      );
    }

    return rows;
  };

  // ── Overlay content ────────────────────────────────────────
  const renderOverlay = () => {
    if (viewMode.type === 'missing-prompt') {
      const shortPath = shortenPath(viewMode.entry.filePath, 60);
      return (
        <Box flexDirection="column" paddingX={2} paddingY={1} borderStyle="round" borderColor="red">
          <Text color="red">{shortPath} not found.</Text>
          <Box marginTop={1} gap={3}>
            <Text>[<Text bold color="cyan">s</Text>] search for it</Text>
            <Text>[<Text bold color="red">d</Text>] delete entry</Text>
            <Text>[<Text dimColor>esc</Text>] cancel</Text>
          </Box>
        </Box>
      );
    }

    if (viewMode.type === 'searching') {
      const basename = path.basename(viewMode.entry.filePath);
      return (
        <Box paddingX={2} paddingY={1} borderStyle="round" borderColor="cyan">
          <Text color="cyan">Searching for </Text>
          <Text bold>{basename}</Text>
          <Text color="cyan">…</Text>
        </Box>
      );
    }

    if (viewMode.type === 'search-results') {
      const { results, idx } = viewMode;
      return (
        <Box flexDirection="column" paddingX={2} paddingY={1} borderStyle="round" borderColor="cyan">
          {results.length === 0 ? (
            <Text dimColor>No matches found on disk.</Text>
          ) : (
            <>
              <Text dimColor>Found {results.length} match{results.length !== 1 ? 'es' : ''}:</Text>
              <Box marginTop={1} flexDirection="column">
                {results.map((r, i) => (
                  <Text key={r} color={i === idx ? 'cyan' : undefined} bold={i === idx}>
                    {i === idx ? '▶ ' : '  '}{shortenPath(r, termWidth - 6)}
                  </Text>
                ))}
              </Box>
              <Box marginTop={1} gap={3}>
                <Text>[<Text bold>Enter</Text>] use this path</Text>
                <Text>[<Text dimColor>esc</Text>] cancel</Text>
              </Box>
            </>
          )}
        </Box>
      );
    }

    return null;
  };

  const overlay = renderOverlay();

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      {/* Header */}
      <Box paddingX={2} paddingTop={1}>
        <Text bold color="cyan">mdr</Text>
        <Text dimColor> — library</Text>
      </Box>

      {/* Main area: list or overlay */}
      <Box flexDirection="column" paddingX={2} flexGrow={1}>
        {overlay ?? renderList()}
      </Box>

      {/* Footer */}
      <Box paddingX={2} paddingBottom={1}>
        <Text dimColor>
          {viewMode.type === 'list'
            ? '↑/↓ navigate  Enter open  d delete  q quit'
            : viewMode.type === 'search-results' && viewMode.results.length > 0
            ? '↑/↓ navigate  Enter select  esc cancel'
            : 'esc cancel'}
        </Text>
      </Box>
    </Box>
  );
};
