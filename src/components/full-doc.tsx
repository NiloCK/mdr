// ─── Full Document Viewer Component ─────────────────────────────────────────
//
// Renders the entire markdown document in a scrollable, terminal-formatted
// view.  This is the "toggle" alternative to RSVP mode — activated with Tab.
//
// Features:
//   - Full rendered markdown with visual formatting (bold, italic, headers)
//   - Scroll position synced to the current RSVP frame position
//   - Keyboard scrolling (j/k, PgUp/PgDn when in doc mode)
//   - Current section highlighted in the text
//   - Code blocks rendered inline with border decoration

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { Document, Section } from '../types.js';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface FullDocViewerProps {
  /** The parsed document */
  doc: Document;
  /** Current scroll offset (line number, 0-based) */
  scrollOffset: number;
  /** Available width in columns */
  width: number;
  /** Available height in rows */
  height: number;
  /** ID of the currently active section (for highlighting) */
  activeSectionId: number;
  /** All flat sections for lookup */
  flatSections: Section[];
}

// ─── Rendered Line Types ────────────────────────────────────────────────────

interface DocLine {
  text: string;
  type: 'heading' | 'prose' | 'code' | 'code-border' | 'list' | 'blockquote' | 'hr' | 'blank' | 'table';
  sectionId: number;
  headingDepth?: number;
  language?: string;
  lineNumber?: number;
  indent?: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const FullDocViewer: React.FC<FullDocViewerProps> = ({
  doc,
  scrollOffset,
  width,
  height,
  activeSectionId,
  flatSections,
}) => {
  const contentWidth = Math.max(10, width - 2);
  const viewportHeight = Math.max(1, height - 2); // account for scroll indicators

  // ── Build all rendered lines from the document ─────────────
  const allLines = useMemo(
    () => buildDocLines(doc, contentWidth),
    [doc, contentWidth],
  );

  // ── Clamp scroll offset ────────────────────────────────────
  const maxScroll = Math.max(0, allLines.length - viewportHeight);
  const clampedOffset = Math.max(0, Math.min(scrollOffset, maxScroll));

  // ── Visible window ─────────────────────────────────────────
  const visibleLines = allLines.slice(clampedOffset, clampedOffset + viewportHeight);

  // ── Scroll position indicator ──────────────────────────────
  const scrollPct = allLines.length > viewportHeight
    ? Math.round((clampedOffset / maxScroll) * 100)
    : 100;
  const scrollIndicator = allLines.length > viewportHeight
    ? `─── ${scrollPct}% ─── (${clampedOffset + 1}–${Math.min(clampedOffset + viewportHeight, allLines.length)}/${allLines.length} lines) ───`
    : `─── ${allLines.length} lines ───`;

  // ── Scrollbar gutter ───────────────────────────────────────
  const showScrollbar = allLines.length > viewportHeight;
  const scrollbarHeight = viewportHeight;
  const thumbSize = Math.max(1, Math.round((viewportHeight / allLines.length) * scrollbarHeight));
  const thumbPos = Math.round((clampedOffset / Math.max(1, maxScroll)) * (scrollbarHeight - thumbSize));

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* Document lines */}
      <Box flexDirection="row" flexGrow={1}>
        {/* Content area */}
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {visibleLines.map((line, i) => (
            <DocLineComponent
              key={clampedOffset + i}
              line={line}
              maxWidth={showScrollbar ? contentWidth - 2 : contentWidth}
              activeSectionId={activeSectionId}
            />
          ))}
          {/* Fill remaining space if fewer lines than viewport */}
          {visibleLines.length < viewportHeight && (
            <Box flexGrow={1} />
          )}
        </Box>

        {/* Scrollbar gutter */}
        {showScrollbar && (
          <Box flexDirection="column" width={1}>
            {Array.from({ length: scrollbarHeight }).map((_, i) => {
              const isThumb = i >= thumbPos && i < thumbPos + thumbSize;
              return (
                <Text key={i} dimColor={!isThumb} color={isThumb ? 'cyan' : 'gray'}>
                  {isThumb ? '█' : '│'}
                </Text>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Scroll position indicator */}
      <Box justifyContent="center" width={width} height={1}>
        <Text dimColor>
          {truncate(scrollIndicator, width - 2)}
        </Text>
      </Box>
    </Box>
  );
};

// ─── Line Rendering Sub-component ───────────────────────────────────────────

const DocLineComponent: React.FC<{
  line: DocLine;
  maxWidth: number;
  activeSectionId: number;
}> = ({ line, maxWidth, activeSectionId }) => {
  const isActiveSection = line.sectionId === activeSectionId;

  // Left margin indicator for active section
  const marginChar = isActiveSection ? '▐' : ' ';
  const marginColor = isActiveSection ? 'yellow' : undefined;

  const displayText = truncate(line.text, Math.max(1, maxWidth - 2));

  switch (line.type) {
    case 'heading': {
      const headingColors: Record<number, string> = {
        1: 'cyan',
        2: 'cyan',
        3: 'blue',
        4: 'magenta',
        5: 'white',
        6: 'white',
      };
      const color = headingColors[line.headingDepth ?? 1] ?? 'cyan';
      return (
        <Text>
          <Text color={marginColor}>{marginChar}</Text>
          <Text bold color={color}>
            {displayText}
          </Text>
        </Text>
      );
    }

    case 'code': {
      return (
        <Text>
          <Text color={marginColor}>{marginChar}</Text>
          <Text color="green">
            {line.lineNumber != null ? (
              <Text dimColor>
                {String(line.lineNumber).padStart(3)} │{' '}
              </Text>
            ) : null}
            {displayText}
          </Text>
        </Text>
      );
    }

    case 'code-border': {
      return (
        <Text>
          <Text color={marginColor}>{marginChar}</Text>
          <Text color="green" dimColor>
            {displayText}
          </Text>
        </Text>
      );
    }

    case 'blockquote': {
      return (
        <Text>
          <Text color={marginColor}>{marginChar}</Text>
          <Text color="gray" italic>
            {displayText}
          </Text>
        </Text>
      );
    }

    case 'list': {
      return (
        <Text>
          <Text color={marginColor}>{marginChar}</Text>
          <Text>
            {displayText}
          </Text>
        </Text>
      );
    }

    case 'hr': {
      return (
        <Text>
          <Text color={marginColor}>{marginChar}</Text>
          <Text dimColor>
            {displayText}
          </Text>
        </Text>
      );
    }

    case 'blank': {
      return (
        <Text>
          <Text color={marginColor}>{marginChar}</Text>
        </Text>
      );
    }

    case 'table': {
      return (
        <Text>
          <Text color={marginColor}>{marginChar}</Text>
          <Text color="blue">
            {displayText}
          </Text>
        </Text>
      );
    }

    case 'prose':
    default: {
      return (
        <Text>
          <Text color={marginColor}>{marginChar}</Text>
          <Text
            bold={isActiveSection ? false : false}
            dimColor={!isActiveSection}
          >
            {displayText}
          </Text>
        </Text>
      );
    }
  }
};

// ─── Document Line Builder ──────────────────────────────────────────────────
//
// Walks the raw markdown source using the parsed section structure and
// produces an array of DocLine objects ready for rendering.

function buildDocLines(doc: Document, maxWidth: number): DocLine[] {
  const lines: DocLine[] = [];
  let currentSectionId = doc.flatSections.length > 0 ? doc.flatSections[0]!.id : 0;

  // Re-parse with marked.lexer to get the token stream
  // (we already have it in the parser, but we keep this self-contained)
  let sectionIndex = 0;

  // Walk blocks from the parsed document model
  for (const block of doc.blocks) {
    currentSectionId = block.sectionId;

    switch (block.type) {
      case 'heading': {
        // Determine heading depth from section info
        const section = doc.flatSections.find((s) => s.id === block.sectionId);
        const depth = section?.level ?? 1;
        const prefix = '#'.repeat(depth) + ' ';

        lines.push({ text: '', type: 'blank', sectionId: currentSectionId });
        lines.push({
          text: prefix + block.content,
          type: 'heading',
          sectionId: currentSectionId,
          headingDepth: depth,
        });
        lines.push({ text: '', type: 'blank', sectionId: currentSectionId });
        break;
      }

      case 'prose': {
        // Word-wrap prose content
        const wrapped = wordWrap(block.content, Math.max(10, maxWidth - 4));
        for (const wl of wrapped) {
          lines.push({
            text: wl,
            type: 'prose',
            sectionId: currentSectionId,
          });
        }
        lines.push({ text: '', type: 'blank', sectionId: currentSectionId });
        break;
      }

      case 'code':
      case 'mermaid': {
        const lang = block.language ?? (block.type === 'mermaid' ? 'mermaid' : '');
        const langLabel = lang ? ` ${lang} ` : ' ';
        const borderWidth = Math.max(10, Math.min(maxWidth - 4, 70));
        const topBorder = `┌─${langLabel}${'─'.repeat(Math.max(0, borderWidth - langLabel.length - 3))}┐`;
        const bottomBorder = `└${'─'.repeat(Math.max(0, borderWidth - 1))}┘`;

        lines.push({
          text: topBorder,
          type: 'code-border',
          sectionId: currentSectionId,
          language: block.language,
        });

        const codeLines = block.content.split('\n');
        for (let i = 0; i < codeLines.length; i++) {
          const codeLine = expandTabs(codeLines[i] ?? '');
          lines.push({
            text: codeLine,
            type: 'code',
            sectionId: currentSectionId,
            language: block.language,
            lineNumber: i + 1,
          });
        }

        lines.push({
          text: bottomBorder,
          type: 'code-border',
          sectionId: currentSectionId,
        });
        lines.push({ text: '', type: 'blank', sectionId: currentSectionId });
        break;
      }

      case 'list': {
        // Simple rendering: split raw content into lines
        const listLines = block.content.split('\n').filter((l) => l.trim().length > 0);
        for (const ll of listLines) {
          const trimmed = ll.trim();
          // Detect bullet vs ordered
          const bullet = /^\d+[.)]/.test(trimmed)
            ? trimmed
            : trimmed.replace(/^[-*+]\s*/, '  • ');
          const wrapped = wordWrap(bullet, Math.max(10, maxWidth - 6));
          for (let i = 0; i < wrapped.length; i++) {
            lines.push({
              text: (i === 0 ? '' : '    ') + wrapped[i]!,
              type: 'list',
              sectionId: currentSectionId,
            });
          }
        }
        lines.push({ text: '', type: 'blank', sectionId: currentSectionId });
        break;
      }

      case 'blockquote': {
        const bqLines = block.content.split('\n');
        for (const bql of bqLines) {
          const wrapped = wordWrap(bql.trim(), Math.max(10, maxWidth - 8));
          for (const wl of wrapped) {
            lines.push({
              text: '  │ ' + wl,
              type: 'blockquote',
              sectionId: currentSectionId,
            });
          }
        }
        lines.push({ text: '', type: 'blank', sectionId: currentSectionId });
        break;
      }

      case 'table': {
        const tableLines = block.content.split('\n');
        for (const tl of tableLines) {
          lines.push({
            text: tl,
            type: 'table',
            sectionId: currentSectionId,
          });
        }
        lines.push({ text: '', type: 'blank', sectionId: currentSectionId });
        break;
      }

      case 'hr': {
        lines.push({
          text: '─'.repeat(Math.min(maxWidth - 4, 62)),
          type: 'hr',
          sectionId: currentSectionId,
        });
        lines.push({ text: '', type: 'blank', sectionId: currentSectionId });
        break;
      }

      default: {
        // Fallback: render raw content as prose
        if (block.content.trim()) {
          const wrapped = wordWrap(block.content, Math.max(10, maxWidth - 4));
          for (const wl of wrapped) {
            lines.push({
              text: wl,
              type: 'prose',
              sectionId: currentSectionId,
            });
          }
          lines.push({ text: '', type: 'blank', sectionId: currentSectionId });
        }
        break;
      }
    }
  }

  return lines;
}

// ─── Utility: Find scroll offset for a given section ────────────────────────

/**
 * Given a document and a section ID, compute the line offset in the
 * rendered document where that section's heading starts.
 * Useful for syncing scroll position to RSVP position.
 */
export function scrollOffsetForSection(
  doc: Document,
  sectionId: number,
  contentWidth: number,
): number {
  const allLines = buildDocLines(doc, contentWidth);
  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i]!;
    if (line.type === 'heading' && line.sectionId === sectionId) {
      // Go one line before the heading (the blank line) so the heading
      // appears near the top, not clipped
      return Math.max(0, i - 1);
    }
  }
  return 0;
}

/**
 * Total number of rendered lines for the document.
 * Used by the parent to clamp scroll offset.
 */
export function totalDocLines(doc: Document, contentWidth: number): number {
  return buildDocLines(doc, contentWidth).length;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function wordWrap(text: string, maxWidth: number): string[] {
  if (!text || text.trim().length === 0) return [''];
  if (maxWidth <= 0) return [text];

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!word) continue;

    if (currentLine.length === 0) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= maxWidth) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
}

function truncate(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 1) + '…';
}

function expandTabs(line: string, tabWidth: number = 4): string {
  return line.replace(/\t/g, ' '.repeat(tabWidth));
}