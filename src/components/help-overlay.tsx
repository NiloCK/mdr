// ─── Help Overlay Component ─────────────────────────────────────────────────
//
// A modal overlay that displays all available keybindings organized by
// category.  Toggled with the '?' key.  Renders as a centered box on top
// of whatever content is behind it.

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { KEY_BINDINGS, type KeyBinding } from '../types.js';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface HelpOverlayProps {
  /** Available width in columns */
  width: number;
  /** Available height in rows */
  height: number;
  /** Whether the overlay is visible */
  visible: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const HelpOverlay: React.FC<HelpOverlayProps> = ({
  width,
  height,
  visible,
}) => {
  if (!visible) return null;

  // ── Group bindings by category ──────────────────────────────
  const grouped = useMemo(() => {
    const groups: Record<string, KeyBinding[]> = {};
    for (const binding of KEY_BINDINGS) {
      if (!groups[binding.category]) {
        groups[binding.category] = [];
      }
      groups[binding.category]!.push(binding);
    }
    return groups;
  }, []);

  const categoryOrder: Array<{ key: string; label: string; color: string }> = [
    { key: 'playback', label: '▶ Playback', color: 'green' },
    { key: 'speed', label: '⚡ Speed', color: 'yellow' },
    { key: 'navigation', label: '◇ Navigation', color: 'cyan' },
    { key: 'view', label: '◻ View', color: 'magenta' },
  ];

  // ── Calculate overlay dimensions ───────────────────────────
  const overlayWidth = Math.min(60, Math.max(40, width - 8));
  const overlayInnerWidth = overlayWidth - 4; // account for border + padding

  // ── Compute the widest key column for alignment ────────────
  const maxKeyWidth = useMemo(() => {
    let max = 0;
    for (const binding of KEY_BINDINGS) {
      if (binding.key.length > max) max = binding.key.length;
    }
    return max;
  }, []);

  // ── Build lines ────────────────────────────────────────────
  const sections: Array<{
    label: string;
    color: string;
    bindings: KeyBinding[];
  }> = [];

  for (const cat of categoryOrder) {
    const bindings = grouped[cat.key];
    if (bindings && bindings.length > 0) {
      sections.push({
        label: cat.label,
        color: cat.color,
        bindings,
      });
    }
  }

  // ── Count total lines needed ───────────────────────────────
  let totalContentLines = 0;
  for (const section of sections) {
    totalContentLines += 2; // header + blank line after
    totalContentLines += section.bindings.length;
  }
  totalContentLines += 2; // title + blank line
  totalContentLines += 1; // footer hint

  // If the overlay would be taller than available space, we just let
  // Ink clip it. In practice, the help content is short enough.
  const overlayHeight = Math.min(totalContentLines + 4, height - 2);

  return (
    <Box
      flexDirection="column"
      width={overlayWidth}
      height={overlayHeight}
      borderStyle="double"
      borderColor="white"
      paddingLeft={1}
      paddingRight={1}
    >
      {/* Title */}
      <Box justifyContent="center" width={overlayInnerWidth}>
        <Text bold color="white">
          {'⌨  Keyboard Shortcuts'}
        </Text>
      </Box>
      <Box height={1} />

      {/* Binding categories */}
      {sections.map((section, sectionIdx) => (
        <Box key={section.label} flexDirection="column">
          {/* Category header */}
          <Box>
            <Text bold color={section.color}>
              {section.label}
            </Text>
          </Box>

          {/* Bindings */}
          {section.bindings.map((binding, bindingIdx) => (
            <HelpBindingLine
              key={binding.key}
              binding={binding}
              keyColumnWidth={maxKeyWidth}
              maxWidth={overlayInnerWidth}
              categoryColor={section.color}
            />
          ))}

          {/* Spacer between categories */}
          {sectionIdx < sections.length - 1 && <Box height={1} />}
        </Box>
      ))}

      {/* Footer */}
      <Box flexGrow={1} />
      <Box justifyContent="center" width={overlayInnerWidth}>
        <Text dimColor italic>
          {'Press ? to close'}
        </Text>
      </Box>
    </Box>
  );
};

// ─── Binding Line Sub-component ─────────────────────────────────────────────

interface HelpBindingLineProps {
  binding: KeyBinding;
  keyColumnWidth: number;
  maxWidth: number;
  categoryColor: string;
}

const HelpBindingLine: React.FC<HelpBindingLineProps> = ({
  binding,
  keyColumnWidth,
  maxWidth,
  categoryColor,
}) => {
  const keyStr = binding.key.padEnd(keyColumnWidth);
  const separator = '  →  ';
  const descMaxWidth = Math.max(5, maxWidth - keyColumnWidth - separator.length - 2);
  const desc = truncate(binding.description, descMaxWidth);

  return (
    <Box>
      <Text>
        <Text color={categoryColor} bold>
          {keyStr}
        </Text>
        <Text dimColor>
          {separator}
        </Text>
        <Text>
          {desc}
        </Text>
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