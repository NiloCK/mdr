// ─── Optimal Recognition Point (ORP) ────────────────────────────────────────
//
// The ORP is the letter within a word where the eye naturally fixates.
// By aligning this letter at a fixed column, the reader's fovea stays
// stationary and every word "snaps" into place around it.
//
// The index is shifted slightly left-of-center because peripheral vision
// resolves more characters to the right of fixation than to the left.
//
// Formula (derived from Spritz / RSVP research):
//   len 1     → index 0
//   len 2–5   → index 1
//   len 6–9   → index 2
//   len 10–13 → index 3
//   len 14+   → index 4
//
// This can be approximated as:  floor((len - 1) / 4)  clamped to [0, 4].

/**
 * Compute the ORP index for a raw word string.
 * Trailing punctuation is ignored for the length calculation so that
 * "hello!" and "hello" share the same focal letter.
 */
export function getOrpIndex(word: string): number {
  const core = stripTrailingPunctuation(word);
  const n = core.length;

  if (n <= 1) return 0;
  if (n <= 5) return 1;
  if (n <= 9) return 2;
  if (n <= 13) return 3;
  return 4;
}

/**
 * Return the three "parts" of a word split around its ORP letter.
 *
 *   before | focal | after
 *
 * The caller renders `before` normally, `focal` highlighted (red / bold),
 * and `after` normally.
 */
export interface OrpParts {
  before: string;
  focal: string;
  after: string;
  /** Number of characters before the focal letter (used for alignment) */
  offsetLeft: number;
}

export function splitAtOrp(word: string, orpIndex?: number): OrpParts {
  const idx = orpIndex ?? getOrpIndex(word);
  const clamped = Math.min(idx, word.length - 1);

  return {
    before: word.slice(0, clamped),
    focal: word[clamped] ?? '',
    after: word.slice(clamped + 1),
    offsetLeft: clamped,
  };
}

/**
 * Build a fixed-width line with the ORP letter pinned to `centerCol`.
 * Returns a string of exactly `totalWidth` characters.
 *
 *   padLeft + before + FOCAL + after + padRight
 *
 * where FOCAL sits at column `centerCol`.
 */
export function renderOrpLine(
  word: string,
  totalWidth: number,
  orpIndex?: number,
): { line: string; focalCol: number; parts: OrpParts } {
  const parts = splitAtOrp(word, orpIndex);
  const centerCol = Math.floor(totalWidth / 2);
  const padLeft = Math.max(0, centerCol - parts.offsetLeft);

  // Build the raw string (without color — the component applies chalk)
  const raw = ' '.repeat(padLeft) + word;
  const padRight = Math.max(0, totalWidth - raw.length);
  const line = raw + ' '.repeat(padRight);

  return { line, focalCol: centerCol, parts };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const TRAILING_PUNCT = /[.,;:!?\-–—…"'»)}\]]+$/;

function stripTrailingPunctuation(word: string): string {
  return word.replace(TRAILING_PUNCT, '');
}

/**
 * Compute a smart pause multiplier based on word characteristics.
 */
export function computePauseMultiplier(
  word: string,
  flags: {
    isHeading?: boolean;
    isInlineCode?: boolean;
    isEndOfParagraph?: boolean;
  } = {},
): number {
  let m = 1.0;

  // End-of-paragraph gets the largest bump
  if (flags.isEndOfParagraph) {
    m = Math.max(m, 2.5);
  }

  // Sentence-ending punctuation
  if (/[.!?]$/.test(word)) {
    m = Math.max(m, 2.0);
  } else if (/[,;:]$/.test(word)) {
    m = Math.max(m, 1.4);
  } else if (/[–—]$/.test(word)) {
    m = Math.max(m, 1.5);
  }

  // Headings get a bump
  if (flags.isHeading) {
    m = Math.max(m, 1.8);
  }

  // Inline code gets extra processing time
  if (flags.isInlineCode) {
    m = Math.max(m, 1.4);
  }

  // Long words
  const core = stripTrailingPunctuation(word);
  if (core.length > 12) {
    m = Math.max(m, 1.3);
  } else if (core.length > 8) {
    m = Math.max(m, 1.15);
  }

  return m;
}

/**
 * Build the little guide / reticle lines that sit above and below the
 * RSVP word to mark the focal column.
 *
 * Returns two strings of `totalWidth` chars each:
 *   top:    "            ▼            "
 *   bottom: "            ▲            "
 */
export function renderReticle(
  totalWidth: number,
): { top: string; bottom: string; centerCol: number } {
  const center = Math.floor(totalWidth / 2);
  const pad = ' '.repeat(center);
  const trail = ' '.repeat(Math.max(0, totalWidth - center - 1));

  return {
    top: pad + '▼' + trail,
    bottom: pad + '▲' + trail,
    centerCol: center,
  };
}