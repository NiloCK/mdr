# mdr — Markdown RSVP

A TUI speed-reader for structured, agent-authored technical documents. Displays one word at a time using [Rapid Serial Visual Presentation (RSVP)](https://en.wikipedia.org/wiki/Rapid_serial_visual_presentation) with the table-of-contents as the primary reading surface and a split-pane viewer for code blocks and diagrams.

Built for the workflow: **agent writes long-form analysis → human consumes it fast.**

## Features

- **RSVP word-by-word playback** with Optimal Recognition Point (ORP) highlighting — the focal letter of each word is pinned to a fixed column and rendered in red so your eye never moves
- **Smart pacing** — automatic pause scaling on sentence endings (2×), commas (1.4×), paragraph breaks (2.5×), headings (1.8×), inline code (1.4×), and long words (1.15–1.3×)
- **Markdown-aware formatting** in the RSVP stream — **bold**, *italic*, and `‹inline code›` each get distinct visual treatment
- **ToC as reading surface** — the ORP word and context buffer live inside the table of contents sidebar, minimizing eye movement between navigation and reading
- **Section-boundary pause** — playback auto-pauses at each new section; press Space to continue
- **Context buffer** — two fixed lines of surrounding text (hidden during playback, visible when paused) for quick recovery after tripping
- **Code block viewer** — split pane that renders the current section's code blocks with syntax highlighting, line numbers, language labels, and tab-style navigation between multiple blocks
- **Mermaid diagram support** — mermaid fenced blocks are rendered as ASCII art in the block viewer
- **Full document view** — press `Tab` to toggle between RSVP and a scrollable rendered markdown view with active-section highlighting
- **Block pinning** — press `x` to pin a code block on screen so it stays visible as you RSVP through the surrounding prose
- **Vim-style navigation** — `j`/`k` for sections, `g`/`G` for start/end, `d`/`u` for half-page scroll in document mode
- **Speed controls** — `[`/`]` for ±25 WPM, `{`/`}` for ±100 WPM, range 50–1500
- **Word stepping** — left/right arrows step one word at a time when paused, for the "regression" capability RSVP normally lacks

## Quick Start

```sh
npm install -g @nilock/mdr

mdr path/to/document.md

# With options
mdr design-doc.md --wpm 400 --play

# Pipe from stdin
cat README.md | mdr
```

### Run from source

```sh
npm install
npm run demo                        # included sample document
npx tsx src/index.tsx document.md
```

### Requirements

- **Node.js** ≥ 18 (tested on 22.x)

No build step needed — `tsx` runs TypeScript directly.

## Usage

```
mdr <file.md> [options]

Options:
  -w, --wpm <n>     Initial words-per-minute (default: 500)
  -p, --play        Start RSVP playback immediately
  -h, --help        Show help message
  -v, --version     Show version
```

## Keyboard Controls

### Playback

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `←` | Back one word (when paused) |
| `→` | Forward one word (when paused) |

### Speed

| Key | Action |
|-----|--------|
| `]` or `=` | Increase WPM by 25 |
| `[` or `-` | Decrease WPM by 25 |
| `}` | Increase WPM by 100 |
| `{` | Decrease WPM by 100 |

### Navigation

| Key | Action |
|-----|--------|
| `↓` or `j` | Next section |
| `↑` or `k` | Previous section |
| `g` | Jump to beginning |
| `G` | Jump to end |
| `n` | Next code block in section |
| `p` | Previous code block in section |

### View

| Key | Action |
|-----|--------|
| `Tab` | Toggle RSVP / Document view |
| `s` | Toggle sidebar |
| `x` | Pin / unpin current block |
| `?` | Help overlay |
| `q` | Quit |

### Document View

| Key | Action |
|-----|--------|
| `j` / `k` | Scroll down / up |
| `d` / `u` | Half-page down / up |
| `g` / `G` | Top / Bottom |
| `Space` | Switch to RSVP and toggle play |

## Architecture

```
src/
├── index.tsx              CLI entry point, arg parsing, file reading
├── app.tsx                Main App component — layout, state wiring, input routing
├── types.ts               Core types: Document, Section, Block, Frame, AppState
├── parser.ts              Markdown → Document model (uses `marked` lexer)
├── orp.ts                 Optimal Recognition Point calculation
├── hooks/
│   ├── use-rsvp.ts        RSVP engine — self-correcting timer, play/pause, speed
│   └── use-document.ts    Document navigation — section/block traversal, sync
└── components/
    ├── toc-sidebar.tsx    ToC with inline ORP word, context buffer, and collapsing tree
    ├── block-viewer.tsx   Code/diagram block display with syntax highlighting and tabs
    ├── status-bar.tsx     Bottom bar — WPM, progress, section, time remaining
    ├── full-doc.tsx       Scrollable rendered markdown view
    └── help-overlay.tsx   Keyboard shortcut reference modal
```

### Document Model

The parser converts markdown into a structured `Document`:

- **Sections** — hierarchical tree built from headings, each tracking its frame range
- **Blocks** — sequential content blocks (prose, code, mermaid, list, blockquote, heading, etc.)
- **Frames** — flat array of RSVP-playable "words," each annotated with formatting flags, section/block membership, ORP index, and a pause multiplier

This model enables efficient bi-directional sync: the RSVP engine's frame position drives ToC highlighting and block viewer updates; section navigation jumps the RSVP position.

### ORP Algorithm

The Optimal Recognition Point is calculated per-word based on length (after stripping trailing punctuation):

| Word length | ORP index |
|-------------|-----------|
| 1 | 0 |
| 2–5 | 1 |
| 6–9 | 2 |
| 10–13 | 3 |
| 14+ | 4 |

The ORP letter is rendered in bold red at a fixed column. All words are padded so this column never moves — your fovea stays stationary.

## Writing Documents for mdr

See [`AGENT_WRITING_GUIDE.md`](./AGENT_WRITING_GUIDE.md) for comprehensive guidelines on structuring documents for optimal RSVP consumption. Key points:

- **One H1 title**, followed by an executive summary
- **Sections of 100–300 words** — split longer sections
- **Short, direct sentences** in SVO order — RSVP removes the ability to re-read
- **Code blocks of 10–30 lines** with language tags — they render in the block viewer
- **No back-to-back code blocks** — add connecting prose between them
- **Mermaid diagrams under 10 nodes** — keep them readable at terminal width
- **Consistent terminology** — the reader can't flip back to check definitions
- **Front-load each section** — first sentence states the key point

The guide also includes document templates for assessment reports, design documents, and discovery reports.

## Dependencies

| Package | Purpose |
|---------|---------|
| [ink](https://github.com/vadimdemedes/ink) | React-based TUI framework |
| [react](https://react.dev) | Component model (required by Ink) |
| [marked](https://github.com/markedjs/marked) | Markdown lexer — extracts AST for section/block/inline parsing |
| [chalk](https://github.com/chalk/chalk) | Terminal string styling |
| [cli-highlight](https://github.com/felixfbecker/cli-highlight) | Syntax highlighting for code blocks |
| [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) | Terminal-native mermaid diagram rendering |
| [tsx](https://github.com/privatenumber/tsx) | TypeScript execution without build step |

## Performance Notes

Even at 1,000 WPM the RSVP engine only updates ~17 times per second. Ink's React reconciliation handles this comfortably — each tick only changes the word text, and React diffs the minimal update. The self-correcting `setTimeout` loop (not `setInterval`) ensures consistent pacing even with variable pause multipliers.

The document parser runs once at startup. All frame lookups during playback are O(1) array indexing.

## License

MIT
