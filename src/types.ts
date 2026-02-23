// ─── Core Document Model ────────────────────────────────────────────────────

/**
 * A fully parsed document ready for RSVP playback and navigation.
 */
export interface Document {
  /** Original markdown source */
  source: string;
  /** Hierarchical section tree built from headings */
  sections: Section[];
  /** Flattened section list for linear navigation */
  flatSections: Section[];
  /** All blocks in document order */
  blocks: Block[];
  /** All RSVP-playable frames in document order */
  frames: Frame[];
}

/**
 * A section of the document, rooted at a heading.
 * Sections nest: an H2 under an H1 is a child of that H1 section.
 */
export interface Section {
  id: number;
  /** Heading depth: 1–6 */
  level: number;
  /** Raw heading text */
  title: string;
  /** Nested sub-sections */
  children: Section[];
  /** Parent section id, or -1 for top-level */
  parentId: number;
  /** IDs of blocks that belong directly to this section */
  blockIds: number[];
  /** Index of first RSVP frame in this section (inclusive) */
  frameStart: number;
  /** Index of last RSVP frame in this section (inclusive), or -1 if none */
  frameEnd: number;
}

/**
 * A contiguous block of content in the document.
 */
export interface Block {
  id: number;
  type: BlockType;
  /** Which section this block belongs to */
  sectionId: number;
  /** Raw content of the block */
  content: string;
  /** For code/mermaid blocks: the language tag */
  language?: string;
  /** Index of first RSVP frame generated from this block (inclusive) */
  frameStart: number;
  /** Index of last RSVP frame generated from this block (inclusive), or -1 */
  frameEnd: number;
}

export type BlockType = 'prose' | 'code' | 'mermaid' | 'heading' | 'list' | 'blockquote' | 'hr' | 'table';

/**
 * A single RSVP frame — one "flash" in the reader.
 * Usually one word, but may be an inline code span kept as a unit.
 */
export interface Frame {
  /** Global index in the frames array */
  index: number;
  /** The raw word text (without formatting escapes) */
  word: string;
  /** Section this frame belongs to */
  sectionId: number;
  /** Block this frame belongs to */
  blockId: number;
  /** Index of the Optimal Recognition Point letter within `word` */
  orpIndex: number;

  // ─── Inline formatting flags ─────────────
  bold: boolean;
  italic: boolean;
  inlineCode: boolean;
  heading: boolean;
  /** Heading depth if heading is true */
  headingDepth: number;

  // ─── Timing ──────────────────────────────
  /**
   * Multiplier applied to base inter-word delay.
   * 1.0 = normal, >1 = longer pause (e.g. punctuation, headers).
   */
  pauseMultiplier: number;
}

// ─── Visual / Code Blocks for the Block Viewer ──────────────────────────────

/**
 * A renderable visual block (code, mermaid, table, etc.) that appears
 * in the sidebar / block-viewer pane.
 */
export interface VisualBlock {
  blockId: number;
  sectionId: number;
  type: 'code' | 'mermaid' | 'table' | 'ascii';
  language?: string;
  content: string;
  /** Pre-rendered terminal string (syntax-highlighted code, ASCII mermaid, etc.) */
  rendered?: string;
}

// ─── Application State ─────────────────────────────────────────────────────

export type ViewMode = 'rsvp' | 'document';

export interface AppState {
  /** Parsed document */
  doc: Document;
  /** Current view mode */
  mode: ViewMode;

  // ─── RSVP engine state ───────────────────
  /** Current frame index */
  frameIndex: number;
  /** Words per minute */
  wpm: number;
  /** Whether playback is running */
  playing: boolean;

  // ─── Navigation state ────────────────────
  /** Currently active section id */
  activeSectionId: number;
  /** Currently displayed visual block index (within the active section's visual blocks) */
  activeVisualBlockIndex: number;
  /** Whether a visual block is "pinned" (stays on screen regardless of RSVP position) */
  visualBlockPinned: boolean;

  // ─── UI state ────────────────────────────
  /** Whether the help overlay is visible */
  showHelp: boolean;
  /** Sidebar width in columns (0 = hidden) */
  sidebarWidth: number;
  /** Full-doc scroll offset (line number) */
  docScrollOffset: number;
}

// ─── Keybinding Types ───────────────────────────────────────────────────────

export interface KeyBinding {
  key: string;
  description: string;
  category: 'playback' | 'navigation' | 'view' | 'speed';
}

export const KEY_BINDINGS: KeyBinding[] = [
  // Playback
  { key: 'Space',       description: 'Play / Pause',                      category: 'playback' },
  { key: '←',           description: 'Back one word (when paused)',       category: 'playback' },
  { key: '→',           description: 'Forward one word (when paused)',    category: 'playback' },

  // Speed
  { key: '] / +',       description: 'Increase WPM by 25',               category: 'speed' },
  { key: '[ / −',       description: 'Decrease WPM by 25',               category: 'speed' },
  { key: '} / Shift+]', description: 'Increase WPM by 100',              category: 'speed' },
  { key: '{ / Shift+[', description: 'Decrease WPM by 100',              category: 'speed' },

  // Navigation
  { key: '↑ / k',       description: 'Previous section',                 category: 'navigation' },
  { key: '↓ / j',       description: 'Next section',                     category: 'navigation' },
  { key: 'n',           description: 'Next visual block in section',     category: 'navigation' },
  { key: 'p',           description: 'Previous visual block in section', category: 'navigation' },
  { key: 'Home / g',    description: 'Jump to beginning',                category: 'navigation' },
  { key: 'End / G',     description: 'Jump to end',                      category: 'navigation' },

  // View
  { key: 'Tab',         description: 'Toggle RSVP / Document view',      category: 'view' },
  { key: 's',           description: 'Toggle sidebar',                   category: 'view' },
  { key: 'x',           description: 'Pin / unpin visual block',         category: 'view' },
  { key: '?',           description: 'Toggle help overlay',              category: 'view' },
  { key: 'q / Ctrl+C',  description: 'Quit',                             category: 'view' },
];

// ─── Constants ──────────────────────────────────────────────────────────────

export const DEFAULT_WPM = 300;
export const MIN_WPM = 50;
export const MAX_WPM = 1500;
export const WPM_STEP_SMALL = 25;
export const WPM_STEP_LARGE = 100;

/** Pause multipliers for smart pacing */
export const PAUSE = {
  NORMAL: 1.0,
  COMMA: 1.4,
  SEMICOLON: 1.5,
  SENTENCE_END: 2.0,
  PARAGRAPH_END: 2.5,
  HEADING: 1.8,
  LONG_WORD: 1.15,        // words > 8 chars
  VERY_LONG_WORD: 1.3,    // words > 12 chars
  INLINE_CODE: 1.4,
} as const;

/** Minimum sidebar width when visible */
export const SIDEBAR_MIN_WIDTH = 32;
/** Maximum sidebar width (fraction of terminal) */
export const SIDEBAR_MAX_FRACTION = 0.45;