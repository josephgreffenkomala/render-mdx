export type LineSelection = string | number | readonly number[];

export interface LineRange {
  start: number;
  end: number;
}

function invalidSelection(message: string): never {
  throw new TypeError(`CodeWalkthroughStep lines ${message}`);
}

/** Parse, sort, and merge a one-based code line selection. */
export function parseLineSelection(selection: LineSelection): LineRange[] {
  let tokens: string[];

  if (typeof selection === 'number') {
    tokens = [String(selection)];
  } else if (Array.isArray(selection)) {
    tokens = selection.map(String);
  } else if (typeof selection === 'string') {
    tokens = selection.split(',').map((token) => token.trim());
  } else {
    return invalidSelection('must use positive line numbers such as "3" or "3-7".');
  }

  if (tokens.length === 0 || tokens.every((token) => token.length === 0)) {
    return invalidSelection('cannot be empty.');
  }

  const ranges = tokens.map((token): LineRange => {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token);
    if (!match) {
      return invalidSelection('must use positive line numbers such as "3" or "3-7".');
    }

    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < 1) {
      return invalidSelection('must use positive line numbers such as "3" or "3-7".');
    }
    if (end < start) {
      return invalidSelection(`range "${token}" must start before it ends.`);
    }
    return { start, end };
  });

  ranges.sort((left, right) => left.start - right.start || left.end - right.end);

  return ranges.reduce<LineRange[]>((merged, range) => {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
    return merged;
  }, []);
}

/** Serialize ranges for the component's stable data attribute contract. */
export function serializeLineRanges(ranges: readonly LineRange[]): string {
  return ranges
    .map(({ start, end }) => (start === end ? String(start) : `${start}-${end}`))
    .join(',');
}

/** Format ranges as a short, readable label for the walkthrough UI. */
export function formatLineRanges(ranges: readonly LineRange[]): string {
  const label = ranges
    .map(({ start, end }) => (start === end ? String(start) : `${start}–${end}`))
    .join(', ');
  const singular = ranges.length === 1 && ranges[0]?.start === ranges[0]?.end;
  return `${singular ? 'Line' : 'Lines'} ${label}`;
}

/** Expand ranges to one-based line numbers, clipping them to an optional file length. */
export function expandLineRanges(
  ranges: readonly LineRange[],
  maximumLine = Number.POSITIVE_INFINITY,
): number[] {
  const expanded: number[] = [];
  for (const { start, end } of ranges) {
    for (let line = start; line <= Math.min(end, maximumLine); line += 1) {
      expanded.push(line);
    }
  }
  return expanded;
}
