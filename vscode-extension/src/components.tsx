import React, { Children, type ReactElement, type ReactNode } from 'react';

type Props = Record<string, unknown> & { children?: ReactNode };

const iconText: Record<string, string> = {
  notes: '✦',
  'open-book': '▤',
  rocket: '↗',
  'left-arrow': '←',
  'right-arrow': '→',
  warning: '!',
  information: 'i',
};

function Icon({ name = 'notes', label, color, size }: Props) {
  const title = typeof label === 'string' ? label : undefined;
  return (
    <span
      className="rmx-icon"
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ color: typeof color === 'string' ? color : undefined, fontSize: typeof size === 'string' ? size : undefined }}
    >
      {iconText[String(name)] ?? '◆'}
    </span>
  );
}

function Aside({ type = 'note', title, icon, children }: Props) {
  return (
    <aside className={`starlight-aside rmx-aside-${String(type)}`}>
      <p className="rmx-aside-title"><Icon name={icon ?? (type === 'danger' || type === 'caution' ? 'warning' : 'information')} /> {String(title ?? type)}</p>
      <div>{children}</div>
    </aside>
  );
}

function Badge({ text, variant = 'default', size = 'small' }: Props) {
  return <span className={`sl-badge ${String(variant)} ${String(size)}`}>{String(text ?? '')}</span>;
}

function Card({ title, icon, children }: Props) {
  return (
    <article className="card">
      <h3>{icon ? <Icon name={icon} /> : null}{String(title ?? '')}</h3>
      <div>{children}</div>
    </article>
  );
}

function CardGrid({ children, stagger }: Props) {
  return <div className={`card-grid${stagger ? ' stagger' : ''}`}>{children}</div>;
}

function LinkCard({ title, description, href = '#', children }: Props) {
  return (
    <a className="sl-link-card" href={String(href)}>
      <strong>{String(title ?? '')}</strong>
      {description ? <span>{String(description)}</span> : children}
      <span aria-hidden="true">→</span>
    </a>
  );
}

function LinkButton({ href = '#', icon, iconPlacement = 'end', variant = 'primary', children }: Props) {
  return (
    <a className={`sl-link-button ${String(variant)}`} href={String(href)}>
      {icon && iconPlacement === 'start' ? <Icon name={icon} /> : null}
      {children}
      {icon && iconPlacement !== 'start' ? <Icon name={icon} /> : null}
    </a>
  );
}

function TabItem({ label, icon, children }: Props) {
  return <section className="rmx-tab-panel" data-label={String(label ?? 'Tab')} data-icon={icon ? String(icon) : undefined}>{children}</section>;
}

function Tabs({ children, syncKey }: Props) {
  return <div className="starlight-tabs" data-sync-key={syncKey ? String(syncKey) : undefined}>{children}</div>;
}

function Steps({ children }: Props) {
  if (React.isValidElement(children)) {
    return React.cloneElement(children as ReactElement<{ className?: string }>, {
      className: `${(children.props as { className?: string }).className ?? ''} sl-steps`.trim(),
    });
  }
  return <div className="sl-steps">{children}</div>;
}

function FileTree({ children }: Props) {
  return <div className="starlight-file-tree">{children}</div>;
}

function Code({ code = '', lang = 'text' }: Props) {
  return <pre><code className={`language-${String(lang)}`}>{String(code)}</code></pre>;
}

type CodeLineRange = { start: number; end: number };

function normalizeCodeLineSelection(value: unknown): { serialized: string; label: string } {
  const tokens = Array.isArray(value)
    ? value.map(String)
    : typeof value === 'number'
      ? [String(value)]
      : String(value ?? '').split(',').map((token) => token.trim());
  if (!tokens.length || tokens.every((token) => !token)) {
    throw new TypeError('CodeWalkthroughStep lines cannot be empty.');
  }

  const ranges = tokens.map((token): CodeLineRange => {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token);
    if (!match) throw new TypeError('CodeWalkthroughStep lines must use positive line numbers.');
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < 1) {
      throw new TypeError('CodeWalkthroughStep lines must use positive line numbers.');
    }
    if (end < start) throw new TypeError(`CodeWalkthroughStep range "${token}" must start before it ends.`);
    return { start, end };
  }).sort((left, right) => left.start - right.start || left.end - right.end);

  const merged = ranges.reduce<CodeLineRange[]>((result, range) => {
    const previous = result.at(-1);
    if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
    else result.push({ ...range });
    return result;
  }, []);
  const serialized = merged.map(({ start, end }) => start === end ? String(start) : `${start}-${end}`).join(',');
  const readable = merged.map(({ start, end }) => start === end ? String(start) : `${start}–${end}`).join(', ');
  const singular = merged.length === 1 && merged[0]?.start === merged[0]?.end;
  return { serialized, label: `${singular ? 'Line' : 'Lines'} ${readable}` };
}

function CodeWalkthroughStep({ title, lines, eyebrow = 'Section', children }: Props) {
  const stepTitle = String(title ?? '').trim();
  if (!stepTitle) throw new TypeError('CodeWalkthroughStep requires a non-empty title.');
  const selection = normalizeCodeLineSelection(lines);
  return (
    <article
      className="rmx-code-walkthrough-step"
      data-code-walkthrough-step
      data-code-lines={selection.serialized}
      data-line-label={selection.label}
      data-step-title={stepTitle}
    >
      <button type="button" className="rmx-code-walkthrough-step__trigger" data-code-walkthrough-trigger aria-pressed="false">
        <span className="rmx-code-walkthrough-step__index" aria-hidden="true" />
        <span className="rmx-code-walkthrough-step__heading">
          <span className="rmx-code-walkthrough-step__eyebrow">{String(eyebrow)}</span>
          <strong>{stepTitle}</strong>
        </span>
        <span className="rmx-code-walkthrough-step__lines">{selection.label}</span>
      </button>
      <div className="rmx-code-walkthrough-step__body">{children}</div>
    </article>
  );
}

function CodeWalkthrough({
  code = '',
  language,
  lang,
  filename = 'Source file',
  title = 'Code walkthrough',
  description,
  children,
}: Props) {
  const source = String(code).replace(/\r\n?/g, '\n');
  if (!source.trim()) throw new TypeError('CodeWalkthrough requires a non-empty code string.');
  const sourceLines = source.endsWith('\n') ? source.slice(0, -1).split('\n') : source.split('\n');
  const sourceLanguage = String(language ?? lang ?? 'text');
  const sourceFilename = String(filename);
  return (
    <section className="rmx-code-walkthrough" data-line-count={sourceLines.length}>
      <header className="rmx-code-walkthrough__header">
        <div>
          <span className="rmx-code-walkthrough__eyebrow">Guided code tour</span>
          <h3>{String(title)}</h3>
          {description ? <p>{String(description)}</p> : null}
        </div>
        <span className="rmx-code-walkthrough__status" data-code-walkthrough-status aria-live="polite">Choose a section</span>
      </header>
      <div className="rmx-code-walkthrough__layout">
        <div className="rmx-code-walkthrough__steps" data-code-walkthrough-steps>{children}</div>
        <aside className="rmx-code-walkthrough__source" aria-label={`Source code for ${sourceFilename}`}>
          <div className="rmx-code-walkthrough__source-meta">
            <span className="rmx-code-walkthrough__filename" title={sourceFilename}>{sourceFilename}</span>
            <span>{sourceLanguage} · {sourceLines.length} {sourceLines.length === 1 ? 'line' : 'lines'}</span>
          </div>
          <div className="rmx-code-walkthrough__code-viewport" data-code-viewport tabIndex={0} aria-label={`Scrollable source code for ${sourceFilename}`}>
            <pre className="rmx-code-walkthrough__plain-code"><code className={`language-${sourceLanguage}`}>
              {sourceLines.map((line, index) => (
                <span className="rmx-code-walkthrough__plain-line" data-code-line={index + 1} key={index}>{line || '\u00a0'}</span>
              ))}
            </code></pre>
          </div>
          <p className="rmx-code-walkthrough__hint">Select a section to focus its lines.</p>
        </aside>
      </div>
    </section>
  );
}

export const mdxComponents = {
  Aside,
  Badge,
  Card,
  CardGrid,
  Code,
  CodeWalkthrough,
  CodeWalkthroughStep,
  FileTree,
  Icon,
  LinkButton,
  LinkCard,
  Steps,
  TabItem,
  Tabs,
};

export const supportedComponentNames = new Set(Object.keys(mdxComponents));
