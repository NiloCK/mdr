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

import React, { useMemo, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { highlight } from 'cli-highlight';
import { renderMermaidASCII } from 'beautiful-mermaid';
import type { Document, Section, Frame, Block } from '../types.js';

// ─── Props ──────────────────────────────────────────────────────────────────

interface FullDocViewerProps {
  /** The parsed document */
  doc: Document;
  /** Current scroll offset (line number, 0-based). Always honoured — sets internalScrollOffset when changed. */
  scrollOffset: number;
  /** Available width in columns */
  width: number;
  /** Available height in rows */
  height: number;
  /** ID of the currently active section (for highlighting) */
  activeSectionId: number;
  /** All flat sections for lookup */
  flatSections: Section[];
  /** Current RSVP frame index */
  currentFrameIndex?: number;
  /** Whether to use enriched rendering (syntax highlighting, mermaid) */
  enriched?: boolean;
  /** Whether to auto-scroll to keep the current frame visible */
  autoScroll?: boolean;
  /** Whether RSVP playback is active */
  playing?: boolean;
  /** Called whenever the effective (clamped) scroll offset changes, so the parent can stay in sync */
  onScrollChange?: (offset: number) => void;
}

// ─── Rendered Line Types ────────────────────────────────────────────────────

interface DocLine {
  text: string;
  type: 'heading' | 'prose' | 'code' | 'code-border' | 'list' | 'blockquote' | 'hr' | 'blank' | 'table';
  sectionId: number;
  blockId: number;
  headingDepth?: number;
  language?: string;
  lineNumber?: number;
  indent?: number;
  /** Range of frame indices covered by this line (inclusive) */
  frameStart?: number;
  /** Range of frame indices covered by this line (inclusive) */
  frameEnd?: number;
  /** Individual frames in this line (for precise highlighting) */
  frames?: Frame[];
  /** true when text contains ANSI escape codes */
  highlighted?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const FullDocViewer: React.FC<FullDocViewerProps> = ({
  doc,
  scrollOffset,
  width,
  height,
  activeSectionId,
  currentFrameIndex = -1,
  enriched = true,
  autoScroll = false,
  playing = false,
  onScrollChange,
}) => {
  const contentWidth = Math.max(10, width - 2);
  const viewportHeight = Math.max(1, height - 2);

  // ── Build all rendered lines from the document ─────────────
  const allLines = useMemo(
    () => buildDocLines(doc, contentWidth, enriched),
    [doc, contentWidth, enriched],
  );

  // ── Find the line containing the current frame ─────────────
  const currentLineIndex = useMemo(() => {
    if (currentFrameIndex < 0) return -1;
    return allLines.findIndex(
      (l) =>
        l.frameStart !== undefined &&
        l.frameEnd !== undefined &&
        currentFrameIndex >= l.frameStart &&
        currentFrameIndex <= l.frameEnd
    );
  }, [allLines, currentFrameIndex]);

  // ── Auto-scroll logic ──────────────────────────────────────
  const [internalScrollOffset, setInternalScrollOffset] = React.useState(0);
  const lastAutoFrameRef = useRef(currentFrameIndex);

  // Always sync internal offset when the external prop changes.
  // This lets manual scroll keys (PgUp/PgDn, Ctrl+Arrows) work even
  // while autoScroll is true (RSVP mode, paused).
  useEffect(() => {
    setInternalScrollOffset(scrollOffset);
  }, [scrollOffset]);

  // Auto-scroll to keep currentLineIndex in view
  useEffect(() => {
    if (autoScroll && currentLineIndex >= 0) {
      // Only force auto-scroll if the frame has actually moved,
      // allowing manual scrolling to persist while paused on a word.
      const frameMoved = currentFrameIndex !== lastAutoFrameRef.current;
      lastAutoFrameRef.current = currentFrameIndex;

      setInternalScrollOffset((prev) => {
        // If the frame moved, we MUST show it.
        // Otherwise, only auto-scroll if it's currently off-screen.
        const isOffScreen = currentLineIndex < prev || currentLineIndex >= prev + viewportHeight;
        
        if (frameMoved || isOffScreen) {
          if (currentLineIndex < prev) {
            return currentLineIndex;
          }
          if (currentLineIndex >= prev + viewportHeight) {
            return Math.max(0, currentLineIndex - Math.floor(viewportHeight / 2));
          }
        }
        return prev;
      });
    }
  }, [currentLineIndex, autoScroll, viewportHeight, currentFrameIndex]);

  // ── Clamp scroll offset ────────────────────────────────────
  const maxScroll = Math.max(0, allLines.length - viewportHeight);
  const clampedOffset = Math.max(0, Math.min(internalScrollOffset, maxScroll));

  // ── Report scroll changes back to parent ───────────────────
  // Keeps app.tsx's docScrollOffset in sync so that relative scroll
  // operations (PgUp/PgDn etc.) start from the correct base value.
  useEffect(() => {
    onScrollChange?.(clampedOffset);
  }, [clampedOffset, onScrollChange]);

  // ── Visible window ─────────────────────────────────────────
  const visibleLines = allLines.slice(clampedOffset, clampedOffset + viewportHeight);

  // ── Current word / block info ──────────────────────────────
  const currentFrame = currentFrameIndex >= 0 ? doc.frames[currentFrameIndex] : null;
  const currentBlockId = currentFrame?.blockId ?? -1;

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
              currentBlockId={currentBlockId}
              currentFrameIndex={currentFrameIndex}
              currentFrame={currentFrame}
              playing={playing}
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
  currentBlockId: number;
  currentFrameIndex: number;
  currentFrame: Frame | null;
  playing: boolean;
}> = ({
  line,
  maxWidth,
  activeSectionId,
  currentBlockId,
  currentFrameIndex,
  currentFrame,
  playing,
}) => {
  const isActiveSection = line.sectionId === activeSectionId;
  const isCurrentBlock = line.blockId === currentBlockId;
  const isCurrentLine =
    isCurrentBlock &&
    currentFrameIndex >= 0 &&
    line.frameStart !== undefined &&
    line.frameEnd !== undefined &&
    currentFrameIndex >= line.frameStart &&
    currentFrameIndex <= line.frameEnd;

  // Left margin indicator:
  // - Current block: double line
  // - Current line: solid block
  // - Active section: single line
  let marginChar = ' ';
  let marginColor: string | undefined = undefined;

  if (isCurrentLine && !playing) {
    marginChar = '█';
    marginColor = 'yellow';
  } else if (isCurrentBlock) {
    marginChar = '┃';
    marginColor = 'yellow';
  } else if (isActiveSection) {
    marginChar = '│';
    marginColor = 'gray';
  }

  const displayText = line.highlighted
    ? truncateAnsi(line.text, Math.max(1, maxWidth - 2))
    : truncate(line.text, Math.max(1, maxWidth - 2));

  // Word highlighting for prose
  const renderTextWithWordHighlight = (l: DocLine) => {
    if (!isCurrentLine || !currentFrame || !l.frames || playing) {
      return <Text dimColor={!isActiveSection}>{l.text}</Text>;
    }

    return (
      <Text>
        {l.frames.map((f, i) => {
          const isCurrentWord = f.index === currentFrameIndex;
          return (
            <React.Fragment key={f.index}>
              {i > 0 && <Text>{' '}</Text>}
              <Text
                bold={isCurrentWord}
                underline={isCurrentWord}
                color={isCurrentWord ? 'yellow' : undefined}
                dimColor={!isCurrentWord && !isActiveSection}
              >
                {f.word}
              </Text>
            </React.Fragment>
          );
        })}
      </Text>
    );
  };

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
      const isCurrentHeading = isCurrentLine;
      
      return (
        <Text>
          <Text color={marginColor}>{marginChar}</Text>
          <Text bold color={isCurrentHeading ? 'yellow' : color} underline={isCurrentHeading}>
            {displayText}
          </Text>
        </Text>
      );
    }

    case 'code': {
      const isHighlightedCode = isCurrentBlock;
      return (
        <Text>
          <Text color={marginColor}>{marginChar}</Text>
          <Text color={isHighlightedCode ? 'white' : 'green'}>
            {line.lineNumber != null ? (
              <Text dimColor={!isHighlightedCode} color={isHighlightedCode ? 'gray' : undefined}>
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
          <Text color="green" dimColor={!isCurrentBlock}>
            {displayText}
          </Text>
        </Text>
      );
    }

    case 'blockquote': {
      return (
        <Text>
          <Text color={marginColor}>{marginChar}</Text>
          <Text color="gray" italic dimColor={!isCurrentBlock}>
            {displayText}
          </Text>
        </Text>
      );
    }

    case 'list': {
      return (
        <Text>
          <Text color={marginColor}>{marginChar}</Text>
          <Text dimColor={!isCurrentBlock}>
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
          <Text color="blue" dimColor={!isCurrentBlock}>
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
          {renderTextWithWordHighlight(line)}
        </Text>
      );
    }
  }
};

// ─── Document Line Builder ──────────────────────────────────────────────────
//
// Walks the raw markdown source using the parsed section structure and
// produces an array of DocLine objects ready for rendering.

function buildDocLines(doc: Document, maxWidth: number, enriched: boolean): DocLine[] {
  const lines: DocLine[] = [];

  for (const block of doc.blocks) {
    const currentSectionId = block.sectionId;
    const currentBlockId = block.id;

    switch (block.type) {
      case 'heading': {
        const section = doc.flatSections.find((s) => s.id === block.sectionId);
        const depth = section?.level ?? 1;
        const prefix = '#'.repeat(depth) + ' ';

        lines.push({ text: '', type: 'blank', sectionId: currentSectionId, blockId: currentBlockId });
        lines.push({
          text: prefix + block.content,
          type: 'heading',
          sectionId: currentSectionId,
          blockId: currentBlockId,
          headingDepth: depth,
          frameStart: block.frameStart,
          frameEnd: block.frameEnd,
        });
        lines.push({ text: '', type: 'blank', sectionId: currentSectionId, blockId: currentBlockId });
        break;
      }

      case 'prose': {
        const blockFrames = doc.frames.slice(block.frameStart, block.frameEnd + 1);
        const wrapResult = wrapFrames(blockFrames, Math.max(10, maxWidth - 4));
        for (const wr of wrapResult) {
          lines.push({
            text: wr.text,
            type: 'prose',
            sectionId: currentSectionId,
            blockId: currentBlockId,
            frameStart: wr.frameStart,
            frameEnd: wr.frameEnd,
            frames: wr.frames,
          });
        }
        lines.push({ text: '', type: 'blank', sectionId: currentSectionId, blockId: currentBlockId });
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
          blockId: currentBlockId,
          language: block.language,
        });

        let displayLines: string[] = [];
        let highlighted = false;

        if (enriched) {
          if (block.type === 'code') {
            try {
              const ansi = highlight(block.content, {
                language: block.language,
                ignoreIllegals: true,
              });
              displayLines = ansi.split('\n');
              highlighted = true;
            } catch {
              displayLines = block.content.split('\n');
            }
          } else if (block.type === 'mermaid') {
            try {
              const ansi = renderMermaidASCII(block.content, { colorMode: 'ansi256' });
              displayLines = ansi.split('\n');
              highlighted = true;
            } catch {
              displayLines = block.content.split('\n');
            }
          }
        } else {
          displayLines = block.content.split('\n');
        }

        for (let i = 0; i < displayLines.length; i++) {
          const codeLine = displayLines[i] ?? '';
          lines.push({
            text: highlighted ? codeLine : expandTabs(codeLine),
            type: 'code',
            sectionId: currentSectionId,
            blockId: currentBlockId,
            language: block.language,
            lineNumber: i + 1,
            highlighted,
          });
        }

        lines.push({
          text: bottomBorder,
          type: 'code-border',
          sectionId: currentSectionId,
          blockId: currentBlockId,
        });
        lines.push({ text: '', type: 'blank', sectionId: currentSectionId, blockId: currentBlockId });
        break;
      }

      case 'list':
      case 'blockquote':
      case 'table':
      case 'hr':
      default: {
        // Simplified rendering for other types, similar to prose but without frame tracking for now
        // except where they actually generate frames (blockquote, table)
        const content = block.content || '';
        const wrapped = wordWrap(content, Math.max(10, maxWidth - 4));
        for (const wl of wrapped) {
          lines.push({
            text: wl,
            type: block.type === 'hr' ? 'hr' : 'prose',
            sectionId: currentSectionId,
            blockId: currentBlockId,
            frameStart: block.frameStart !== -1 ? block.frameStart : undefined,
            frameEnd: block.frameEnd !== -1 ? block.frameEnd : undefined,
          });
        }
        lines.push({ text: '', type: 'blank', sectionId: currentSectionId, blockId: currentBlockId });
        break;
      }
    }
  }

  return lines;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface WrappedLine {
  text: string;
  frameStart: number;
  frameEnd: number;
  frames: Frame[];
}

function wrapFrames(frames: Frame[], maxWidth: number): WrappedLine[] {
  if (frames.length === 0) return [];
  
  const lines: WrappedLine[] = [];
  let currentFrames: Frame[] = [];
  let currentLineLength = 0;

  for (const frame of frames) {
    const word = frame.word;
    if (currentFrames.length > 0 && currentLineLength + 1 + word.length > maxWidth) {
      lines.push({
        text: currentFrames.map(f => f.word).join(' '),
        frameStart: currentFrames[0]!.index,
        frameEnd: currentFrames[currentFrames.length - 1]!.index,
        frames: [...currentFrames],
      });
      currentFrames = [frame];
      currentLineLength = word.length;
    } else {
      currentFrames.push(frame);
      currentLineLength += (currentFrames.length === 1 ? 0 : 1) + word.length;
    }
  }

  if (currentFrames.length > 0) {
    lines.push({
      text: currentFrames.map(f => f.word).join(' '),
      frameStart: currentFrames[0]!.index,
      frameEnd: currentFrames[currentFrames.length - 1]!.index,
      frames: [...currentFrames],
    });
  }

  return lines;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Truncate an ANSI-escaped string to `maxWidth` visible characters, preserving escape codes. */
function truncateAnsi(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  let visible = 0;
  let i = 0;
  let result = '';
  while (i < text.length) {
    // Check for ANSI escape sequence
    if (text[i] === '\x1b' && text[i + 1] === '[') {
      const end = text.indexOf('m', i + 2);
      if (end !== -1) {
        result += text.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    if (visible >= maxWidth) break;
    result += text[i];
    visible++;
    i++;
  }
  if (ANSI_RE.test(text)) result += '\x1b[0m';
  return result;
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
  enriched: boolean = false,
): number {
  const allLines = buildDocLines(doc, contentWidth, enriched);
  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i]!;
    if (line.type === 'heading' && line.sectionId === sectionId) {
      return Math.max(0, i - 1);
    }
  }
  return 0;
}

export function totalDocLines(doc: Document, contentWidth: number, enriched: boolean = false): number {
  return buildDocLines(doc, contentWidth, enriched).length;
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