import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  expandLineRanges,
  formatLineRanges,
  parseLineSelection,
  serializeLineRanges,
} from '../src/components/mdx/codeWalkthrough.ts';

describe('code walkthrough line selections', () => {
  it('sorts and merges overlapping or adjacent ranges', () => {
    const ranges = parseLineSelection('8, 2-4, 4-6, 10, 9');

    assert.deepEqual(ranges, [
      { start: 2, end: 6 },
      { start: 8, end: 10 },
    ]);
    assert.equal(serializeLineRanges(ranges), '2-6,8-10');
    assert.equal(formatLineRanges(ranges), 'Lines 2–6, 8–10');
  });

  it('accepts a line number or an array of line numbers', () => {
    assert.deepEqual(parseLineSelection(4), [{ start: 4, end: 4 }]);
    assert.deepEqual(parseLineSelection([5, 2, 3]), [
      { start: 2, end: 3 },
      { start: 5, end: 5 },
    ]);
  });

  it('expands ranges while respecting the file line count', () => {
    const ranges = parseLineSelection('2-4, 8-12');

    assert.deepEqual(expandLineRanges(ranges, 9), [2, 3, 4, 8, 9]);
  });

  it('rejects empty, descending, non-integer, and zero-based selections', () => {
    for (const selection of ['', '0', '4-2', 'one', [1, 2.5]]) {
      assert.throws(
        () => parseLineSelection(selection),
        /positive line numbers|start before it ends|cannot be empty/,
      );
    }
  });
});
