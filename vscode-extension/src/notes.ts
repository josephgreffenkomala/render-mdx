import { randomUUID } from 'node:crypto';

const revisionHeading = /^## Revision notes\s*$/m;
const noteIdPattern = /^[0-9a-f-]{36}$/;
const maxNoteLength = 10_000;
const maxContextLength = 500;

function escapeMdxText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('{', '&#123;')
    .replaceAll('}', '&#125;');
}

export function appendRevisionNote(
  source: string,
  context: string,
  note: string,
  noteId = randomUUID(),
): string {
  let cleanContext = context.trim() || 'Document';
  const cleanNote = note.trim();
  if (!cleanNote) throw new Error('Write a note before saving.');
  if (cleanNote.length > maxNoteLength) {
    throw new Error(`Note is too long (maximum ${maxNoteLength.toLocaleString()} characters).`);
  }
  if (cleanContext.length > maxContextLength) {
    cleanContext = `${cleanContext.slice(0, maxContextLength).trimEnd()}…`;
  }

  const quotedNote = escapeMdxText(cleanNote)
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
  const heading = revisionHeading.test(source) ? '' : '\n\n## Revision notes';
  const addition = [
    heading,
    '',
    '> **Revision note**',
    '>',
    `> <span data-rmx-note-id="${noteId}"></span>`,
    '>',
    `> **Target:** ${escapeMdxText(cleanContext)}`,
    '>',
    quotedNote,
    '',
  ].join('\n');
  return `${source.trimEnd()}${addition}`;
}

export function deleteRevisionNote(source: string, noteId: string): string {
  const cleanId = noteId.trim().toLowerCase();
  if (!noteIdPattern.test(cleanId)) throw new Error('Invalid revision note ID.');

  const markerPosition = source.indexOf(`data-rmx-note-id="${cleanId}"`);
  if (markerPosition < 0) throw new Error('Revision note was not found.');

  let blockStart = source.lastIndexOf('> **Revision note**', markerPosition);
  if (blockStart < 0) throw new Error('Revision note block is malformed.');
  blockStart = source.lastIndexOf('\n', blockStart) + 1;
  const nextBlock = source.indexOf('\n\n> **Revision note**', markerPosition);
  let updated = nextBlock >= 0
    ? `${source.slice(0, blockStart).trimEnd()}${source.slice(nextBlock)}`
    : `${source.slice(0, blockStart).trimEnd()}\n`;

  if (!updated.includes('> **Revision note**')) {
    updated = updated.replace(/\n*## Revision notes\s*\n*$/m, '\n');
  }
  return updated;
}
