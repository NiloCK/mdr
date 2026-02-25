// ─── Main Application Component ─────────────────────────────────────────────
//
// Orchestrates the entire TUI: layout management, state wiring between the
// RSVP engine, document navigator, and all visual sub-components.  Handles
// all keyboard input and routes it to the appropriate controls.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';

import type { Document, ViewMode } from './types.js';
import { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_FRACTION, DEFAULT_WPM } from './types.js';
import { buildContext, sectionBreadcrumb } from './parser.js';
import { useRsvp } from './hooks/use-rsvp.js';
import { useDocument } from './hooks/use-document.js';

import { TocSidebar } from './components/toc-sidebar.js';
import { StatusBar, StatusBarCompact } from './components/status-bar.js';
import { FullDocViewer, scrollOffsetForSection, totalDocLines } from './components/full-doc.js';
import { HelpOverlay } from './components/help-overlay.js';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface AppProps {
  /** The parsed document to display */
  doc: Document;
  /** Initial words-per-minute */
  initialWpm?: number;
  /** Start playing immediately */
  autoPlay?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const App: React.FC<AppProps> = ({
  doc,
  initialWpm = DEFAULT_WPM,
  autoPlay = false,
}) => {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // ── Terminal dimensions ────────────────────────────────────
  const [termWidth, setTermWidth] = useState(stdout?.columns ?? 120);
  const [termHeight, setTermHeight] = useState(stdout?.rows ?? 40);

  useEffect(() => {
    if (!stdout) return;

    const handleResize = () => {
      setTermWidth(stdout.columns);
      setTermHeight(stdout.rows);
    };

    stdout.on('resize', handleResize);
    handleResize(); // initial read

    return () => {
      stdout.off('resize', handleResize);
    };
  }, [stdout]);

  // ── View mode ──────────────────────────────────────────────
  const [mode, setMode] = useState<ViewMode>('rsvp');
  const [showHelp, setShowHelp] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [enriched, setEnriched] = useState(true);

  // ── RSVP engine ────────────────────────────────────────────
  const [rsvpState, rsvpControls] = useRsvp(doc.frames, initialWpm);

  // Auto-play on mount if requested
  useEffect(() => {
    if (autoPlay && doc.frames.length > 0) {
      rsvpControls.play();
    }
  }, [autoPlay]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Document navigation ────────────────────────────────────
  const [docNav, docNavControls] = useDocument(doc);

  // ── Full-doc scroll state ──────────────────────────────────
  const [docScrollOffset, setDocScrollOffset] = useState(0);

  // ── Sync document navigation to RSVP position ─────────────
  useEffect(() => {
    docNavControls.syncToFrame(rsvpState.frameIndex);
  }, [rsvpState.frameIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync full-doc scroll when switching to doc mode or section changes ──
  useEffect(() => {
    if (mode === 'document') {
      const contentWidth = Math.max(10, mainWidth - 2);
      const offset = scrollOffsetForSection(doc, docNav.activeSectionId, contentWidth, enriched);
      setDocScrollOffset(offset);
    }
  }, [mode, docNav.activeSectionId, enriched]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Section-boundary pause ─────────────────────────────────
  // When the active section changes during playback, pause so the reader
  // can orient in the ToC before continuing with spacebar.
  const prevSectionIdRef = React.useRef(docNav.activeSectionId);
  useEffect(() => {
    if (
      docNav.activeSectionId !== prevSectionIdRef.current &&
      rsvpState.playing
    ) {
      rsvpControls.pause();
    }
    prevSectionIdRef.current = docNav.activeSectionId;
  }, [docNav.activeSectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Layout calculations ────────────────────────────────────
  const sidebarWidth = useMemo(() => {
    if (!showSidebar) return 0;
    const maxW = Math.floor(termWidth * SIDEBAR_MAX_FRACTION);
    return Math.max(SIDEBAR_MIN_WIDTH, Math.min(maxW, 52));
  }, [showSidebar, termWidth]);

  const mainWidth = termWidth - sidebarWidth;
  const statusBarHeight = 1;
  const mainHeight = termHeight - statusBarHeight;

  // ── Context for the RSVP viewer ────────────────────────────
  const context = useMemo(
    () => buildContext(doc, rsvpState.frameIndex, 6),
    [doc, rsvpState.frameIndex],
  );

  // ── Section title for display ──────────────────────────────
  const sectionTitle = useMemo(
    () => docNav.activeSection?.title ?? '',
    [docNav.activeSection],
  );

  const sectionBreadcrumbStr = useMemo(
    () => sectionBreadcrumb(doc, docNav.activeSectionId),
    [doc, docNav.activeSectionId],
  );

  // ── Keyboard input handler ─────────────────────────────────
  useInput((input, key) => {
    // ── Help overlay takes priority ──────────────────────────
    if (showHelp) {
      if (input === '?' || key.escape) {
        setShowHelp(false);
      }
      return;
    }

    // ── Global keybindings ───────────────────────────────────
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }

    if (input === '?') {
      setShowHelp(true);
      return;
    }

    // ── Tab: toggle enriched rendering ───────────────────────
    if (key.tab) {
      setEnriched((v) => !v);
      return;
    }

    // ── Sidebar toggle ───────────────────────────────────────
    if (input === 's' && !key.ctrl && !key.meta) {
      setShowSidebar((v) => !v);
      return;
    }

    // ── Mode toggle (Enter) ──────────────────────────────────
    if (key.return) {
      setMode((m) => (m === 'rsvp' ? 'document' : 'rsvp'));
      return;
    }

    // ── Global scrolling controls (when paused or in doc mode) ───────
    if (mode === 'document' || (mode === 'rsvp' && !rsvpState.playing)) {
      const contentWidth = Math.max(10, mainWidth - 2);
      const maxLines = totalDocLines(doc, contentWidth, enriched);
      const viewportH = mainHeight - 2;

      const scrollDown = (dist: number) => {
        setDocScrollOffset((o) => Math.min(o + dist, Math.max(0, maxLines - viewportH)));
      };
      const scrollUp = (dist: number) => {
        setDocScrollOffset((o) => Math.max(o - dist, 0));
      };

      // Explicit scrolling keys (Ctrl+Arrows, PgUp/Dn, vim-ish)
      if (key.pageDown || input === 'd') {
        scrollDown(Math.floor(viewportH / 2));
        return;
      }
      if (key.pageUp || input === 'u') {
        scrollUp(Math.floor(viewportH / 2));
        return;
      }
      if (key.ctrl && key.downArrow) {
        scrollDown(3);
        return;
      }
      if (key.ctrl && key.upArrow) {
        scrollUp(3);
        return;
      }

      // In pure DOCUMENT mode, standard arrows scroll
      if (mode === 'document') {
        if (key.downArrow || input === 'j') {
          scrollDown(1);
          return;
        }
        if (key.upArrow || input === 'k') {
          scrollUp(1);
          return;
        }
        // g/G for top/bottom
        if (input === 'g') {
          setDocScrollOffset(0);
          return;
        }
        if (input === 'G') {
          const contentW = Math.max(10, mainWidth - 2);
          const total = totalDocLines(doc, contentW, enriched);
          setDocScrollOffset(Math.max(0, total - viewportH));
          return;
        }
        // Space switches back to RSVP
        if (input === ' ') {
          setMode('rsvp');
          rsvpControls.togglePlay();
          return;
        }
        return;
      }
    }

    // ── RSVP mode keybindings ────────────────────────────────

    // Play/Pause
    if (input === ' ') {
      rsvpControls.togglePlay();
      return;
    }

    // Word stepping (when paused)
    if (key.leftArrow && !rsvpState.playing) {
      rsvpControls.stepBackward();
      return;
    }
    if (key.rightArrow && !rsvpState.playing) {
      rsvpControls.stepForward();
      return;
    }

    // Speed control
    if (input === ']' || input === '=') {
      rsvpControls.speedUp();
      return;
    }
    if (input === '[' || input === '-') {
      rsvpControls.speedDown();
      return;
    }
    if (input === '}') {
      rsvpControls.speedUpLarge();
      return;
    }
    if (input === '{') {
      rsvpControls.speedDownLarge();
      return;
    }

    // Section navigation
    if (key.downArrow || input === 'j') {
      const frameIdx = docNavControls.nextSection();
      rsvpControls.jumpTo(frameIdx);
      return;
    }
    if (key.upArrow || input === 'k') {
      const frameIdx = docNavControls.prevSection();
      rsvpControls.jumpTo(frameIdx);
      return;
    }

    // Jump to start/end
    if (input === 'g') {
      rsvpControls.jumpToStart();
      return;
    }
    if (input === 'G') {
      rsvpControls.jumpToEnd();
      return;
    }
  });

  // ── Render ─────────────────────────────────────────────────

  // If there are no frames (empty document), show a message
  if (doc.frames.length === 0) {
    return (
      <Box
        flexDirection="column"
        width={termWidth}
        height={termHeight}
        alignItems="center"
        justifyContent="center"
      >
        <Text bold color="yellow">rmdp — Rapid Markdown Presentation</Text>
        <Text dimColor>No readable content found in document.</Text>
        <Text dimColor>Press q to quit, ? for help.</Text>
      </Box>
    );
  }

  // ── Help overlay ───────────────────────────────────────────
  if (showHelp) {
    return (
      <Box
        width={termWidth}
        height={termHeight}
        alignItems="center"
        justifyContent="center"
      >
        <HelpOverlay
          width={termWidth}
          height={termHeight}
          visible={true}
        />
      </Box>
    );
  }

  // ── Compact mode for very narrow terminals ─────────────────
  const isCompact = termWidth < 60;

  return (
    <Box
      flexDirection="column"
      width={termWidth}
      height={termHeight}
    >
      {/* ── Main content area ─────────────────────────────── */}
      <Box flexDirection="row" height={mainHeight}>
        {/* ── Sidebar ─────────────────────────────────────── */}
        {showSidebar && sidebarWidth > 0 && (
          <TocSidebar
            sections={doc.sections}
            flatSections={doc.flatSections}
            activeSectionId={docNav.activeSectionId}
            width={sidebarWidth}
            height={mainHeight}
            currentFrame={rsvpState.currentFrame}
          />
        )}

        {/* ── Main pane ───────────────────────────────────── */}
        <Box flexDirection="column" width={mainWidth} height={mainHeight}>
          <FullDocViewer
            doc={doc}
            scrollOffset={docScrollOffset}
            width={mainWidth}
            height={mainHeight}
            activeSectionId={docNav.activeSectionId}
            flatSections={doc.flatSections}
            currentFrameIndex={rsvpState.frameIndex}
            enriched={enriched}
            autoScroll={mode === 'rsvp'}
            playing={rsvpState.playing}
          />
        </Box>
      </Box>

      {/* ── Status bar ────────────────────────────────────── */}
      {isCompact ? (
        <StatusBarCompact
          playing={rsvpState.playing}
          wpm={rsvpState.wpm}
          frameIndex={rsvpState.frameIndex}
          totalFrames={doc.frames.length}
          progress={rsvpState.progress}
          timeRemainingSeconds={rsvpState.timeRemainingSeconds}
          sectionTitle={sectionTitle}
          mode={mode}
          width={termWidth}
        />
      ) : (
        <StatusBar
          playing={rsvpState.playing}
          wpm={rsvpState.wpm}
          frameIndex={rsvpState.frameIndex}
          totalFrames={doc.frames.length}
          progress={rsvpState.progress}
          timeRemainingSeconds={rsvpState.timeRemainingSeconds}
          sectionTitle={sectionTitle}
          mode={mode}
          width={termWidth}
        />
      )}
    </Box>
  );
};