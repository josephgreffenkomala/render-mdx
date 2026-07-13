import { describe, expect, it, vi } from 'vitest';
import { createMermaidConfig, requestNoteDeletion } from '../src/webview-behavior.js';

describe('webview behavior', () => {
  it('sends an undoable delete edit without depending on a native webview dialog', () => {
    const postMessage = vi.fn();
    requestNoteDeletion(
      '11111111-1111-4111-8111-111111111111',
      postMessage,
    );
    expect(postMessage).toHaveBeenCalledWith({
      type: 'deleteNote',
      noteId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('uses an explicit high-contrast Mermaid palette in a dark editor', () => {
    const config = createMermaidConfig(true);
    expect(config).toMatchObject({
      theme: 'base',
      themeVariables: {
        primaryColor: '#134e4a',
        primaryTextColor: '#f0fdfa',
        secondaryColor: '#1e3a5f',
        tertiaryColor: '#4c1d5f',
        lineColor: '#5eead4',
        background: '#0f1f1e',
      },
    });
  });
});
