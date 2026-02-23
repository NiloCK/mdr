// ─── Table of Contents Sidebar ──────────────────────────────────────────────
//
// Renders a hierarchical, collapsible table of contents derived from the
// document's section tree.  The currently active section is highlighted,
// and the RSVP word is displayed inline below the active section title
// with ORP focal-letter alignment, reticle marks, and configurable padding.

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { Section, Frame } from '../types.js';
import { splitAtOrp } from '../orp.js';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface TocSidebarProps {
  /** Top-level sections (hierarchical tree) */
  sections: Section[];
  /** Flat list of all sections */
  flatSections: Section[];
  /** ID of the currently active section */
  activeSectionId: number;
  /** Available width in columns */
  width: number;
  /** Available height in rows */
  height: number;
  /** Current RSVP frame (for inline word display) */
  currentFrame: Frame | null;
  /** Surrounding words for context buffer below ORP word */
  context: { before: string[]; current: string; after: string[] };
  /** Whether RSVP playback is active — hides context text to reduce noise */
  playing: boolean;
  /** Empty lines above and below the RSVP word (default 1) */
  orpPadding?: number;
  /** Callback when a section is selected */
  onSelectSection?: (sectionId: number) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const TocSidebar: React.FC<TocSidebarProps> = ({
  sections,
  flatSections,
  activeSectionId,
  width,
  height,
  currentFrame,
  context,
  playing,
  orpPadding = 1,
}) => {
  const contentWidth = Math.max(1, width - 2);

  // How many rows the RSVP insert occupies (fixed):
  //   1 (padding above context) + 2 (context lines) + orpPadding + 3 (reticle+word+reticle) + orpPadding
  const orpBlockHeight = 1 + 2 + orpPadding * 2 + 3;

  // Build a list of lines to render, respecting collapsing rules.
  const lines = useMemo(() => {
    const result: TocLine[] = [];
    const ancestorIds = getAncestorIds(flatSections, activeSectionId);

    const walk = (sectionList: Section[], depth: number) => {
      for (const section of sectionList) {
        const isActive = section.id === activeSectionId;
        const isAncestor = ancestorIds.has(section.id);
        const isTopLevel = depth === 0;

        result.push({ section, depth, isActive, isAncestor });

        const shouldExpand = isActive || isAncestor || (isTopLevel && section.children.length > 0);

        if (shouldExpand && section.children.length > 0) {
          walk(section.children, depth + 1);
        } else if (section.children.length > 0 && !shouldExpand) {
          result.push({
            section: null,
            depth: depth + 1,
            isActive: false,
            isAncestor: false,
            collapsedCount: countDescendants(section),
          });
        }
      }
    };

    walk(sections, 0);
    return result;
  }, [sections, flatSections, activeSectionId]);

  // Scroll so the active section (+ ORP block below it) stays visible.
  const visibleLines = useMemo(() => {
    const headerRows = 1; // "◊ Contents" header
    const availableRows = Math.max(1, height - headerRows - orpBlockHeight);

    if (lines.length <= availableRows) return lines;

    const activeIdx = lines.findIndex((l) => l.isActive);
    if (activeIdx < 0) return lines.slice(0, availableRows);

    // Keep active line in the upper third so the ORP block below it is visible
    const preferredStart = Math.max(0, activeIdx - Math.floor(availableRows / 3));
    const start = Math.min(preferredStart, Math.max(0, lines.length - availableRows));
    return lines.slice(start, start + availableRows);
  }, [lines, height, orpBlockHeight]);

  // ── Render ────────────────────────────────────────────────

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="single"
      borderColor="gray"
    >
      {/* Header */}
      <Box paddingLeft={1} paddingRight={1}>
        <Text bold color="cyan">{'◊ Contents'}</Text>
      </Box>

      {/* Section lines, with ORP block injected after active line */}
      <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
        {visibleLines.map((line, i) => (
          <React.Fragment key={i}>
            <TocLineComponent line={line} maxWidth={contentWidth - 1} />
            {line.isActive && (
              <>
                <ContextBuffer
                  context={playing ? null : context}
                  width={contentWidth - 1}
                />
                <OrpBlock
                  frame={currentFrame}
                  width={contentWidth - 1}
                  padding={orpPadding}
                />
              </>
            )}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
};

// ─── ORP Block ───────────────────────────────────────────────────────────────
//
// Rendered immediately below the active section title.
// Layout (orpPadding=1):
//   <empty line>
//   <centered ▼ reticle>
//   <ORP-aligned word>
//   <centered ▲ reticle>
//   <empty line>

interface OrpBlockProps {
  frame: Frame | null;
  width: number;
  padding: number;
}

const OrpBlock: React.FC<OrpBlockProps> = ({ frame, width, padding }) => {
  const centerCol = Math.floor(width / 2);

  if (!frame) {
    // Show a dim placeholder when paused at doc start / no frame
    return (
      <>
        {Array.from({ length: padding }).map((_, i) => (
          <Text key={`pre-${i}`}>{' '}</Text>
        ))}
        <Box justifyContent="center" width={width}>
          <Text dimColor>· · ·</Text>
        </Box>
        {Array.from({ length: padding }).map((_, i) => (
          <Text key={`post-${i}`}>{' '}</Text>
        ))}
      </>
    );
  }

  const parts = splitAtOrp(frame.word, frame.orpIndex);
  const leftPad = Math.max(0, centerCol - parts.offsetLeft);

  const wordColor = frame.heading ? 'cyan' : frame.inlineCode ? 'green' : undefined;
  const wordBold = frame.bold || frame.heading;

  const reticle = ' '.repeat(centerCol) + '▼';
  const reticleBot = ' '.repeat(centerCol) + '▲';

  return (
    <>
      {Array.from({ length: padding }).map((_, i) => (
        <Text key={`pre-${i}`}>{' '}</Text>
      ))}

      {/* Reticle top */}
      <Text dimColor color="gray">{reticle}</Text>

      {/* Word with ORP alignment */}
      <Text>
        {' '.repeat(leftPad)}
        {frame.inlineCode ? <Text dimColor>‹</Text> : null}
        <Text bold={wordBold} italic={frame.italic} color={wordColor}>
          {parts.before}
        </Text>
        <Text bold color="red">{parts.focal}</Text>
        <Text bold={wordBold} italic={frame.italic} color={wordColor}>
          {parts.after}
        </Text>
        {frame.inlineCode ? <Text dimColor>›</Text> : null}
      </Text>

      {/* Reticle bottom */}
      <Text dimColor color="gray">{reticleBot}</Text>

      {Array.from({ length: padding }).map((_, i) => (
        <Text key={`post-${i}`}>{' '}</Text>
      ))}
    </>
  );
};

// ─── Context Buffer ──────────────────────────────────────────────────────────
//
// Fixed 2-line context display — no wrapping jitter.
//
//   Line 1 (dim):   …trailing before-words that fit
//   Line 2:         [current word underlined] trailing after-words that fit
//
// The current word is always the first token on line 2, giving it a stable
// anchor position for quick recovery glances.

interface ContextBufferProps {
  context: { before: string[]; current: string; after: string[] } | null;
  width: number;
}

const ContextBuffer: React.FC<ContextBufferProps> = ({ context, width }) => {
  // Always render exactly 2 lines + 1 padding row to hold layout stable.
  // When context is null (playing), render blank lines to suppress noise.
  const line1 = context ? buildTrailingLine(context.before, width) : '';
  const current = context?.current ?? '';
  const afterStr = context ? buildLeadingLine(context.after, width - current.length - 1) : '';

  return (
    <Box flexDirection="column" width={width} paddingTop={1}>
      <Box width={width}>
        <Text dimColor>{line1.padEnd(width)}</Text>
      </Box>
      <Box width={width}>
        {current ? <Text bold underline>{current}</Text> : <Text>{' '}</Text>}
        {afterStr ? <Text dimColor>{' ' + afterStr}</Text> : null}
      </Box>
    </Box>
  );
};

/** Build a string of trailing words from `words` that fits within `maxWidth`.
 *  Prepends '…' if words were trimmed. */
function buildTrailingLine(words: string[], maxWidth: number): string {
  if (words.length === 0) return '';
  const joined = words.join(' ');
  if (joined.length <= maxWidth) return joined;
  // Take as many words from the end as fit (with leading ellipsis)
  const budget = maxWidth - 1; // reserve 1 for '…'
  let result = '';
  for (let i = words.length - 1; i >= 0; i--) {
    const candidate = words.slice(i).join(' ');
    if (candidate.length <= budget) {
      result = candidate;
    } else {
      break;
    }
  }
  return result ? '…' + result : ('…' + joined.slice(joined.length - budget));
}

/** Build a string of leading words from `words` that fits within `maxWidth`. */
function buildLeadingLine(words: string[], maxWidth: number): string {
  if (words.length === 0 || maxWidth <= 0) return '';
  let result = '';
  for (const word of words) {
    const next = result ? result + ' ' + word : word;
    if (next.length > maxWidth) break;
    result = next;
  }
  return result;
}

// ─── ToC Line Sub-component ──────────────────────────────────────────────────

interface TocLine {
  section: Section | null;
  depth: number;
  isActive: boolean;
  isAncestor: boolean;
  collapsedCount?: number;
}

const TocLineComponent: React.FC<{ line: TocLine; maxWidth: number }> = ({
  line,
  maxWidth,
}) => {
  const indent = '  '.repeat(line.depth);

  if (line.collapsedCount != null) {
    const text = `${indent}  ⋯ (${line.collapsedCount} more)`;
    return <Text dimColor>{truncate(text, maxWidth)}</Text>;
  }

  if (!line.section) return null;

  const marker = line.isActive ? '▸ ' : line.isAncestor ? '▾ ' : '  ';
  const title = `${indent}${marker}${line.section.title}`;

  if (line.isActive) {
    return <Text bold color="yellow">{truncate(title, maxWidth)}</Text>;
  }

  if (line.isAncestor) {
    return <Text color="cyan">{truncate(title, maxWidth)}</Text>;
  }

  return <Text dimColor>{truncate(title, maxWidth)}</Text>;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getAncestorIds(flatSections: Section[], sectionId: number): Set<number> {
  const ids = new Set<number>();
  let current = flatSections.find((s) => s.id === sectionId);
  while (current && current.parentId >= 0) {
    ids.add(current.parentId);
    current = flatSections.find((s) => s.id === current!.parentId);
  }
  return ids;
}

function countDescendants(section: Section): number {
  let count = section.children.length;
  for (const child of section.children) {
    count += countDescendants(child);
  }
  return count;
}

function truncate(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 1) + '…';
}
