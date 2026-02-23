# mdr — Developer Notes

## Stack

- **Runtime**: `tsx` (TypeScript executed directly, no build step)
- **TUI**: Ink (React for the terminal)
- **Markdown parsing**: `marked` lexer
- **Syntax highlighting**: `cli-highlight` (wraps highlight.js)
- **Mermaid rendering**: `beautiful-mermaid`
- **Type checking**: `npm run typecheck` (`tsc --noEmit`)

## Key Conventions

### sample.md is the feature showcase

`sample.md` is the canonical test document. It is structured to exercise every rendering feature of the app. **When adding a new feature, add a representative example to `sample.md`.**

- New block type supported? Add a fenced block of that type.
- New syntax highlighting language? Add a code block.
- New inline formatting? Add a prose paragraph that uses it.
- New RSVP pacing rule? Add a sentence that triggers it with a comment explaining why.
- New table layout capability? Add a table that stress-tests it.

Run `npm run demo` to verify the feature renders correctly before committing.

### Visual blocks

"Visual blocks" are the things that render in the right-hand block viewer pane: `code`, `mermaid`, `table`, `ascii`. They are collected from `doc.blocks` in `parser.ts:collectVisualBlocks()` and typed as `VisualBlock` in `types.ts`.

To add a new visual block type:
1. Add the type to `BlockType` and `VisualBlock['type']` in `types.ts`
2. Detect and collect it in `collectVisualBlocks()` in `parser.ts`
3. Add a render branch in `block-viewer.tsx`
4. Add a `getTypeLabel()` case in `block-viewer.tsx`
5. Add a demo to `sample.md`

### Heading frames are skipped

The RSVP engine skips frames where `frame.heading === true`. The ToC sidebar surfaces section titles instead. Do not add heading-skipping logic elsewhere — it lives in `use-rsvp.ts:skipHeadings()`.

### Section-boundary pause

Playback auto-pauses when `docNav.activeSectionId` changes. This is wired in `app.tsx` via a `useEffect` on `activeSectionId`. The context buffer reappears on pause so the reader can orient before pressing Space to continue.

### Context buffer blanking

The context buffer (`ContextBuffer` in `toc-sidebar.tsx`) renders blank lines during playback and fills in on pause. This is controlled by the `playing` prop passed to `TocSidebar`. The height is fixed regardless of content to prevent layout reflow.

### tsconfig note

`moduleResolution: bundler` + `allowImportingTsExtensions: true` + `noEmit: true` — this configuration is intentional. `beautiful-mermaid` ships raw `.ts` source with `.ts`-extension imports, which is incompatible with `NodeNext` resolution. The bundler config is more permissive. Since `tsx` handles execution, `noEmit` has no practical cost.

## Running

```bash
npm run demo          # sample.md at 500 wpm
npm run typecheck     # type check only
npx tsx src/index.tsx <file.md> [--wpm N] [--play]
```

## File Map

```
src/
├── index.tsx              CLI entry, arg parsing
├── app.tsx                Layout, state wiring, keyboard input
├── types.ts               All shared types + constants
├── parser.ts              Markdown → Document model
├── orp.ts                 ORP index calculation + reticle rendering
├── hooks/
│   ├── use-rsvp.ts        Playback engine
│   └── use-document.ts    Section/block navigation
└── components/
    ├── toc-sidebar.tsx    Primary reading surface (ORP word, context buffer, ToC)
    ├── block-viewer.tsx   Visual block renderer
    ├── status-bar.tsx     Bottom status line
    ├── full-doc.tsx       Full-document scroll view (Tab mode)
    ├── rsvp-viewer.tsx    Thin context strip (currently unused in main layout)
    └── help-overlay.tsx   ? keybinding modal
```
