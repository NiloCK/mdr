// ─── Markdown → Document Parser ─────────────────────────────────────────────
//
// Converts a markdown string into the structured Document model used by the
// RSVP engine and all UI components.
//
// Pipeline:
//   1. marked.lexer(md) → Token[]
//   2. Walk tokens to build Section tree + Block list
//   3. For prose/heading blocks, extract inline tokens → Frame[]
//   4. Attach frame ranges to sections and blocks
//   5. Collect visual blocks (code, mermaid, tables)

import { marked, type Token, type Tokens } from 'marked';
import {
  type Document,
  type Section,
  type Block,
  type BlockType,
  type Frame,
  type VisualBlock,
} from './types.js';
import { getOrpIndex, computePauseMultiplier } from './orp.js';

// ─── Public API ─────────────────────────────────────────────────────────────

export function parseDocument(markdown: string): Document {
  const tokens = marked.lexer(markdown);
  const ctx = new ParseContext(markdown);
  ctx.walkTopLevel(tokens);
  ctx.finalize();
  return ctx.toDocument();
}

/**
 * Collect all visual (non-prose) blocks from a document — these are
 * the blocks shown in the block-viewer pane.
 */
export function collectVisualBlocks(doc: Document): VisualBlock[] {
  const out: VisualBlock[] = [];
  for (const block of doc.blocks) {
    if (block.type === 'code' || block.type === 'mermaid' || block.type === 'table' || block.type === 'list') {
      out.push({
        blockId: block.id,
        sectionId: block.sectionId,
        type: block.type,
        language: block.language,
        content: block.content,
      });
    }
  }
  return out;
}

/**
 * Get visual blocks that belong to a specific section.
 */
export function visualBlocksForSection(
  visualBlocks: VisualBlock[],
  sectionId: number,
): VisualBlock[] {
  return visualBlocks.filter((vb) => vb.sectionId === sectionId);
}

/**
 * Find the "relevant" visual block for the current RSVP position:
 *   - If the current section has visual blocks, prefer the next upcoming one
 *     (look-ahead), or the most recent one if we're past all of them.
 *   - Falls back to null if the section has no visual blocks.
 */
export function relevantVisualBlock(
  doc: Document,
  visualBlocks: VisualBlock[],
  frameIndex: number,
): VisualBlock | null {
  if (visualBlocks.length === 0) return null;

  const frame = doc.frames[frameIndex];
  if (!frame) return null;

  const sectionBlocks = visualBlocksForSection(visualBlocks, frame.sectionId);
  if (sectionBlocks.length === 0) return null;

  // Find the first visual block whose underlying Block starts after the
  // current frame index — that's our "look-ahead" block.
  for (const vb of sectionBlocks) {
    const block = doc.blocks.find((b) => b.id === vb.blockId);
    if (block && block.frameStart >= frameIndex) {
      return vb;
    }
  }

  // Past all blocks in this section — show the last one.
  return sectionBlocks[sectionBlocks.length - 1]!;
}

/**
 * Simple terminal-friendly rendering of the full document.
 * Returns an array of lines.
 */
export function renderDocumentLines(doc: Document): string[] {
  const lines: string[] = [];
  const tokens = marked.lexer(doc.source);

  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const t = token as Tokens.Heading;
        lines.push('');
        lines.push('#'.repeat(t.depth) + ' ' + t.text);
        lines.push('');
        break;
      }
      case 'paragraph': {
        const t = token as Tokens.Paragraph;
        // Wrap text at ~78 cols
        const words = t.text.split(/\s+/);
        let line = '';
        for (const w of words) {
          if (line.length + w.length + 1 > 78) {
            lines.push(line);
            line = w;
          } else {
            line = line ? line + ' ' + w : w;
          }
        }
        if (line) lines.push(line);
        lines.push('');
        break;
      }
      case 'code': {
        const t = token as Tokens.Code;
        const lang = t.lang ? ` [${t.lang}]` : '';
        lines.push(`┌─ code${lang} ${'─'.repeat(Math.max(0, 60 - 8 - lang.length))}┐`);
        for (const cl of t.text.split('\n')) {
          lines.push('│ ' + cl);
        }
        lines.push('└' + '─'.repeat(61) + '┘');
        lines.push('');
        break;
      }
      case 'list': {
        const t = token as Tokens.List;
        for (let i = 0; i < t.items.length; i++) {
          const bullet = t.ordered ? `${i + 1}.` : '•';
          lines.push(`  ${bullet} ${t.items[i]!.text}`);
        }
        lines.push('');
        break;
      }
      case 'blockquote': {
        const t = token as Tokens.Blockquote;
        const inner = t.text.split('\n');
        for (const l of inner) {
          lines.push('  │ ' + l);
        }
        lines.push('');
        break;
      }
      case 'hr': {
        lines.push('─'.repeat(62));
        lines.push('');
        break;
      }
      case 'table': {
        const t = token as Tokens.Table;
        // Simple table rendering
        const headers = t.header.map((h) => h.text);
        lines.push('| ' + headers.join(' | ') + ' |');
        lines.push('|' + headers.map(() => '---').join('|') + '|');
        for (const row of t.rows) {
          lines.push('| ' + row.map((cell) => cell.text).join(' | ') + ' |');
        }
        lines.push('');
        break;
      }
      case 'space':
        break;
      default:
        if ('text' in token && typeof token.text === 'string') {
          lines.push(token.text);
          lines.push('');
        }
    }
  }
  return lines;
}

// ─── Internal Parse Context ─────────────────────────────────────────────────

interface InlineFormatting {
  bold: boolean;
  italic: boolean;
  inlineCode: boolean;
  heading: boolean;
  headingDepth: number;
}

const DEFAULT_FMT: InlineFormatting = {
  bold: false,
  italic: false,
  inlineCode: false,
  heading: false,
  headingDepth: 0,
};

class ParseContext {
  source: string;

  sections: Section[] = [];
  flatSections: Section[] = [];
  blocks: Block[] = [];
  frames: Frame[] = [];

  private nextSectionId = 0;
  private nextBlockId = 0;

  // Stack of open sections (for nesting headings).
  // sectionStack[i] is the most-recently-opened section at depth i+1.
  private sectionStack: Section[] = [];

  // The "implicit" section for content that appears before any heading.
  private preambleSection: Section;

  constructor(source: string) {
    this.source = source;
    // Create a virtual "preamble" section for content before the first heading.
    this.preambleSection = this.makeSection(0, '(preamble)', -1);
  }

  // ── Section management ──────────────────────────────────

  private makeSection(level: number, title: string, parentId: number): Section {
    const s: Section = {
      id: this.nextSectionId++,
      level,
      title,
      children: [],
      parentId,
      blockIds: [],
      frameStart: -1,
      frameEnd: -1,
    };
    this.flatSections.push(s);
    return s;
  }

  private currentSection(): Section {
    return this.sectionStack.length > 0
      ? this.sectionStack[this.sectionStack.length - 1]!
      : this.preambleSection;
  }

  /**
   * Open a new section for a heading at `level`.
   * Pops any sections on the stack that are at the same or deeper level.
   */
  private openSection(level: number, title: string): Section {
    // Pop sections >= this level
    while (
      this.sectionStack.length > 0 &&
      this.sectionStack[this.sectionStack.length - 1]!.level >= level
    ) {
      this.sectionStack.pop();
    }

    const parent = this.currentSection();
    const section = this.makeSection(level, title, parent.id);

    if (this.sectionStack.length === 0 && parent === this.preambleSection) {
      // Top-level section
      this.sections.push(section);
    } else if (parent !== this.preambleSection) {
      parent.children.push(section);
    } else {
      this.sections.push(section);
    }

    this.sectionStack.push(section);
    return section;
  }

  // ── Block management ────────────────────────────────────

  private addBlock(type: BlockType, content: string, language?: string): Block {
    const section = this.currentSection();
    const block: Block = {
      id: this.nextBlockId++,
      type,
      sectionId: section.id,
      content,
      language,
      frameStart: this.frames.length,
      frameEnd: -1,
    };
    this.blocks.push(block);
    section.blockIds.push(block.id);
    return block;
  }

  // ── Frame management ────────────────────────────────────

  private addFrame(
    word: string,
    blockId: number,
    sectionId: number,
    fmt: InlineFormatting,
    isEndOfParagraph: boolean = false,
    listInfo?: { type: 'bullet' | 'ordered'; index: number; depth: number },
  ): void {
    if (!word || word.trim().length === 0) return;

    const trimmed = word.trim();
    const frame: Frame = {
      index: this.frames.length,
      word: trimmed,
      sectionId,
      blockId,
      orpIndex: getOrpIndex(trimmed),
      bold: fmt.bold,
      italic: fmt.italic,
      inlineCode: fmt.inlineCode,
      heading: fmt.heading,
      headingDepth: fmt.headingDepth,
      isListItem: !!listInfo,
      listType: listInfo?.type,
      listItemIndex: listInfo?.index,
      listDepth: listInfo?.depth,
      pauseMultiplier: computePauseMultiplier(trimmed, {
        isHeading: fmt.heading,
        isInlineCode: fmt.inlineCode,
        isEndOfParagraph,
      }),
    };
    this.frames.push(frame);
  }

  // ── Inline token walking (recursive) ───────────────────

  private walkInlineTokens(
    tokens: Token[] | undefined,
    blockId: number,
    sectionId: number,
    fmt: InlineFormatting,
    listInfo?: { type: 'bullet' | 'ordered'; index: number; depth: number },
  ): void {
    if (!tokens) return;

    for (const token of tokens) {
      switch (token.type) {
        case 'text': {
          const t = token as Tokens.Text;
          // Text may contain nested tokens (marked sometimes nests em/strong inside text)
          if (t.tokens && t.tokens.length > 0) {
            this.walkInlineTokens(t.tokens, blockId, sectionId, fmt, listInfo);
          } else {
            const rawText = t.text ?? (t as any).raw ?? '';
            const words = rawText.split(/\s+/).filter((w: string) => w.length > 0);
            for (const w of words) {
              this.addFrame(w, blockId, sectionId, fmt, false, listInfo);
            }
          }
          break;
        }

        case 'strong': {
          const t = token as Tokens.Strong;
          this.walkInlineTokens(
            t.tokens,
            blockId,
            sectionId,
            { ...fmt, bold: true },
            listInfo,
          );
          break;
        }

        case 'em': {
          const t = token as Tokens.Em;
          this.walkInlineTokens(
            t.tokens,
            blockId,
            sectionId,
            { ...fmt, italic: true },
            listInfo,
          );
          break;
        }

        case 'codespan': {
          const t = token as Tokens.Codespan;
          // Keep inline code as a single frame — don't split on spaces
          // (e.g. `foo bar` stays as one unit)
          this.addFrame(t.text, blockId, sectionId, { ...fmt, inlineCode: true }, false, listInfo);
          break;
        }

        case 'link': {
          const t = token as Tokens.Link;
          // Walk the link's display text as normal inline content
          this.walkInlineTokens(t.tokens, blockId, sectionId, fmt, listInfo);
          break;
        }

        case 'image': {
          const t = token as Tokens.Image;
          // Flash the alt text
          if (t.text) {
            const words = t.text.split(/\s+/).filter((w: string) => w.length > 0);
            for (const w of words) {
              this.addFrame(w, blockId, sectionId, { ...fmt, italic: true }, false, listInfo);
            }
          }
          break;
        }

        case 'br': {
          // Treat <br> as a paragraph-end pause on the previous frame
          if (this.frames.length > 0) {
            this.frames[this.frames.length - 1]!.pauseMultiplier = Math.max(
              this.frames[this.frames.length - 1]!.pauseMultiplier,
              2.0,
            );
          }
          break;
        }

        case 'del': {
          // Strikethrough — walk children with italic styling as visual hint
          const t = token as Tokens.Del;
          this.walkInlineTokens(t.tokens, blockId, sectionId, { ...fmt, italic: true }, listInfo);
          break;
        }

        case 'escape': {
          const t = token as Tokens.Escape;
          if (t.text) {
            this.addFrame(t.text, blockId, sectionId, fmt, false, listInfo);
          }
          break;
        }

        default: {
          // Fallback: if the token has a `text` property, try to use it
          if ('text' in token && typeof token.text === 'string' && token.text.trim()) {
            const words = token.text.split(/\s+/).filter((w: string) => w.length > 0);
            for (const w of words) {
              this.addFrame(w, blockId, sectionId, fmt, false, listInfo);
            }
          }
          // If the token has sub-tokens, walk them
          if ('tokens' in token && Array.isArray(token.tokens)) {
            this.walkInlineTokens(token.tokens, blockId, sectionId, fmt, listInfo);
          }
          break;
        }
      }
    }
  }

  // ── Top-level token walking ─────────────────────────────

  private walkList(
    t: Tokens.List,
    blockId: number,
    sectionId: number,
    depth: number,
  ): void {
    const type = t.ordered ? 'ordered' : 'bullet';
    t.items.forEach((item, index) => {
      this.walkListItem(item, index, type, depth, blockId, sectionId);
    });
  }

  private walkListItem(
    item: Tokens.ListItem,
    index: number,
    type: 'bullet' | 'ordered',
    depth: number,
    blockId: number,
    sectionId: number,
  ): void {
    const listInfo = { type, index, depth };

    if (item.tokens) {
      for (const token of item.tokens) {
        if (token.type === 'text' || token.type === 'paragraph') {
          const t = token as Tokens.Text | Tokens.Paragraph;
          this.walkInlineTokens(t.tokens, blockId, sectionId, DEFAULT_FMT, listInfo);

          // End-of-item pause
          if (this.frames.length > 0) {
            this.frames[this.frames.length - 1]!.pauseMultiplier = Math.max(
              this.frames[this.frames.length - 1]!.pauseMultiplier,
              2.0,
            );
          }
        } else if (token.type === 'list') {
          this.walkList(token as Tokens.List, blockId, sectionId, depth + 1);
        }
      }
    }
  }

  walkTopLevel(tokens: Token[]): void {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      const isLast = i === tokens.length - 1;

      switch (token.type) {
        case 'heading': {
          const t = token as Tokens.Heading;
          const section = this.openSection(t.depth, t.text);

          // Create a heading block and emit frames for the heading words
          const block = this.addBlock('heading', t.text);
          const headingFmt: InlineFormatting = {
            ...DEFAULT_FMT,
            bold: true,
            heading: true,
            headingDepth: t.depth,
          };

          // Walk the heading's inline tokens if available, else split raw text
          if (t.tokens && t.tokens.length > 0) {
            this.walkInlineTokens(t.tokens, block.id, section.id, headingFmt);
          } else {
            const words = t.text.split(/\s+/).filter((w) => w.length > 0);
            for (const w of words) {
              this.addFrame(w, block.id, section.id, headingFmt);
            }
          }

          // Mark end-of-heading pause on the last frame
          if (this.frames.length > 0) {
            this.frames[this.frames.length - 1]!.pauseMultiplier = Math.max(
              this.frames[this.frames.length - 1]!.pauseMultiplier,
              2.5,
            );
          }

          block.frameEnd = this.frames.length - 1;
          break;
        }

        case 'paragraph': {
          const t = token as Tokens.Paragraph;
          const section = this.currentSection();
          const block = this.addBlock('prose', t.text ?? t.raw);

          this.walkInlineTokens(t.tokens, block.id, section.id, DEFAULT_FMT);

          // End-of-paragraph pause
          if (this.frames.length > 0) {
            this.frames[this.frames.length - 1]!.pauseMultiplier = Math.max(
              this.frames[this.frames.length - 1]!.pauseMultiplier,
              2.5,
            );
          }

          block.frameEnd = this.frames.length - 1;
          break;
        }

        case 'code': {
          const t = token as Tokens.Code;
          const isMermaid =
            t.lang?.toLowerCase() === 'mermaid' ||
            t.lang?.toLowerCase() === 'mmd';
          const blockType: BlockType = isMermaid ? 'mermaid' : 'code';
          const section = this.currentSection();
          const block = this.addBlock(blockType, t.text, t.lang || undefined);
          // Code/mermaid blocks are NOT part of the RSVP stream —
          // they appear in the block viewer as visual blocks.
          // However, we still set frameStart/End to the current position
          // so we can determine *when* in the RSVP flow this block appears.
          block.frameStart = this.frames.length;
          block.frameEnd = this.frames.length;
          break;
        }

        case 'list': {
          const t = token as Tokens.List;
          const section = this.currentSection();
          const block = this.addBlock('list', renderAsciiList(t));
          this.walkList(t, block.id, section.id, 0);
          block.frameEnd = this.frames.length - 1;
          break;
        }

        case 'blockquote': {
          const t = token as Tokens.Blockquote;
          const section = this.currentSection();
          const block = this.addBlock('blockquote', t.text ?? t.raw);

          // Walk blockquote inner tokens
          if (t.tokens && t.tokens.length > 0) {
            for (const innerToken of t.tokens) {
              if (innerToken.type === 'paragraph') {
                const ip = innerToken as Tokens.Paragraph;
                this.walkInlineTokens(ip.tokens, block.id, section.id, {
                  ...DEFAULT_FMT,
                  italic: true,
                });
              } else if ('tokens' in innerToken && Array.isArray(innerToken.tokens)) {
                this.walkInlineTokens(
                  innerToken.tokens,
                  block.id,
                  section.id,
                  { ...DEFAULT_FMT, italic: true },
                );
              }
            }
          }

          if (this.frames.length > 0) {
            this.frames[this.frames.length - 1]!.pauseMultiplier = Math.max(
              this.frames[this.frames.length - 1]!.pauseMultiplier,
              2.0,
            );
          }

          block.frameEnd = this.frames.length - 1;
          break;
        }

        case 'table': {
          const t = token as Tokens.Table;
          const section = this.currentSection();
          const block = this.addBlock('table', renderAsciiTable(t), undefined);

          // Read the header + rows into RSVP frames
          for (const headerCell of t.header) {
            if (headerCell.tokens) {
              this.walkInlineTokens(
                headerCell.tokens,
                block.id,
                section.id,
                { ...DEFAULT_FMT, bold: true },
              );
            }
          }
          for (const row of t.rows) {
            for (const cell of row) {
              if (cell.tokens) {
                this.walkInlineTokens(cell.tokens, block.id, section.id, DEFAULT_FMT);
              }
            }
          }

          if (this.frames.length > 0) {
            this.frames[this.frames.length - 1]!.pauseMultiplier = Math.max(
              this.frames[this.frames.length - 1]!.pauseMultiplier,
              2.0,
            );
          }

          block.frameEnd = this.frames.length - 1;
          break;
        }

        case 'hr': {
          const section = this.currentSection();
          const block = this.addBlock('hr', '---');
          block.frameEnd = this.frames.length - 1;
          // HR doesn't generate frames — it's a visual separator.
          // Add a pause to the previous frame if one exists.
          if (this.frames.length > 0) {
            this.frames[this.frames.length - 1]!.pauseMultiplier = Math.max(
              this.frames[this.frames.length - 1]!.pauseMultiplier,
              3.0,
            );
          }
          break;
        }

        case 'space':
          // Ignored
          break;

        case 'html': {
          // Attempt to extract text content from inline HTML
          const t = token as Tokens.HTML;
          const textContent = t.text.replace(/<[^>]*>/g, '').trim();
          if (textContent) {
            const section = this.currentSection();
            const block = this.addBlock('prose', textContent);
            const words = textContent.split(/\s+/).filter((w: string) => w.length > 0);
            for (const w of words) {
              this.addFrame(w, block.id, section.id, DEFAULT_FMT);
            }
            block.frameEnd = this.frames.length - 1;
          }
          break;
        }

        default: {
          // Fallback: try to extract text from unknown token types
          if ('text' in token && typeof token.text === 'string' && token.text.trim()) {
            const section = this.currentSection();
            const block = this.addBlock('prose', token.text);
            if ('tokens' in token && Array.isArray(token.tokens)) {
              this.walkInlineTokens(token.tokens, block.id, section.id, DEFAULT_FMT);
            } else {
              const words = token.text.split(/\s+/).filter((w: string) => w.length > 0);
              for (const w of words) {
                this.addFrame(w, block.id, section.id, DEFAULT_FMT);
              }
            }
            block.frameEnd = this.frames.length - 1;
          }
          break;
        }
      }
    }
  }

  // ── Finalize ────────────────────────────────────────────

  /**
   * After all tokens have been walked, compute section frame ranges
   * and clean up the preamble section.
   */
  finalize(): void {
    // Compute frame ranges for each section.
    // A section's frame range spans from its own first frame to the last
    // frame before the *next* section of the same or higher level starts.
    for (const section of this.flatSections) {
      // Find frames belonging to this section
      let start = Infinity;
      let end = -1;

      for (const frame of this.frames) {
        if (frame.sectionId === section.id) {
          if (frame.index < start) start = frame.index;
          if (frame.index > end) end = frame.index;
        }
      }

      // Also include frames from child sections
      const descendants = this.getDescendantIds(section);
      for (const frame of this.frames) {
        if (descendants.has(frame.sectionId)) {
          if (frame.index < start) start = frame.index;
          if (frame.index > end) end = frame.index;
        }
      }

      section.frameStart = start === Infinity ? -1 : start;
      section.frameEnd = end;
    }

    // If the preamble section has no frames or blocks, don't include it
    // in the top-level sections array.
    if (this.preambleSection.blockIds.length === 0) {
      // Remove from flatSections too
      this.flatSections = this.flatSections.filter(
        (s) => s.id !== this.preambleSection.id,
      );
    } else {
      // Add preamble to the beginning of sections
      this.sections.unshift(this.preambleSection);
    }
  }

  private getDescendantIds(section: Section): Set<number> {
    const ids = new Set<number>();
    const walk = (s: Section) => {
      for (const child of s.children) {
        ids.add(child.id);
        walk(child);
      }
    };
    walk(section);
    return ids;
  }

  toDocument(): Document {
    return {
      source: this.source,
      sections: this.sections,
      flatSections: this.flatSections,
      blocks: this.blocks,
      frames: this.frames,
    };
  }
}

// ─── Utility: Find which section a frame belongs to ─────────────────────────

/**
 * Given a frame index, find the section it belongs to.
 * Returns the section or the first section as fallback.
 */
export function sectionForFrame(doc: Document, frameIndex: number): Section | null {
  const frame = doc.frames[frameIndex];
  if (!frame) return doc.flatSections[0] ?? null;
  return doc.flatSections.find((s) => s.id === frame.sectionId) ?? doc.flatSections[0] ?? null;
}

/**
 * Find the "leaf" section for a frame — the deepest section in the hierarchy
 * that contains this frame.
 */
export function leafSectionForFrame(doc: Document, frameIndex: number): Section | null {
  const frame = doc.frames[frameIndex];
  if (!frame) return null;
  return doc.flatSections.find((s) => s.id === frame.sectionId) ?? null;
}

/**
 * Get the breadcrumb path for a section (e.g., "1. Intro > 1.2 Setup > 1.2.1 Config")
 */
export function sectionBreadcrumb(doc: Document, sectionId: number): string {
  const parts: string[] = [];
  let current = doc.flatSections.find((s) => s.id === sectionId);
  while (current) {
    parts.unshift(current.title);
    current =
      current.parentId >= 0
        ? doc.flatSections.find((s) => s.id === current!.parentId)
        : undefined;
  }
  return parts.join(' › ');
}

/**
 * Build a context string: a few words before and after the current frame.
 */
export function buildContext(
  doc: Document,
  frameIndex: number,
  windowSize: number = 5,
): { before: string[]; current: string; after: string[] } {
  const frame = doc.frames[frameIndex];
  if (!frame) {
    return { before: [], current: '', after: [] };
  }

  const before: string[] = [];
  const after: string[] = [];

  for (let i = Math.max(0, frameIndex - windowSize); i < frameIndex; i++) {
    before.push(doc.frames[i]!.word);
  }

  for (
    let i = frameIndex + 1;
    i <= Math.min(doc.frames.length - 1, frameIndex + windowSize);
    i++
  ) {
    after.push(doc.frames[i]!.word);
  }

  return { before, current: frame.word, after };
}

// ─── ASCII List Renderer ─────────────────────────────────────────────────────
//
// Converts a marked Tokens.List into a clean indented string.
// Ordered lists use "1." style; unordered use "•".
// Nested sub-lists are indented two spaces per level.

function renderAsciiList(t: Tokens.List): string {
  const lines: string[] = [];

  const renderItem = (item: Tokens.ListItem, index: number, ordered: boolean, depth: number) => {
    const indent = '  '.repeat(depth);
    const bullet = ordered ? `${index + 1}.` : '•';
    const text = extractListItemText(item);
    if (text) lines.push(`${indent}${bullet} ${text}`);

    // Recurse into nested sub-lists
    for (const sub of item.tokens ?? []) {
      if (sub.type === 'list') {
        const subList = sub as Tokens.List;
        subList.items.forEach((subItem, i) => renderItem(subItem, i, subList.ordered, depth + 1));
      }
    }
  };

  t.items.forEach((item, i) => renderItem(item, i, t.ordered, 0));
  return lines.join('\n');
}

function extractListItemText(item: Tokens.ListItem): string {
  let text = '';
  for (const token of item.tokens ?? []) {
    if (token.type === 'text') text += (token as Tokens.Text).text;
    else if (token.type === 'paragraph') text += (token as Tokens.Paragraph).text;
  }
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .trim();
}

// ─── ASCII Table Renderer ────────────────────────────────────────────────────
//
// Converts a marked Tokens.Table into a column-aligned string.
// Format (3 line types, detected by block-viewer for styling):
//
//   Line 0:   " Col1       │ Col2       │ Col3      "   ← header
//   Line 1:   "────────────┼────────────┼───────────"   ← separator (starts with ─)
//   Line 2+:  " val1       │ val2       │ val3      "   ← data rows

function renderAsciiTable(t: Tokens.Table): string {
  // Strip inline markdown from cell text
  const cellText = (cell: { text: string }): string =>
    cell.text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`(.+?)`/g, '$1').trim();

  const headers = t.header.map(cellText);
  const rows = t.rows.map((row) => row.map(cellText));

  // Compute max width per column
  const colWidths = headers.map((h, i) => {
    let max = h.length;
    for (const row of rows) {
      const cell = row[i] ?? '';
      if (cell.length > max) max = cell.length;
    }
    return max;
  });

  const renderRow = (cells: string[]): string =>
    ' ' + colWidths.map((w, i) => (cells[i] ?? '').padEnd(w)).join(' │ ') + ' ';

  const separator =
    colWidths.map((w) => '─'.repeat(w + 2)).join('┼');

  return [
    renderRow(headers),
    separator,
    ...rows.map(renderRow),
  ].join('\n');
}