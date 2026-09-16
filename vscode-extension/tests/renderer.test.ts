import { describe, expect, it } from 'vitest';
import { renderMdx } from '../src/renderer.js';
import { appendRevisionNote } from '../src/notes.js';

describe('renderMdx', () => {
  it('renders the supported component import surface', async () => {
    const html = await renderMdx(`---
title: Demo
---

import { Aside, Badge, Card, CardGrid, Code, FileTree, Steps, Tabs, TabItem } from '@mdx-components';

# Preview

<Aside type="tip" title="Good idea">Use the shared style.</Aside>

<Badge text="Stable" variant="success" />

<CardGrid><Card title="One">Card body</Card></CardGrid>

<Tabs><TabItem label="Shell"><Code code={\`npm run dev\`} lang="bash" /></TabItem></Tabs>

<Steps>
1. First
2. Second
</Steps>

<FileTree>
- src/
  - index.ts
</FileTree>
`);
    expect(html).toContain('<h1>Preview</h1>');
    expect(html).toContain('starlight-aside');
    expect(html).toContain('sl-badge success');
    expect(html).toContain('card-grid');
    expect(html).toContain('starlight-tabs');
    expect(html).toContain('sl-steps');
    expect(html).toContain('starlight-file-tree');
  });

  it('renders an interactive code walkthrough with canonical line ranges', async () => {
    const html = await renderMdx(`
import { CodeWalkthrough, CodeWalkthroughStep } from '@mdx-components';

<CodeWalkthrough
  title="Request lifecycle"
  filename="src/handler.ts"
  lang="ts"
  code={\`const request = read();\nvalidate(request);\nreturn save(request);\`}
>
  <CodeWalkthroughStep title="Validate input" lines="3, 2-3">
    Reject invalid requests before writing.
  </CodeWalkthroughStep>
</CodeWalkthrough>
`);

    expect(html).toContain('class="rmx-code-walkthrough"');
    expect(html).toContain('data-code-lines="2-3"');
    expect(html).toContain('Lines 2–3');
    expect(html).toContain('src/handler.ts');
    expect(html).toContain('<code class="language-ts"><span');
  });

  it('rejects imports outside @mdx-components', async () => {
    await expect(renderMdx("import Widget from './Widget.astro'\n\n# Nope")).rejects.toThrow("Only imports from '@mdx-components'");
  });

  it('preserves revision note IDs in rendered HTML', async () => {
    const source = appendRevisionNote('# Preview\n\nText.', 'Preview › paragraph 1', 'Revise it.', '11111111-1111-4111-8111-111111111111');
    const html = await renderMdx(source);
    expect(html).toContain('data-rmx-note-id="11111111-1111-4111-8111-111111111111"');
  });
});
