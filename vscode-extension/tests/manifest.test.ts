import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('extension manifest', () => {
  it('uses a recognizable preview icon in the editor title bar', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    expect(manifest.contributes.commands[0].icon).toBe('$(eye)');
  });
});
