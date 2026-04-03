#!/usr/bin/env tsx
// ─── CLI Entry Point ────────────────────────────────────────────────────────
//
// Usage:
//   npx tsx src/index.tsx <path-to-markdown-file> [options]
//   npm run demo                          (runs with sample.md)
//
// Options:
//   --wpm <number>    Initial words-per-minute (default: 300)
//   --play            Start playback immediately
//   --help            Show usage information
//
// The entry point reads the markdown file, parses it into the Document
// model, and renders the full TUI application.

import React, { useState, useCallback } from 'react';
import { render } from 'ink';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseDocument } from './parser.js';
import { App } from './app.js';
import { DEFAULT_WPM, MIN_WPM, MAX_WPM } from './types.js';
import type { Document } from './types.js';
import { loadProgressStore } from './progress.js';
import { LibraryViewer } from './components/library-viewer.js';

// ─── Argument Parsing ───────────────────────────────────────────────────────
//
// Lightweight CLI arg parser — no external deps needed for this.

interface CliArgs {
  filePath: string | null;
  wpm: number;
  autoPlay: boolean;
  showHelp: boolean;
  showVersion: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    filePath: null,
    wpm: DEFAULT_WPM,
    autoPlay: false,
    showHelp: false,
    showVersion: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;

    if (arg === '--help' || arg === '-h') {
      args.showHelp = true;
      i++;
      continue;
    }

    if (arg === '--version' || arg === '-v') {
      args.showVersion = true;
      i++;
      continue;
    }

    if (arg === '--wpm' || arg === '-w') {
      const next = argv[i + 1];
      if (next != null) {
        const parsed = parseInt(next, 10);
        if (!isNaN(parsed) && parsed >= MIN_WPM && parsed <= MAX_WPM) {
          args.wpm = parsed;
        } else {
          console.error(
            `⚠  Invalid WPM value "${next}". Must be ${MIN_WPM}–${MAX_WPM}. Using default (${DEFAULT_WPM}).`,
          );
        }
        i += 2;
      } else {
        console.error('⚠  --wpm requires a numeric argument.');
        i++;
      }
      continue;
    }

    if (arg === '--play' || arg === '-p') {
      args.autoPlay = true;
      i++;
      continue;
    }

    // Anything else without a leading '--' is treated as the file path
    if (!arg.startsWith('-')) {
      args.filePath = arg;
      i++;
      continue;
    }

    // Unknown flag
    console.error(`⚠  Unknown option: ${arg}`);
    i++;
  }

  return args;
}

// ─── Usage Text ─────────────────────────────────────────────────────────────

const USAGE = `
\x1b[1m\x1b[36mrmdp\x1b[0m — Rapid Markdown Presentation

\x1b[1mUSAGE\x1b[0m
  rmdp <file.md> [options]

\x1b[1mOPTIONS\x1b[0m
  -w, --wpm <n>     Initial words-per-minute (default: ${DEFAULT_WPM})
  -p, --play        Start RSVP playback immediately
  -h, --help        Show this help message
  -v, --version     Show version

\x1b[1mEXAMPLES\x1b[0m
  rmdp README.md
  rmdp design-doc.md --wpm 400 --play
  npm run demo

\x1b[1mIN-APP CONTROLS\x1b[0m
  Space         Play / Pause RSVP
  ← →           Step backward / forward one word (when paused)
  [ ]  or  - =  Decrease / Increase WPM by 25
  { }           Decrease / Increase WPM by 100
  ↑ ↓  or  k j  Previous / Next section
  Tab           Toggle between RSVP and full-document view
  n / p         Next / Previous code block in section
  x             Pin / unpin current block
  s             Toggle sidebar
  g / G         Jump to beginning / end
  ?             Show keybinding help overlay
  q             Quit

\x1b[2mDesigned for rapid assessment of agent-authored design documents.\x1b[0m
`;

// ─── File Reading ───────────────────────────────────────────────────────────

function readMarkdownFile(filePath: string): string {
  const resolved = path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(resolved)) {
    console.error(`\x1b[31m✗ File not found:\x1b[0m ${resolved}`);
    process.exit(1);
  }

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    // If a directory is given, look for common doc files
    const candidates = [
      'README.md',
      'readme.md',
      'DESIGN.md',
      'design.md',
      'ARCHITECTURE.md',
      'index.md',
    ];
    for (const candidate of candidates) {
      const candidatePath = path.join(resolved, candidate);
      if (fs.existsSync(candidatePath)) {
        console.error(`\x1b[33m→\x1b[0m Reading ${candidatePath}`);
        return fs.readFileSync(candidatePath, 'utf-8');
      }
    }
    console.error(
      `\x1b[31m✗ Directory "${filePath}" has no markdown file.\x1b[0m\n` +
        `  Looked for: ${candidates.join(', ')}`,
    );
    process.exit(1);
  }

  return fs.readFileSync(resolved, 'utf-8');
}

// ─── Stdin Reading ──────────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
    process.stdin.on('error', reject);

    // If stdin is a TTY (no piped input), don't wait
    if (process.stdin.isTTY) {
      resolve('');
    }
  });
}

// ─── Library → Reader wrapper ────────────────────────────────────────────────
//
// Rendered when no file is given. Starts in library mode; switches to the
// main App when the user picks a file.

interface LibraryRootProps {
  initialWpm: number;
}

const LibraryRoot: React.FC<LibraryRootProps> = ({ initialWpm }) => {
  const [readerState, setReaderState] = useState<{
    doc: Document;
    filePath: string;
    frameIndex: number;
    wpm: number;
  } | null>(null);

  const handleOpen = useCallback(
    (filePath: string, frameIndex: number, wpm: number) => {
      const markdown = fs.readFileSync(filePath, 'utf-8');
      const doc = parseDocument(markdown);
      setReaderState({ doc, filePath, frameIndex, wpm });
    },
    [],
  );

  if (readerState) {
    return (
      <App
        doc={readerState.doc}
        filePath={readerState.filePath}
        initialFrameIndex={readerState.frameIndex}
        initialWpm={readerState.wpm}
        autoPlay={false}
      />
    );
  }

  return <LibraryViewer onOpen={handleOpen} />;
};

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // Skip the first two args: node binary and script path
  const userArgs = process.argv.slice(2);
  const args = parseArgs(userArgs);

  if (args.showVersion) {
    // Read version from package.json
    try {
      const pkgPath = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '..',
        'package.json',
      );
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      console.log(`rmdp v${pkg.version}`);
    } catch {
      console.log('rmdp v0.1.0');
    }
    process.exit(0);
  }

  if (args.showHelp) {
    console.log(USAGE);
    process.exit(0);
  }

  // ── Library mode (no file, interactive TTY) ───────────────
  if (!args.filePath && process.stdin.isTTY) {
    const { waitUntilExit } = render(
      <LibraryRoot initialWpm={args.wpm} />,
      { exitOnCtrlC: false },
    );
    await waitUntilExit();
    return;
  }

  // ── Read markdown content ──────────────────────────────────
  let markdown = '';
  let resolvedFilePath: string | undefined;

  if (args.filePath) {
    resolvedFilePath = path.resolve(process.cwd(), args.filePath);
    markdown = readMarkdownFile(args.filePath);
  } else if (!process.stdin.isTTY) {
    // Piped input: cat file.md | rmdp
    markdown = await readStdin();
  }

  if (!markdown.trim()) {
    console.error('\x1b[31m✗ Input file is empty.\x1b[0m');
    process.exit(1);
  }

  // ── Parse the markdown ─────────────────────────────────────
  const doc = parseDocument(markdown);

  // ── Check for saved progress ───────────────────────────────
  let savedFrameIndex: number | undefined;
  if (resolvedFilePath) {
    const store = loadProgressStore();
    const saved = store[resolvedFilePath];
    if (saved && saved.frameIndex > 0) {
      savedFrameIndex = saved.frameIndex;
      const pct = Math.round((saved.frameIndex / Math.max(1, saved.totalFrames)) * 100);
      console.error(`\x1b[33m→ Resuming from ${pct}%\x1b[0m  (Home/g to restart)\n`);
    }
  }

  // ── Summary ────────────────────────────────────────────────
  const sectionCount = doc.flatSections.length;
  const wordCount = doc.frames.length;
  const estMinutes = Math.ceil(wordCount / args.wpm);
  const blockCount = doc.blocks.filter(
    (b) => b.type === 'code' || b.type === 'mermaid',
  ).length;

  console.error(
    `\x1b[36m◊ rmdp\x1b[0m  ${args.filePath ?? 'stdin'}\n` +
      `  ${sectionCount} sections · ${wordCount} words · ` +
      `${blockCount} code/diagram blocks · ` +
      `~${estMinutes} min @ ${args.wpm} wpm\n`,
  );

  // ── Render the TUI ─────────────────────────────────────────
  const { waitUntilExit } = render(
    <App
      doc={doc}
      filePath={resolvedFilePath}
      initialWpm={args.wpm}
      initialFrameIndex={savedFrameIndex}
      autoPlay={args.autoPlay}
    />,
    { exitOnCtrlC: false },
  );

  await waitUntilExit();
}

// ── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('\x1b[31m✗ Fatal error:\x1b[0m', err);
  process.exit(1);
});