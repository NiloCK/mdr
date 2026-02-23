// ─── RSVP Engine Hook ───────────────────────────────────────────────────────
//
// Manages the core playback loop: play/pause, word advancement with
// self-correcting setTimeout (not setInterval, to support variable per-frame
// delays from pause multipliers), speed control, and positional jumping.

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Frame } from '../types.js';
import { DEFAULT_WPM, MIN_WPM, MAX_WPM, WPM_STEP_SMALL, WPM_STEP_LARGE } from '../types.js';

export interface RsvpState {
  /** Current frame index into the frames array */
  frameIndex: number;
  /** Words per minute */
  wpm: number;
  /** Whether playback is active */
  playing: boolean;
  /** The current Frame object (or null if no frames) */
  currentFrame: Frame | null;
  /** Progress as a fraction 0–1 */
  progress: number;
  /** Estimated time remaining in seconds */
  timeRemainingSeconds: number;
}

export interface RsvpControls {
  togglePlay: () => void;
  play: () => void;
  pause: () => void;
  /** Step forward by `n` frames (default 1). Pauses playback. */
  stepForward: (n?: number) => void;
  /** Step backward by `n` frames (default 1). Pauses playback. */
  stepBackward: (n?: number) => void;
  /** Jump to an exact frame index. Does NOT pause automatically. */
  jumpTo: (index: number) => void;
  /** Jump to beginning. Pauses playback. */
  jumpToStart: () => void;
  /** Jump to end. Pauses playback. */
  jumpToEnd: () => void;
  /** Increase WPM by a small step */
  speedUp: () => void;
  /** Decrease WPM by a small step */
  speedDown: () => void;
  /** Increase WPM by a large step */
  speedUpLarge: () => void;
  /** Decrease WPM by a large step */
  speedDownLarge: () => void;
  /** Set WPM to an exact value (clamped) */
  setWpm: (wpm: number) => void;
}

export function useRsvp(
  frames: Frame[],
  initialWpm: number = DEFAULT_WPM,
): [RsvpState, RsvpControls] {
  const [frameIndex, setFrameIndex] = useState(() => {
    let i = 0;
    while (i < frames.length - 1 && frames[i]?.heading) i++;
    return i;
  });
  const [wpm, setWpmRaw] = useState(initialWpm);
  const [playing, setPlaying] = useState(false);

  // Use refs for values accessed inside the timer callback so we
  // don't restart the effect on every frame change.
  const frameIndexRef = useRef(frameIndex);
  const wpmRef = useRef(wpm);
  const playingRef = useRef(playing);
  const framesRef = useRef(frames);

  frameIndexRef.current = frameIndex;
  wpmRef.current = wpm;
  playingRef.current = playing;
  framesRef.current = frames;

  // ── Self-correcting timer ────────────────────────────────
  //
  // We use setTimeout (not setInterval) so each frame can have a
  // different delay based on its pauseMultiplier.  After each tick
  // we schedule the next one with the appropriate delay for the
  // *next* frame.

  useEffect(() => {
    if (!playing || frames.length === 0) return;

    const frame = frames[frameIndex];
    if (!frame) {
      setPlaying(false);
      return;
    }

    const baseDelayMs = 60_000 / wpm;
    const adjustedDelay = baseDelayMs * frame.pauseMultiplier;

    const timer = setTimeout(() => {
      setFrameIndex((prev) => {
        if (prev >= framesRef.current.length - 1) {
          setPlaying(false);
          return prev;
        }
        // Skip heading frames — ToC already surfaces section titles
        const raw = prev + 1;
        let next = raw;
        while (next < framesRef.current.length - 1 && framesRef.current[next]?.heading) {
          next++;
        }
        if (next >= framesRef.current.length) {
          setPlaying(false);
          return prev;
        }
        return next;
      });
    }, adjustedDelay);

    return () => clearTimeout(timer);
  }, [playing, frameIndex, wpm, frames]);

  // ── Heading-skip helper ──────────────────────────────────
  //
  // Returns the first non-heading frame at or after `idx`.
  // Heading text is surfaced by the ToC sidebar, so skipping it
  // here avoids redundancy in the ORP display.

  const skipHeadings = useCallback(
    (idx: number, direction: 1 | -1 = 1): number => {
      let i = idx;
      while (
        i >= 0 &&
        i < framesRef.current.length &&
        framesRef.current[i]?.heading
      ) {
        i += direction;
      }
      return Math.max(0, Math.min(i, framesRef.current.length - 1));
    },
    [],
  );

  // ── Clamp helper ─────────────────────────────────────────

  const clampIndex = useCallback(
    (idx: number): number => Math.max(0, Math.min(idx, frames.length - 1)),
    [frames.length],
  );

  const clampWpm = (w: number): number => Math.max(MIN_WPM, Math.min(MAX_WPM, w));

  // ── Controls ─────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      // If we're at the end and pressing play, restart from beginning
      if (!p && frameIndexRef.current >= framesRef.current.length - 1) {
        setFrameIndex(0);
      }
      return !p;
    });
  }, []);

  const play = useCallback(() => {
    if (frameIndexRef.current >= framesRef.current.length - 1) {
      setFrameIndex(0);
    }
    setPlaying(true);
  }, []);

  const pause = useCallback(() => {
    setPlaying(false);
  }, []);

  const stepForward = useCallback(
    (n: number = 1) => {
      setPlaying(false);
      setFrameIndex((prev) => skipHeadings(clampIndex(prev + n), 1));
    },
    [clampIndex, skipHeadings],
  );

  const stepBackward = useCallback(
    (n: number = 1) => {
      setPlaying(false);
      setFrameIndex((prev) => skipHeadings(clampIndex(prev - n), -1));
    },
    [clampIndex, skipHeadings],
  );

  const jumpTo = useCallback(
    (index: number) => {
      setFrameIndex(skipHeadings(clampIndex(index), 1));
    },
    [clampIndex, skipHeadings],
  );

  const jumpToStart = useCallback(() => {
    setPlaying(false);
    setFrameIndex(0);
  }, []);

  const jumpToEnd = useCallback(() => {
    setPlaying(false);
    setFrameIndex(Math.max(0, frames.length - 1));
  }, [frames.length]);

  const setWpm = useCallback((w: number) => {
    setWpmRaw(clampWpm(w));
  }, []);

  const speedUp = useCallback(() => {
    setWpmRaw((w) => clampWpm(w + WPM_STEP_SMALL));
  }, []);

  const speedDown = useCallback(() => {
    setWpmRaw((w) => clampWpm(w - WPM_STEP_SMALL));
  }, []);

  const speedUpLarge = useCallback(() => {
    setWpmRaw((w) => clampWpm(w + WPM_STEP_LARGE));
  }, []);

  const speedDownLarge = useCallback(() => {
    setWpmRaw((w) => clampWpm(w - WPM_STEP_LARGE));
  }, []);

  // ── Derived values ───────────────────────────────────────

  const currentFrame = frames[frameIndex] ?? null;

  const progress = frames.length > 1 ? frameIndex / (frames.length - 1) : 0;

  // Estimate remaining time: average pauseMultiplier over remaining frames
  // times base delay per word.
  const timeRemainingSeconds = (() => {
    if (frames.length === 0 || frameIndex >= frames.length - 1) return 0;
    const remaining = frames.length - 1 - frameIndex;
    const baseDelay = 60_000 / wpm; // ms per word at current wpm

    // Sample up to 200 frames ahead for average multiplier (avoid scanning thousands)
    const sampleEnd = Math.min(frames.length, frameIndex + 200);
    let totalMult = 0;
    let count = 0;
    for (let i = frameIndex; i < sampleEnd; i++) {
      totalMult += frames[i]!.pauseMultiplier;
      count++;
    }
    const avgMult = count > 0 ? totalMult / count : 1;

    return (remaining * baseDelay * avgMult) / 1000;
  })();

  // ── Return ───────────────────────────────────────────────

  const state: RsvpState = {
    frameIndex,
    wpm,
    playing,
    currentFrame,
    progress,
    timeRemainingSeconds,
  };

  const controls: RsvpControls = {
    togglePlay,
    play,
    pause,
    stepForward,
    stepBackward,
    jumpTo,
    jumpToStart,
    jumpToEnd,
    speedUp,
    speedDown,
    speedUpLarge,
    speedDownLarge,
    setWpm,
  };

  return [state, controls];
}