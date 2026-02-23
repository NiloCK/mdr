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

import React from 'react';
import { render } from 'ink';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseDocument } from './parser.js';
import { App } from './app.js';
import { DEFAULT_WPM, MIN_WPM, MAX_WPM } from './types.js';

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

  // ── Read markdown content ──────────────────────────────────
  let markdown = '';

  if (args.filePath) {
    markdown = readMarkdownFile(args.filePath);
  } else if (!process.stdin.isTTY) {
    // Piped input: cat file.md | rmdp
    markdown = await readStdin();
  } else {
    // No file and no piped input — show usage
    console.log(USAGE);
    console.error(
      '\x1b[31m✗ No input file specified.\x1b[0m\n' +
        '  Pass a markdown file path or pipe content via stdin.\n',
    );
    process.exit(1);
  }

  if (!markdown.trim()) {
    console.error('\x1b[31m✗ Input file is empty.\x1b[0m');
    process.exit(1);
  }

  // ── Parse the markdown ─────────────────────────────────────
  const doc = parseDocument(markdown);

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
    <App doc={doc} initialWpm={args.wpm} autoPlay={args.autoPlay} />,
    {
      // Use the full terminal (alternate screen)
      exitOnCtrlC: false, // We handle Ctrl+C ourselves
    },
  );

  await waitUntilExit();
}

// ── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('\x1b[31m✗ Fatal error:\x1b[0m', err);
  process.exit(1);
});