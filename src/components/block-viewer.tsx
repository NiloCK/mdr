// ─── Block Viewer Component ─────────────────────────────────────────────────
//
// Renders code blocks, mermaid diagrams, and other "visual" blocks in a
// dedicated pane.  Supports navigation between multiple blocks in the
// current section via tab indicators, syntax highlighting for code,
// and pinning to prevent auto-advance.

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { highlight } from 'cli-highlight';
import { renderMermaidASCII } from 'beautiful-mermaid';
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
        paddingTop={1}
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
  /** true when text already contains ANSI escape codes from cli-highlight */
  highlighted?: boolean;
  tableRole?: 'header' | 'separator' | 'row';
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
  // For ANSI-highlighted lines, measure visible length (strip escapes) but keep
  // the original string so colors are preserved. Only truncate if it's too long.
  const displayText = line.highlighted
    ? truncateAnsi(line.text, codeWidth)
    : truncate(line.text, codeWidth);

  if (blockType === 'code') {
    return (
      <Text>
        {gutterStr ? (
          <Text dimColor color="gray">{gutterStr}</Text>
        ) : null}
        {' '}
        {line.highlighted
          ? <Text>{displayText}</Text>
          : <Text color="white">{displayText}</Text>}
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

  if (blockType === 'table') {
    if (line.tableRole === 'header') {
      return <Text bold color="cyan">{displayText}</Text>;
    }
    if (line.tableRole === 'separator') {
      return <Text dimColor>{displayText}</Text>;
    }
    return <Text>{displayText}</Text>;
  }

  // Other types
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

  // Tables are pre-rendered at parse time; just annotate roles per line.
  if (block.type === 'table') {
    const rawLines = block.content.split('\n');
    for (let i = 0; i < rawLines.length; i++) {
      const text = expandTabs(rawLines[i] ?? '');
      const role: RenderedLine['tableRole'] =
        i === 0 ? 'header' : text.startsWith('─') ? 'separator' : 'row';
      lines.push({ text, tableRole: role });
    }
    return applyOverflow(lines, maxHeight);
  }

  // Pre-render the block content to ANSI lines where possible.
  // Falls back to plain source on any error.
  let highlightedLines: string[] | null = null;

  if (block.type === 'code') {
    try {
      const ansi = highlight(block.content, {
        language: block.language,
        ignoreIllegals: true,
      });
      highlightedLines = ansi.split('\n');
    } catch {
      // fallback to plain
    }
  } else if (block.type === 'mermaid') {
    try {
      const ansi = renderMermaidASCII(block.content, { colorMode: 'ansi256' });
      highlightedLines = ansi.split('\n');
    } catch {
      // fallback to raw source
    }
  }

  const sourceLines = block.content.split('\n');

  // For rendered mermaid, use the rendered lines directly (diagram replaces source).
  // For code, zip source line numbers with highlighted lines.
  const displayLines = (block.type === 'mermaid' && highlightedLines)
    ? highlightedLines
    : sourceLines;

  for (let i = 0; i < displayLines.length; i++) {
    const raw = displayLines[i] ?? '';
    const isRenderedMermaid = block.type === 'mermaid' && highlightedLines != null;

    lines.push({
      text: block.type === 'code' && highlightedLines
        ? (highlightedLines[i] ?? expandTabs(sourceLines[i] ?? ''))
        : expandTabs(raw),
      lineNumber: (block.type === 'code' || (block.type === 'mermaid' && !highlightedLines))
        ? i + 1
        : undefined,
      highlighted: highlightedLines != null,
    });
  }

  return applyOverflow(lines, maxHeight);
}

function applyOverflow(lines: RenderedLine[], maxHeight: number): RenderedLine[] {
  if (lines.length <= maxHeight) return lines;
  const topHalf = Math.floor(maxHeight / 2) - 1;
  const bottomStart = lines.length - (maxHeight - topHalf - 1);
  const hidden = bottomStart - topHalf;
  return [
    ...lines.slice(0, topHalf),
    { text: `  ⋮ ${hidden} lines hidden ⋮`, isOverflowIndicator: true },
    ...lines.slice(bottomStart),
  ];
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
  // Reset ANSI at end to avoid color bleed into gutter/next line
  if (ANSI_RE.test(text)) result += '\x1b[0m';
  return result;
}

function truncate(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 1) + '…';
}

function expandTabs(line: string, tabWidth: number = 4): string {
  return line.replace(/\t/g, ' '.repeat(tabWidth));
}