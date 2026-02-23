// ─── Block Viewer Component ─────────────────────────────────────────────────
//
// Renders code blocks, mermaid diagrams, and other "visual" blocks in a
// dedicated pane.  Supports navigation between multiple blocks in the
// current section via tab indicators, syntax highlighting for code,
// and pinning to prevent auto-advance.

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { VisualBlock } from '../types.js';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface BlockViewerProps {
  /** The visual block to display (null = nothing to show) */
  block: VisualBlock | null;
  /** Total number of visual blocks in the current section */
  totalBlocks: number;
  /** Index of the currently displayed block within the section (0-based) */
  currentIndex: number;
  /** Whether the current block is pinned */
  pinned: boolean;
  /** Available width in columns */
  width: number;
  /** Available height in rows */
  height: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const BlockViewer: React.FC<BlockViewerProps> = ({
  block,
  totalBlocks,
  currentIndex,
  pinned,
  width,
  height,
}) => {
  const contentWidth = Math.max(10, width - 4); // account for borders + padding
  const contentHeight = Math.max(1, height - 4); // account for header + footer + borders

  // ── Empty state ────────────────────────────────────────────
  if (!block || totalBlocks === 0) {
    return (
      <Box
        flexDirection="column"
        width={width}
        height={height}
        borderStyle="single"
        borderColor="gray"
      >
        <Box paddingLeft={1}>
          <Text dimColor italic>No blocks in this section</Text>
        </Box>
        <Box flexGrow={1} />
        <Box paddingLeft={1}>
          <Text dimColor>{'n/p to browse all blocks'}</Text>
        </Box>
      </Box>
    );
  }

  // ── Header line ────────────────────────────────────────────
  const typeLabel = getTypeLabel(block);
  const langLabel = block.language ? ` [${block.language}]` : '';
  const pinIcon = pinned ? ' 📌' : '';
  const navHint = totalBlocks > 1
    ? ` (${currentIndex + 1}/${totalBlocks})`
    : '';
  const headerText = `${typeLabel}${langLabel}${navHint}${pinIcon}`;

  // ── Tab indicators ─────────────────────────────────────────
  const tabs = useMemo(() => {
    if (totalBlocks <= 1) return '';
    const parts: string[] = [];
    for (let i = 0; i < totalBlocks; i++) {
      parts.push(i === currentIndex ? '●' : '○');
    }
    return parts.join(' ');
  }, [totalBlocks, currentIndex]);

  // ── Render block content ───────────────────────────────────
  const renderedLines = useMemo(() => {
    return renderBlockContent(block, contentWidth, contentHeight);
  }, [block, contentWidth, contentHeight]);

  // ── Footer / hint line ─────────────────────────────────────
  const footerParts: string[] = [];
  if (totalBlocks > 1) {
    footerParts.push('n/p: nav blocks');
  }
  footerParts.push('x: pin');
  const footerText = footerParts.join('  │  ');

  // ── Border color based on type ─────────────────────────────
  const borderColor = block.type === 'mermaid'
    ? 'magenta'
    : block.type === 'code'
      ? 'green'
      : 'blue';

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="round"
      borderColor={borderColor}
    >
      {/* Header */}
      <Box paddingLeft={1} paddingRight={1} justifyContent="space-between">
        <Text bold color={borderColor}>
          {truncate(headerText, contentWidth - tabs.length - 2)}
        </Text>
        {tabs ? (
          <Text dimColor>{tabs}</Text>
        ) : null}
      </Box>

      {/* Content area */}
      <Box
        flexDirection="column"
        flexGrow={1}
        paddingLeft={1}
        paddingRight={1}
        overflow="hidden"
      >
        {renderedLines.map((line, i) => (
          <ContentLine
            key={i}
            line={line}
            maxWidth={contentWidth}
            blockType={block.type}
            language={block.language}
          />
        ))}
      </Box>

      {/* Footer */}
      <Box paddingLeft={1} paddingRight={1}>
        <Text dimColor>
          {truncate(footerText, contentWidth)}
        </Text>
      </Box>
    </Box>
  );
};

// ─── Content Line Sub-component ─────────────────────────────────────────────

interface ContentLineProps {
  line: RenderedLine;
  maxWidth: number;
  blockType: VisualBlock['type'];
  language?: string;
}

interface RenderedLine {
  text: string;
  lineNumber?: number;
  isOverflowIndicator?: boolean;
}

const ContentLine: React.FC<ContentLineProps> = ({
  line,
  maxWidth,
  blockType,
  language,
}) => {
  if (line.isOverflowIndicator) {
    return (
      <Text dimColor italic>
        {truncate(line.text, maxWidth)}
      </Text>
    );
  }

  // Line number gutter for code blocks
  const gutterWidth = line.lineNumber != null
    ? Math.max(3, String(line.lineNumber).length) + 2
    : 0;
  const gutterStr = line.lineNumber != null
    ? String(line.lineNumber).padStart(gutterWidth - 2) + ' │'
    : '';

  const codeWidth = Math.max(1, maxWidth - gutterWidth);
  const displayText = truncate(line.text, codeWidth);

  if (blockType === 'code') {
    return (
      <Text>
        {gutterStr ? (
          <Text dimColor color="gray">{gutterStr}</Text>
        ) : null}
        {' '}
        <Text color="white">{highlightCodeLine(displayText, language)}</Text>
      </Text>
    );
  }

  if (blockType === 'mermaid') {
    return (
      <Text>
        {gutterStr ? (
          <Text dimColor color="gray">{gutterStr}</Text>
        ) : null}
        {' '}
        <Text color="magenta">{displayText}</Text>
      </Text>
    );
  }

  // Table or other types
  return (
    <Text>
      {gutterStr ? (
        <Text dimColor color="gray">{gutterStr}</Text>
      ) : null}
      {' '}
      <Text>{displayText}</Text>
    </Text>
  );
};

// ─── Block Content Renderer ─────────────────────────────────────────────────

function renderBlockContent(
  block: VisualBlock,
  maxWidth: number,
  maxHeight: number,
): RenderedLine[] {
  const lines: RenderedLine[] = [];
  const sourceLines = block.content.split('\n');

  for (let i = 0; i < sourceLines.length; i++) {
    const raw = sourceLines[i] ?? '';

    // If the line is wider than the display, we could wrap or truncate.
    // For code, truncation is preferred (wrapping breaks indentation).
    // We handle truncation at render time, so store the full line here.
    lines.push({
      text: expandTabs(raw),
      lineNumber: block.type === 'code' || block.type === 'mermaid' ? i + 1 : undefined,
    });
  }

  // If there are more lines than fit vertically, truncate with an indicator
  if (lines.length > maxHeight) {
    const topHalf = Math.floor(maxHeight / 2) - 1;
    const bottomStart = lines.length - (maxHeight - topHalf - 1);
    const hidden = bottomStart - topHalf;

    const result: RenderedLine[] = [
      ...lines.slice(0, topHalf),
      {
        text: `  ⋮ ${hidden} lines hidden ⋮`,
        isOverflowIndicator: true,
      },
      ...lines.slice(bottomStart),
    ];
    return result;
  }

  return lines;
}

// ─── Lightweight Syntax Highlighting ────────────────────────────────────────
//
// Rather than pulling in a full highlight.js dependency, we do simple
// regex-based keyword highlighting that covers the common case for
// agent-authored code (JS/TS/Python/Go/Rust).
//
// This returns a Text element tree, but since Ink doesn't support
// nested Text with different colors in a straightforward way for
// dynamically-generated content, we return a plain string here and
// rely on the parent component's color prop for the base color.
// A future enhancement could use chalk to produce ANSI-styled strings.

function highlightCodeLine(line: string, language?: string): string {
  // For now, return the line as-is. The green/white base color from the
  // parent component provides sufficient visual distinction from prose.
  // Full syntax highlighting can be layered in via cli-highlight integration.
  return line;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getTypeLabel(block: VisualBlock): string {
  switch (block.type) {
    case 'code':
      return '◆ Code';
    case 'mermaid':
      return '◈ Diagram';
    case 'table':
      return '▦ Table';
    case 'ascii':
      return '▣ ASCII Art';
    default:
      return '■ Block';
  }
}

function truncate(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 1) + '…';
}

function expandTabs(line: string, tabWidth: number = 4): string {
  return line.replace(/\t/g, ' '.repeat(tabWidth));
}