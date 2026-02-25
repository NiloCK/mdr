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

  // ── Section navigation ──────────────────────────────────

  const jumpToSection = useCallback(
    (sectionId: number): number => {
      const section = doc.flatSections.find((s) => s.id === sectionId);
      if (!section) return 0;
      setActiveSectionId(sectionId);
      // Return the frame index to jump to
      return section.frameStart >= 0 ? section.frameStart : 0;
    },
    [doc.flatSections],
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

  // ── Sync to RSVP position ──────────────────────────────

  const syncToFrame = useCallback(
    (frameIndex: number) => {
      const section = sectionForFrame(doc, frameIndex);
      if (section && section.id !== activeSectionId) {
        setActiveSectionId(section.id);
      }
    },
    [doc, activeSectionId],
  );

  // ── Return ──────────────────────────────────────────────

  const state: DocumentNavState = {
    activeSectionId,
    activeSection,
    flatSections: doc.flatSections,
    activeSectionFlatIndex,
  };

  const controls: DocumentNavControls = {
    nextSection,
    prevSection,
    jumpToSection,
    syncToFrame,
    setActiveSectionId,
  };

  return [state, controls];
}