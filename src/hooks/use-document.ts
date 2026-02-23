// ─── Document Navigation Hook ────────────────────────────────────────────────
//
// Manages navigation state over the parsed Document: which section is active,
// which visual block is displayed, and helpers for jumping between sections
// and blocks based on RSVP position or user input.

import { useState, useCallback, useMemo, useEffect } from 'react';
import type { Document, Section, VisualBlock } from '../types.js';
import { collectVisualBlocks, visualBlocksForSection, relevantVisualBlock, sectionForFrame } from '../parser.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DocumentNavState {
  /** Currently active (highlighted) section id */
  activeSectionId: number;
  /** The active Section object */
  activeSection: Section | null;
  /** All visual blocks in the entire document */
  allVisualBlocks: VisualBlock[];
  /** Visual blocks belonging to the active section */
  sectionVisualBlocks: VisualBlock[];
  /** Index into sectionVisualBlocks of the currently displayed block */
  activeVisualBlockIndex: number;
  /** The currently displayed visual block (or null) */
  activeVisualBlock: VisualBlock | null;
  /** Whether the visual block is pinned (won't auto-advance) */
  pinned: boolean;
  /** Flattened section list for linear navigation */
  flatSections: Section[];
  /** Index of active section in the flat list */
  activeSectionFlatIndex: number;
}

export interface DocumentNavControls {
  /** Jump to the next section in document order */
  nextSection: () => number;
  /** Jump to the previous section in document order */
  prevSection: () => number;
  /** Jump to a specific section by id. Returns the frame index to jump to. */
  jumpToSection: (sectionId: number) => number;
  /** Show the next visual block in the active section */
  nextVisualBlock: () => void;
  /** Show the previous visual block in the active section */
  prevVisualBlock: () => void;
  /** Toggle pinning of the current visual block */
  togglePin: () => void;
  /** Sync the active section to match the current RSVP frame position */
  syncToFrame: (frameIndex: number) => void;
  /** Set active section id directly */
  setActiveSectionId: (id: number) => void;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useDocument(doc: Document): [DocumentNavState, DocumentNavControls] {
  // Active section
  const initialSectionId = doc.flatSections.length > 0 ? doc.flatSections[0]!.id : 0;
  const [activeSectionId, setActiveSectionId] = useState(initialSectionId);
  const [activeVisualBlockIndex, setActiveVisualBlockIndex] = useState(0);
  const [pinned, setPinned] = useState(false);

  // Memoize visual block collections
  const allVisualBlocks = useMemo(() => collectVisualBlocks(doc), [doc]);

  const activeSection = useMemo(
    () => doc.flatSections.find((s) => s.id === activeSectionId) ?? null,
    [doc.flatSections, activeSectionId],
  );

  const activeSectionFlatIndex = useMemo(
    () => {
      const idx = doc.flatSections.findIndex((s) => s.id === activeSectionId);
      return idx >= 0 ? idx : 0;
    },
    [doc.flatSections, activeSectionId],
  );

  const sectionVisualBlocks = useMemo(
    () => visualBlocksForSection(allVisualBlocks, activeSectionId),
    [allVisualBlocks, activeSectionId],
  );

  const activeVisualBlock = useMemo(() => {
    if (sectionVisualBlocks.length === 0) return null;
    const clamped = Math.min(activeVisualBlockIndex, sectionVisualBlocks.length - 1);
    return sectionVisualBlocks[clamped] ?? null;
  }, [sectionVisualBlocks, activeVisualBlockIndex]);

  // Reset visual block index when section changes
  useEffect(() => {
    if (!pinned) {
      setActiveVisualBlockIndex(0);
    }
  }, [activeSectionId, pinned]);

  // ── Section navigation ──────────────────────────────────

  const jumpToSection = useCallback(
    (sectionId: number): number => {
      const section = doc.flatSections.find((s) => s.id === sectionId);
      if (!section) return 0;
      setActiveSectionId(sectionId);
      if (!pinned) {
        setActiveVisualBlockIndex(0);
      }
      // Return the frame index to jump to
      return section.frameStart >= 0 ? section.frameStart : 0;
    },
    [doc.flatSections, pinned],
  );

  const nextSection = useCallback((): number => {
    const currentIdx = doc.flatSections.findIndex((s) => s.id === activeSectionId);
    const nextIdx = Math.min(currentIdx + 1, doc.flatSections.length - 1);
    const next = doc.flatSections[nextIdx];
    if (next) {
      return jumpToSection(next.id);
    }
    return 0;
  }, [doc.flatSections, activeSectionId, jumpToSection]);

  const prevSection = useCallback((): number => {
    const currentIdx = doc.flatSections.findIndex((s) => s.id === activeSectionId);
    const prevIdx = Math.max(currentIdx - 1, 0);
    const prev = doc.flatSections[prevIdx];
    if (prev) {
      return jumpToSection(prev.id);
    }
    return 0;
  }, [doc.flatSections, activeSectionId, jumpToSection]);

  // ── Visual block navigation ─────────────────────────────

  const nextVisualBlock = useCallback(() => {
    if (sectionVisualBlocks.length === 0) return;
    setActiveVisualBlockIndex((prev) =>
      Math.min(prev + 1, sectionVisualBlocks.length - 1),
    );
  }, [sectionVisualBlocks.length]);

  const prevVisualBlock = useCallback(() => {
    if (sectionVisualBlocks.length === 0) return;
    setActiveVisualBlockIndex((prev) => Math.max(prev - 1, 0));
  }, [sectionVisualBlocks.length]);

  const togglePin = useCallback(() => {
    setPinned((p) => !p);
  }, []);

  // ── Sync to RSVP position ──────────────────────────────

  const syncToFrame = useCallback(
    (frameIndex: number) => {
      const section = sectionForFrame(doc, frameIndex);
      if (section && section.id !== activeSectionId) {
        setActiveSectionId(section.id);
        // Auto-advance visual block unless pinned
        if (!pinned) {
          const sectionVBs = visualBlocksForSection(allVisualBlocks, section.id);
          if (sectionVBs.length > 0) {
            // Find the best visual block for this position (look-ahead)
            const relevant = relevantVisualBlock(doc, allVisualBlocks, frameIndex);
            if (relevant) {
              const idx = sectionVBs.findIndex((vb) => vb.blockId === relevant.blockId);
              setActiveVisualBlockIndex(idx >= 0 ? idx : 0);
            } else {
              setActiveVisualBlockIndex(0);
            }
          }
        }
      } else if (section && section.id === activeSectionId && !pinned) {
        // Same section — update visual block based on RSVP position
        const sectionVBs = visualBlocksForSection(allVisualBlocks, section.id);
        if (sectionVBs.length > 0) {
          const relevant = relevantVisualBlock(doc, allVisualBlocks, frameIndex);
          if (relevant) {
            const idx = sectionVBs.findIndex((vb) => vb.blockId === relevant.blockId);
            if (idx >= 0) {
              setActiveVisualBlockIndex(idx);
            }
          }
        }
      }
    },
    [doc, activeSectionId, pinned, allVisualBlocks],
  );

  // ── Return ──────────────────────────────────────────────

  const state: DocumentNavState = {
    activeSectionId,
    activeSection,
    allVisualBlocks,
    sectionVisualBlocks,
    activeVisualBlockIndex,
    activeVisualBlock,
    pinned,
    flatSections: doc.flatSections,
    activeSectionFlatIndex,
  };

  const controls: DocumentNavControls = {
    nextSection,
    prevSection,
    jumpToSection,
    nextVisualBlock,
    prevVisualBlock,
    togglePin,
    syncToFrame,
    setActiveSectionId,
  };

  return [state, controls];
}