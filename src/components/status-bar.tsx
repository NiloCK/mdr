// ─── Status Bar Component ───────────────────────────────────────────────────
//
// A single-line status bar at the bottom of the TUI showing key information
// at a glance: play/pause state, current WPM, active section name, word
// position, visual progress bar, estimated time remaining, and view mode.

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { ViewMode } from '../types.js';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface StatusBarProps {
  /** Whether RSVP playback is active */
  playing: boolean;
  /** Current words per minute */
  wpm: number;
  /** Current frame index (0-based) */
  frameIndex: number;
  /** Total number of frames */
  totalFrames: number;
  /** Progress as a fraction 0–1 */
  progress: number;
  /** Estimated time remaining in seconds */
  timeRemainingSeconds: number;
  /** Name of the currently active section */
  sectionTitle: string;
  /** Current view mode */
  mode: ViewMode;
  /** Available width in columns */
  width: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const StatusBar: React.FC<StatusBarProps> = ({
  playing,
  wpm,
  frameIndex,
  totalFrames,
  progress,
  timeRemainingSeconds,
  sectionTitle,
  mode,
  width,
}) => {
  // ── Build status segments ──────────────────────────────────

  // Play/pause indicator
  const playIndicator = playing ? '▶' : '❚❚';

  // Mode indicator
  const modeLabel = mode === 'rsvp' ? 'RSVP' : 'DOC';

  // WPM display
  const wpmStr = `${wpm} wpm`;

  // Word position
  const posStr = `${frameIndex + 1}/${totalFrames}`;

  // Time remaining
  const timeStr = useMemo(() => {
    if (timeRemainingSeconds <= 0) return '0:00';
    const mins = Math.floor(timeRemainingSeconds / 60);
    const secs = Math.floor(timeRemainingSeconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, [timeRemainingSeconds]);

  // Section name (truncated to fit)
  const fixedPartsWidth =
    playIndicator.length + 1 +      // "▶ "
    modeLabel.length + 3 +           // "RSVP │ "
    wpmStr.length + 3 +              // "300 wpm │ "
    posStr.length + 3 +              // "42/892 │ "
    timeStr.length + 3 +             // "2:15 │ "
    20;                              // progress bar min + padding

  const sectionMaxWidth = Math.max(5, width - fixedPartsWidth);
  const sectionStr = truncate(sectionTitle || '—', sectionMaxWidth);

  // ── Progress bar ───────────────────────────────────────────
  const progressBarWidth = useMemo(() => {
    // Use whatever width remains after all other segments
    const usedWidth =
      playIndicator.length + 1 +
      modeLabel.length + 3 +
      wpmStr.length + 3 +
      sectionStr.length + 3 +
      posStr.length + 3 +
      timeStr.length +
      6; // separators and padding
    return Math.max(8, width - usedWidth);
  }, [width, playIndicator, modeLabel, wpmStr, sectionStr, posStr, timeStr]);

  const filledWidth = Math.round(progress * progressBarWidth);
  const emptyWidth = Math.max(0, progressBarWidth - filledWidth);
  const progressBar = '█'.repeat(filledWidth) + '░'.repeat(emptyWidth);

  // ── Percentage ─────────────────────────────────────────────
  const pctStr = `${Math.round(progress * 100)}%`;

  // ── Render ─────────────────────────────────────────────────

  return (
    <Box width={width} height={1}>
      <Text>
        {/* Play/Pause indicator */}
        <Text color={playing ? 'green' : 'yellow'} bold>
          {playIndicator}
        </Text>
        <Text dimColor> │ </Text>

        {/* Mode */}
        <Text color={mode === 'rsvp' ? 'cyan' : 'blue'} bold>
          {modeLabel}
        </Text>
        <Text dimColor> │ </Text>

        {/* WPM */}
        <Text color="white" bold>
          {wpmStr}
        </Text>
        <Text dimColor> │ </Text>

        {/* Section name */}
        <Text color="yellow">
          {sectionStr}
        </Text>
        <Text dimColor> │ </Text>

        {/* Word position */}
        <Text dimColor>
          {posStr}
        </Text>
        <Text dimColor> │ </Text>

        {/* Progress bar */}
        <Text color="green">
          {progressBar}
        </Text>
        <Text dimColor> </Text>

        {/* Percentage */}
        <Text dimColor>
          {pctStr.padStart(4)}
        </Text>
        <Text dimColor> │ </Text>

        {/* Time remaining */}
        <Text dimColor>
          {timeStr}
        </Text>
      </Text>
    </Box>
  );
};

// ─── Compact Status Bar ─────────────────────────────────────────────────────
//
// A minimal version for very narrow terminals (< 60 cols).

export const StatusBarCompact: React.FC<StatusBarProps> = ({
  playing,
  wpm,
  progress,
  mode,
  width,
}) => {
  const playIndicator = playing ? '▶' : '❚❚';
  const modeLabel = mode === 'rsvp' ? 'R' : 'D';
  const pctStr = `${Math.round(progress * 100)}%`;

  const barWidth = Math.max(4, width - 16);
  const filled = Math.round(progress * barWidth);
  const empty = Math.max(0, barWidth - filled);
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  return (
    <Box width={width} height={1}>
      <Text>
        <Text color={playing ? 'green' : 'yellow'}>{playIndicator}</Text>
        <Text dimColor> </Text>
        <Text bold>{modeLabel}</Text>
        <Text dimColor> </Text>
        <Text bold>{wpm}</Text>
        <Text dimColor> </Text>
        <Text color="green">{bar}</Text>
        <Text dimColor> {pctStr}</Text>
      </Text>
    </Box>
  );
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function truncate(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 1) + '…';
}