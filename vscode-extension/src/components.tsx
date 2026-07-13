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

export const mdxComponents = {
  Aside,
  Badge,
  Card,
  CardGrid,
  Code,
  FileTree,
  Icon,
  LinkButton,
  LinkCard,
  Steps,
  TabItem,
  Tabs,
};

export const supportedComponentNames = new Set(Object.keys(mdxComponents));
