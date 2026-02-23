// ─── RSVP Viewer Component ──────────────────────────────────────────────────
//
// The core "speed reading" display: a single word flashed in place with the
// Optimal Recognition Point (ORP) letter highlighted in color.  Includes
// guide reticle marks above/below the focal column and a context line showing
// surrounding words for spatial orientation.

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { Frame } from '../types.js';
import { splitAtOrp } from '../orp.js';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface RsvpViewerProps {
  /** The current RSVP frame to display (null = nothing to show) */
  frame: Frame | null;
  /** Available width in columns for the viewer area */
  width: number;
  /** Available height in rows */
  height: number;
  /** Whether playback is currently active */
  playing: boolean;
  /** Words before/current/after for the context line */
  context: { before: string[]; current: string; after: string[] };
  /** Current section title for display */
  sectionTitle?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const RsvpViewer: React.FC<RsvpViewerProps> = ({
  frame,
  width,
  height,
  playing,
  context,
  sectionTitle,
}) => {
  const viewWidth = Math.max(20, width);
  const centerCol = Math.floor(viewWidth / 2);

  // ── Idle state (no frame) ──────────────────────────────────
  if (!frame) {
    return (
      <Box
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        width={viewWidth}
        height={Math.max(5, height)}
      >
        <Text dimColor>No content loaded</Text>
        <Text dimColor>Press ? for help</Text>
      </Box>
    );
  }

  // ── Compute ORP-aligned word parts ─────────────────────────
  const parts = splitAtOrp(frame.word, frame.orpIndex);

  // Padding so that the focal letter lands exactly at centerCol
  const leftPad = Math.max(0, centerCol - parts.offsetLeft);

  // ── Reticle guide lines ────────────────────────────────────
  const reticleTop = ' '.repeat(centerCol) + '▼';
  const reticleBot = ' '.repeat(centerCol) + '▲';

  // ── Context line ───────────────────────────────────────────
  const contextLine = useMemo(() => {
    const beforeStr = context.before.join(' ');
    const afterStr = context.after.join(' ');

    // Truncate before/after to fit within available width
    const currentLen = context.current.length;
    const maxSide = Math.floor((viewWidth - currentLen - 6) / 2);

    let before = beforeStr;
    let after = afterStr;

    if (before.length > maxSide) {
      before = '…' + before.slice(before.length - maxSide + 1);
    }
    if (after.length > maxSide) {
      after = after.slice(0, maxSide - 1) + '…';
    }

    return { before, current: context.current, after };
  }, [context, viewWidth]);

  // ── Section breadcrumb ─────────────────────────────────────
  const breadcrumb = sectionTitle
    ? truncate(`§ ${sectionTitle}`, viewWidth - 4)
    : '';

  // ── Determine word styling based on frame flags ────────────
  // The ORP focal letter is always red+bold.
  // The rest of the word inherits inline formatting from the frame.

  const wordColor = frame.heading
    ? 'cyan'
    : frame.inlineCode
      ? 'green'
      : undefined;

  const wordBold = frame.bold || frame.heading;
  const wordItalic = frame.italic;
  const wordDim = false;

  // Inline code gets a visual bracket wrapper
  const codeLeft = frame.inlineCode ? '‹' : '';
  const codeRight = frame.inlineCode ? '›' : '';

  // ── Status indicator ───────────────────────────────────────
  const statusChar = playing ? '▶' : '❚❚';

  // ── Vertical layout ────────────────────────────────────────
  // We render from top to bottom:
  //   1. Section breadcrumb (dimmed)
  //   2. Spacer
  //   3. Reticle top
  //   4. Word line
  //   5. Reticle bottom
  //   6. Spacer
  //   7. Context line
  //   8. Status indicator

  return (
    <Box
      flexDirection="column"
      width={viewWidth}
      height={Math.max(8, height)}
      alignItems="flex-start"
    >
      {/* Section breadcrumb */}
      <Box justifyContent="center" width={viewWidth}>
        <Text dimColor italic>
          {breadcrumb}
        </Text>
      </Box>

      {/* Spacer */}
      <Box flexGrow={1} />

      {/* Reticle top */}
      <Box>
        <Text dimColor color="gray">
          {truncate(reticleTop, viewWidth)}
        </Text>
      </Box>

      {/* ─── The Word ─── */}
      <Box>
        <Text>
          {/* Left padding to align ORP */}
          {' '.repeat(leftPad)}
          {/* Code bracket */}
          {codeLeft ? (
            <Text dimColor>{codeLeft}</Text>
          ) : null}
          {/* Before ORP */}
          <Text
            bold={wordBold}
            italic={wordItalic}
            dimColor={wordDim}
            color={wordColor}
          >
            {parts.before}
          </Text>
          {/* ORP focal letter */}
          <Text bold color="red">
            {parts.focal}
          </Text>
          {/* After ORP */}
          <Text
            bold={wordBold}
            italic={wordItalic}
            dimColor={wordDim}
            color={wordColor}
          >
            {parts.after}
          </Text>
          {/* Code bracket */}
          {codeRight ? (
            <Text dimColor>{codeRight}</Text>
          ) : null}
        </Text>
      </Box>

      {/* Reticle bottom */}
      <Box>
        <Text dimColor color="gray">
          {truncate(reticleBot, viewWidth)}
        </Text>
      </Box>

      {/* Spacer */}
      <Box flexGrow={1} />

      {/* Context line */}
      <Box justifyContent="center" width={viewWidth}>
        <Text>
          <Text dimColor>{contextLine.before} </Text>
          <Text bold underline>{contextLine.current}</Text>
          <Text dimColor> {contextLine.after}</Text>
        </Text>
      </Box>

      {/* Status indicator */}
      <Box justifyContent="center" width={viewWidth}>
        <Text dimColor>
          {statusChar}
        </Text>
      </Box>
    </Box>
  );
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function truncate(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 1) + '…';
}