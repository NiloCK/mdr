// ─── Table of Contents Sidebar ──────────────────────────────────────────────
//
// Renders a hierarchical, collapsible table of contents derived from the
// document's section tree.  The currently active section is highlighted,
// and non-active branches are collapsed to fit the available vertical space.

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { Section } from '../types.js';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface TocSidebarProps {
  /** Top-level sections (hierarchical tree) */
  sections: Section[];
  /** Flat list of all sections */
  flatSections: Section[];
  /** ID of the currently active section */
  activeSectionId: number;
  /** Available width in columns */
  width: number;
  /** Available height in rows */
  height: number;
  /** Callback when a section is selected */
  onSelectSection?: (sectionId: number) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const TocSidebar: React.FC<TocSidebarProps> = ({
  sections,
  flatSections,
  activeSectionId,
  width,
  height,
}) => {
  // Build a list of lines to render, respecting collapsing rules.
  // Active section and its ancestors/siblings are expanded.
  // Everything else is collapsed.
  const lines = useMemo(() => {
    const result: TocLine[] = [];
    const ancestorIds = getAncestorIds(flatSections, activeSectionId);
    const activeSection = flatSections.find((s) => s.id === activeSectionId);
    const activeSiblingParent = activeSection?.parentId ?? -1;

    const walk = (sectionList: Section[], depth: number) => {
      for (const section of sectionList) {
        const isActive = section.id === activeSectionId;
        const isAncestor = ancestorIds.has(section.id);
        const isActiveSibling = section.parentId === activeSiblingParent && depth > 0;
        const isTopLevel = depth === 0;

        result.push({
          section,
          depth,
          isActive,
          isAncestor,
        });

        // Expand children if:
        // - This is the active section (show immediate children)
        // - This is an ancestor of the active section
        // - This is a top-level section (always show top-level children)
        const shouldExpand = isActive || isAncestor || (isTopLevel && section.children.length > 0);

        if (shouldExpand && section.children.length > 0) {
          walk(section.children, depth + 1);
        } else if (section.children.length > 0 && !shouldExpand) {
          // Show a collapsed indicator — only if it has children
          result.push({
            section: null,
            depth: depth + 1,
            isActive: false,
            isAncestor: false,
            collapsedCount: countDescendants(section),
          });
        }
      }
    };

    walk(sections, 0);
    return result;
  }, [sections, flatSections, activeSectionId]);

  // If there are more lines than available height, we need to scroll
  // so the active section is visible.
  const visibleLines = useMemo(() => {
    const availableRows = Math.max(1, height - 2); // reserve for header
    if (lines.length <= availableRows) {
      return lines;
    }

    // Find the active line index
    const activeIdx = lines.findIndex((l) => l.isActive);
    if (activeIdx < 0) {
      return lines.slice(0, availableRows);
    }

    // Center the active line in the viewport
    const half = Math.floor(availableRows / 2);
    let start = Math.max(0, activeIdx - half);
    let end = start + availableRows;

    if (end > lines.length) {
      end = lines.length;
      start = Math.max(0, end - availableRows);
    }

    return lines.slice(start, end);
  }, [lines, height]);

  // ── Render ────────────────────────────────────────────────
  const contentWidth = Math.max(1, width - 2);

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor="gray"
    >
      {/* Header */}
      <Box paddingLeft={1} paddingRight={1}>
        <Text bold color="cyan">
          {'◊ Contents'}
        </Text>
      </Box>

      {/* Section lines */}
      <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
        {visibleLines.map((line, i) => (
          <TocLineComponent
            key={i}
            line={line}
            maxWidth={contentWidth - 1}
          />
        ))}
      </Box>

    </Box>
  );
};

// ─── Sub-components ─────────────────────────────────────────────────────────

interface TocLine {
  section: Section | null;
  depth: number;
  isActive: boolean;
  isAncestor: boolean;
  collapsedCount?: number;
}

const TocLineComponent: React.FC<{ line: TocLine; maxWidth: number }> = ({
  line,
  maxWidth,
}) => {
  const indent = '  '.repeat(line.depth);

  if (line.collapsedCount != null) {
    // Collapsed children indicator
    const text = `${indent}  ⋯ (${line.collapsedCount} more)`;
    return (
      <Text dimColor>
        {truncate(text, maxWidth)}
      </Text>
    );
  }

  if (!line.section) return null;

  const marker = line.isActive ? '▸ ' : line.isAncestor ? '▾ ' : '  ';
  const title = `${indent}${marker}${line.section.title}`;

  if (line.isActive) {
    return (
      <Text bold color="yellow">
        {truncate(title, maxWidth)}
      </Text>
    );
  }

  if (line.isAncestor) {
    return (
      <Text color="cyan">
        {truncate(title, maxWidth)}
      </Text>
    );
  }

  return (
    <Text dimColor>
      {truncate(title, maxWidth)}
    </Text>
  );
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getAncestorIds(flatSections: Section[], sectionId: number): Set<number> {
  const ids = new Set<number>();
  let current = flatSections.find((s) => s.id === sectionId);
  while (current && current.parentId >= 0) {
    ids.add(current.parentId);
    current = flatSections.find((s) => s.id === current!.parentId);
  }
  return ids;
}

function countDescendants(section: Section): number {
  let count = section.children.length;
  for (const child of section.children) {
    count += countDescendants(child);
  }
  return count;
}

function truncate(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 1) + '…';
}