import mermaid from 'mermaid';
import {
  createMermaidConfig,
  expandCodeLineSelection,
  requestNoteDeletion,
} from './webview-behavior.js';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const vscode = acquireVsCodeApi();
const content = document.querySelector<HTMLElement>('[data-content]')!;
const status = document.querySelector<HTMLElement>('[data-status]')!;
const title = document.querySelector<HTMLElement>('[data-document-title]')!;
const dialog = document.querySelector<HTMLDialogElement>('[data-note-dialog]')!;
const noteForm = document.querySelector<HTMLFormElement>('[data-note-form]')!;
const noteInput = document.querySelector<HTMLTextAreaElement>('[data-note-input]')!;
const noteContext = document.querySelector<HTMLElement>('[data-note-context]')!;
const noteStatus = document.querySelector<HTMLElement>('[data-note-status]')!;
const noteSave = document.querySelector<HTMLButtonElement>('[data-note-save]')!;
let activeContext = '';

function normalizedText(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function targetKind(target: Element): string {
  if (/^H[1-6]$/.test(target.tagName)) return 'heading';
  if (target.matches('p')) return 'paragraph';
  if (target.matches('ul, ol')) return 'list';
  if (target.matches('pre')) return 'code block';
  if (target.matches('table')) return 'table';
  if (target.matches('blockquote')) return 'quote';
  if (target.matches('.rmx-mermaid')) return 'diagram';
  if (target.matches('.rmx-code-walkthrough')) return 'code walkthrough';
  if (target.matches('.card, .sl-link-card')) return 'card';
  if (target.matches('.starlight-aside')) return 'aside';
  if (target.matches('.starlight-file-tree')) return 'file tree';
  if (target.matches('.starlight-tabs')) return 'tabs';
  return 'content block';
}

function headingPath(target: Element, headings: Element[]): string {
  const stack: Array<{ level: number; text: string }> = [];
  for (const heading of headings) {
    if (heading !== target && !(heading.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    const level = Number(heading.tagName.slice(1));
    while (stack.length && stack.at(-1)!.level >= level) stack.pop();
    stack.push({ level, text: normalizedText(heading.textContent) });
    if (heading === target) break;
  }
  const path = stack.filter((item) => item.level > 1).map((item) => item.text);
  return path.join(' › ') || stack.at(-1)?.text || 'Document';
}

function noteTargets(): HTMLElement[] {
  const revisionHeading = [...content.querySelectorAll('h2')].find((heading) => normalizedText(heading.textContent).toLowerCase() === 'revision notes');
  const candidates = [...content.querySelectorAll<HTMLElement>(
    ':scope > :is(h1,h2,h3,h4,h5,h6,p,ul,ol,pre,table,blockquote,.rmx-mermaid,.rmx-code-walkthrough), :scope > * :is(.card,.sl-link-card,.starlight-aside,.starlight-file-tree,.starlight-tabs)',
  )];
  return candidates.filter((target) => !revisionHeading || Boolean(target.compareDocumentPosition(revisionHeading) & Node.DOCUMENT_POSITION_FOLLOWING));
}

function describeTargets(targets: HTMLElement[]): void {
  const headings = [...content.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  const counts = new Map<string, number>();
  for (const target of targets) {
    const section = headingPath(target, headings);
    const kind = targetKind(target);
    const key = `${section}\0${kind}`;
    const ordinal = (counts.get(key) ?? 0) + 1;
    counts.set(key, ordinal);
    const excerpt = normalizedText(target.textContent).slice(0, 140);
    target.dataset.rmxNoteTarget = `${section} › ${kind} ${ordinal}${excerpt ? ` — “${excerpt}”` : ''}`;
  }
}

function revisionContext(blockquote: HTMLElement): string {
  const label = [...blockquote.querySelectorAll('strong')].find((element) => normalizedText(element.textContent).toLowerCase() === 'target:');
  return label?.parentElement ? normalizedText(label.parentElement.textContent?.replace(label.textContent ?? '', '')) : '';
}

function findTarget(context: string, targets: HTMLElement[]): HTMLElement | undefined {
  const exact = targets.find((target) => target.dataset.rmxNoteTarget === context);
  if (exact) return exact;
  const [section, excerpt = ''] = context.split(' — ', 2);
  const cleanExcerpt = normalizedText(excerpt).replace(/^[“"]|[”"]$/g, '');
  return targets.find((target) => (target.dataset.rmxNoteTarget ?? '').includes(section) && (!cleanExcerpt || normalizedText(target.textContent).includes(cleanExcerpt)));
}

function compactNote(blockquote: HTMLElement, context: string): HTMLDetailsElement {
  const noteId = blockquote.querySelector<HTMLElement>('[data-rmx-note-id]')?.dataset.rmxNoteId;
  const details = document.createElement('details');
  details.className = 'rmx-inline-note';
  const summary = document.createElement('summary');
  summary.innerHTML = `<strong>Note</strong><span title="${context.replaceAll('"', '&quot;')}">${context.split(' — ', 1)[0]}</span>`;
  for (const strong of blockquote.querySelectorAll('strong')) {
    if (['revision note', 'target:'].includes(normalizedText(strong.textContent).toLowerCase())) strong.parentElement?.remove();
  }
  blockquote.querySelector('[data-rmx-note-id]')?.remove();
  const actions = document.createElement('div');
  actions.className = 'rmx-note-actions';
  const remove = document.createElement('button');
  remove.className = 'rmx-delete-note';
  remove.title = 'Delete note (undoable)';
  remove.setAttribute('aria-label', 'Delete note');
  remove.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 1h3l.5 1H13v1H3V2h3l.5-1ZM4 4h8l-.6 10H4.6L4 4Zm2 2 .25 6h1L7 6H6Zm3 0-.25 6h1L10 6H9Z"/></svg>';
  remove.disabled = !noteId;
  remove.addEventListener('click', () => {
    requestNoteDeletion(noteId, (message) => {
      remove.disabled = true;
      remove.classList.add('is-busy');
      vscode.postMessage(message);
    });
  });
  actions.append(remove);
  details.append(summary, blockquote, actions);
  return details;
}

function placeRevisionNotes(targets: HTMLElement[]): void {
  const heading = [...content.querySelectorAll('h2')].find((element) => normalizedText(element.textContent).toLowerCase() === 'revision notes');
  if (!heading) return;
  const notes = [...content.querySelectorAll<HTMLElement>('blockquote')].filter((note) => Boolean(heading.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING));
  let placed = 0;
  for (const note of notes) {
    const context = revisionContext(note);
    const target = findTarget(context, targets);
    if (!target) continue;
    target.after(compactNote(note, context));
    placed += 1;
  }
  if (placed === notes.length) heading.remove();
}

function installNoteButton(targets: HTMLElement[]): void {
  if (!targets.length) return;
  const button = document.createElement('button');
  button.className = 'rmx-add-note';
  button.title = 'Add revision note';
  button.setAttribute('aria-label', 'Add revision note');
  button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 3h13A1.5 1.5 0 0 1 18 4.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-4.6 3.3A.55.55 0 0 1 3.5 17.85V15A1.5 1.5 0 0 1 2 13.5v-9A1.5 1.5 0 0 1 3.5 3ZM10 6a.75.75 0 0 0-.75.75v1.5h-1.5a.75.75 0 0 0 0 1.5h1.5v1.5a.75.75 0 0 0 1.5 0v-1.5h1.5a.75.75 0 0 0 0-1.5h-1.5v-1.5A.75.75 0 0 0 10 6Z"/></svg>';
  button.hidden = true;
  content.append(button);
  for (const target of targets) {
    target.addEventListener('pointerenter', () => {
      activeContext = target.dataset.rmxNoteTarget ?? 'Document';
      button.style.top = `${Math.max(0, target.offsetTop - 28)}px`;
      button.hidden = false;
    });
  }
  button.addEventListener('click', () => {
    noteContext.textContent = activeContext;
    noteInput.value = '';
    noteStatus.textContent = '';
    dialog.showModal();
    noteInput.focus();
  });
}

function installTabs(): void {
  for (const tabs of content.querySelectorAll<HTMLElement>('.starlight-tabs')) {
    const panels = [...tabs.querySelectorAll<HTMLElement>(':scope > .rmx-tab-panel')];
    if (!panels.length) continue;
    const tablist = document.createElement('div');
    tablist.className = 'rmx-tablist';
    tablist.setAttribute('role', 'tablist');
    panels.forEach((panel, index) => {
      const button = document.createElement('button');
      button.setAttribute('role', 'tab');
      button.textContent = panel.dataset.label ?? `Tab ${index + 1}`;
      button.addEventListener('click', () => selectTab(tabs, index));
      tablist.append(button);
    });
    tabs.prepend(tablist);
    selectTab(tabs, 0);
  }
}

function selectTab(tabs: HTMLElement, selected: number): void {
  [...tabs.querySelectorAll<HTMLElement>(':scope > .rmx-tab-panel')].forEach((panel, index) => { panel.hidden = index !== selected; });
  [...tabs.querySelectorAll<HTMLButtonElement>(':scope > .rmx-tablist > button')].forEach((button, index) => button.setAttribute('aria-selected', String(index === selected)));
}

function installCodeWalkthroughs(): void {
  for (const walkthrough of content.querySelectorAll<HTMLElement>('.rmx-code-walkthrough')) {
    const steps = [...walkthrough.querySelectorAll<HTMLElement>('[data-code-walkthrough-step]')];
    const lines = [...walkthrough.querySelectorAll<HTMLElement>('[data-code-line]')];
    const viewport = walkthrough.querySelector<HTMLElement>('[data-code-viewport]');
    const status = walkthrough.querySelector<HTMLElement>('[data-code-walkthrough-status]');
    if (!steps.length || !lines.length || !viewport) continue;
    walkthrough.dataset.enhanced = 'true';

    const activate = (selectedIndex: number, scrollSource = true) => {
      const step = steps[selectedIndex];
      if (!step) return;
      steps.forEach((candidate, index) => {
        const active = index === selectedIndex;
        candidate.toggleAttribute('data-active', active);
        candidate.querySelector('[data-code-walkthrough-trigger]')?.setAttribute('aria-pressed', String(active));
      });
      const selectedLines = expandCodeLineSelection(step.dataset.codeLines ?? '', lines.length);
      const selected = new Set(selectedLines);
      lines.forEach((line, index) => line.classList.toggle('is-active-line', selected.has(index + 1)));
      const title = step.dataset.stepTitle ?? `Section ${selectedIndex + 1}`;
      const label = step.dataset.lineLabel ?? '';
      if (status) status.textContent = `${selectedIndex + 1} of ${steps.length} · ${title}${label ? ` · ${label}` : ''}`;
      if (!scrollSource || !selectedLines.length) return;
      const line = lines[selectedLines[0] - 1];
      const top = line.offsetTop - viewport.clientHeight / 2 + line.clientHeight / 2;
      viewport.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    };

    steps.forEach((step, index) => {
      const trigger = step.querySelector<HTMLButtonElement>('[data-code-walkthrough-trigger]');
      trigger?.addEventListener('click', () => activate(index));
      trigger?.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const next = (index + direction + steps.length) % steps.length;
        steps[next]?.querySelector<HTMLButtonElement>('[data-code-walkthrough-trigger]')?.focus();
        activate(next);
      });
    });
    activate(0, false);
  }
}

async function renderMermaid(): Promise<void> {
  const darkTheme = document.body.classList.contains('vscode-dark')
    || document.body.classList.contains('vscode-high-contrast');
  mermaid.initialize(createMermaidConfig(darkTheme));
  for (const code of content.querySelectorAll<HTMLElement>('pre > code.language-mermaid')) {
    const pre = code.parentElement!;
    const shell = document.createElement('div');
    shell.className = 'rmx-mermaid';
    shell.textContent = code.textContent ?? '';
    pre.replaceWith(shell);
  }
  const diagrams = [...content.querySelectorAll<HTMLElement>('.rmx-mermaid')];
  if (diagrams.length) {
    await mermaid.run({ nodes: diagrams });
    diagrams.forEach(installMermaidControls);
  }
}

function installMermaidControls(shell: HTMLElement): void {
  const svg = shell.querySelector<SVGSVGElement>('svg');
  if (!svg) return;
  const viewBox = svg.viewBox.baseVal;
  const naturalWidth = viewBox.width || Number.parseFloat(svg.getAttribute('width') ?? '') || 800;
  const naturalHeight = viewBox.height || Number.parseFloat(svg.getAttribute('height') ?? '') || 450;
  let scale = 1;

  const toolbar = document.createElement('div');
  toolbar.className = 'rmx-mermaid-toolbar';
  toolbar.innerHTML = `
    <span>Mermaid</span>
    <div>
      <button type="button" data-action="zoom-out" title="Zoom out" aria-label="Zoom out">−</button>
      <button type="button" data-action="zoom-reset" title="Reset zoom" aria-label="Reset zoom">100%</button>
      <button type="button" data-action="zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
      <button type="button" data-action="zoom-fit" title="Fit diagram" aria-label="Fit diagram">Fit</button>
    </div>`;
  const stage = document.createElement('div');
  stage.className = 'rmx-mermaid-stage';
  svg.replaceWith(stage);
  stage.append(svg);
  shell.prepend(toolbar);

  const applyScale = () => {
    svg.setAttribute('width', String(naturalWidth * scale));
    svg.setAttribute('height', String(naturalHeight * scale));
    svg.style.maxWidth = 'none';
    const reset = toolbar.querySelector<HTMLButtonElement>('[data-action="zoom-reset"]');
    if (reset) reset.textContent = `${Math.round(scale * 100)}%`;
  };
  toolbar.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.action;
    if (!action) return;
    if (action === 'zoom-in') scale = Math.min(4, scale * 1.2);
    if (action === 'zoom-out') scale = Math.max(.25, scale / 1.2);
    if (action === 'zoom-reset') scale = 1;
    if (action === 'zoom-fit') scale = Math.min(1, Math.max(.25, (stage.clientWidth - 24) / naturalWidth));
    applyScale();
  });
  stage.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    scale = Math.min(4, Math.max(.25, scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    applyScale();
  }, { passive: false });
  applyScale();
}

window.addEventListener('message', async (event) => {
  const message = event.data;
  if (message.type === 'render') {
    content.innerHTML = message.html;
    title.textContent = message.title ?? 'Preview';
    status.textContent = '';
    installTabs();
    installCodeWalkthroughs();
    await renderMermaid().catch((error) => { status.textContent = `Mermaid: ${String(error)}`; });
    const targets = noteTargets();
    describeTargets(targets);
    placeRevisionNotes(targets);
    installNoteButton(targets);
  } else if (message.type === 'renderError') {
    content.innerHTML = `<div class="rmx-render-error"><strong>MDX preview failed</strong><pre></pre></div>`;
    content.querySelector('pre')!.textContent = message.message;
    status.textContent = 'Render error';
  } else if (message.type === 'noteError') {
    noteStatus.textContent = message.message;
    noteSave.disabled = false;
  } else if (message.type === 'noteSaved') {
    dialog.close();
    noteSave.disabled = false;
  }
});

document.querySelectorAll('[data-note-cancel]').forEach((button) => button.addEventListener('click', () => dialog.close()));
noteForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!noteInput.value.trim()) return;
  noteSave.disabled = true;
  noteStatus.textContent = 'Saving…';
  vscode.postMessage({ type: 'addNote', context: activeContext, note: noteInput.value });
});

vscode.postMessage({ type: 'ready' });
