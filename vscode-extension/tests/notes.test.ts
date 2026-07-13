import { describe, expect, it } from 'vitest';
import { appendRevisionNote, deleteRevisionNote } from '../src/notes.js';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';

describe('revision notes', () => {
  it('adds an escaped, source-visible note', () => {
    const result = appendRevisionNote('# Plan\n\nText.\n', 'Plan › paragraph 1', 'Use {owner} <here>.', firstId);
    expect(result).toContain('## Revision notes');
    expect(result).toContain(`data-rmx-note-id="${firstId}"`);
    expect(result).toContain('Use &#123;owner&#125; &lt;here&gt;.');
  });

  it('deletes only the requested note and removes an empty heading', () => {
    let source = appendRevisionNote('# Plan\n', 'First', 'One', firstId);
    source = appendRevisionNote(source, 'Second', 'Two', secondId);
    const withOne = deleteRevisionNote(source, firstId);
    expect(withOne).not.toContain(firstId);
    expect(withOne).toContain(secondId);
    expect(withOne).toContain('## Revision notes');
    const empty = deleteRevisionNote(withOne, secondId);
    expect(empty).not.toContain('## Revision notes');
  });
});
