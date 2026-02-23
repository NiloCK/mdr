// ─── RSVP Context Strip ──────────────────────────────────────────────────────
//
// A compact strip showing the words surrounding the current RSVP position:
// a few words of before-context, the current word underlined, and after-context.
// The ORP focal display lives in the ToC sidebar; this component orients the
// reader within the sentence/paragraph without consuming much vertical space.

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { Frame } from '../types.js';

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
  /** Current section title for display — unused, kept for API compat */
  sectionTitle?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const RsvpViewer: React.FC<RsvpViewerProps> = ({
  frame,
  width,
  playing,
  context,
}) => {
  const viewWidth = Math.max(20, width);

  const statusChar = playing ? '▶' : '❚❚';

  // Build context line, truncating before/after to fit
  const contextLine = useMemo(() => {
    const beforeStr = context.before.join(' ');
    const afterStr = context.after.join(' ');

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

  if (!frame) {
    return (
      <Box width={viewWidth} justifyContent="center">
        <Text dimColor>No content  ·  Press ? for help</Text>
      </Box>
    );
  }

  return (
    <Box width={viewWidth} justifyContent="center" alignItems="center">
      <Text>
        <Text dimColor>{statusChar} </Text>
        <Text dimColor>{contextLine.before} </Text>
        <Text bold underline>{contextLine.current}</Text>
        <Text dimColor> {contextLine.after}</Text>
      </Text>
    </Box>
  );
};
