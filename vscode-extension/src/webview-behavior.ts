export type WebviewPostMessage = (message: unknown) => void;

export function requestNoteDeletion(
  noteId: string | undefined,
  postMessage: WebviewPostMessage,
): void {
  if (noteId) postMessage({ type: 'deleteNote', noteId });
}

const darkThemeVariables = {
  primaryColor: '#134e4a',
  primaryTextColor: '#f0fdfa',
  primaryBorderColor: '#2dd4bf',
  lineColor: '#5eead4',
  secondaryColor: '#1e3a5f',
  tertiaryColor: '#4c1d5f',
  background: '#0f1f1e',
  mainBkg: '#134e4a',
  secondBkg: '#1e3a5f',
  tertiaryBkg: '#4c1d5f',
  clusterBkg: '#153b39',
  clusterBorder: '#2dd4bf',
  edgeLabelBackground: '#16302f',
  actorBkg: '#134e4a',
  actorBorder: '#2dd4bf',
  actorTextColor: '#f0fdfa',
  noteBkgColor: '#312e81',
  noteTextColor: '#f5f3ff',
  noteBorderColor: '#a78bfa',
  labelBoxBkgColor: '#1e3a5f',
  labelTextColor: '#eff6ff',
};

const lightThemeVariables = {
  primaryColor: '#ffffff',
  primaryTextColor: '#0f172a',
  primaryBorderColor: '#6366f1',
  lineColor: '#4f46e5',
  secondaryColor: '#eef2ff',
  tertiaryColor: '#f8fafc',
  background: '#ffffff',
  mainBkg: '#ffffff',
  secondBkg: '#eef2ff',
  tertiaryBkg: '#f8fafc',
  clusterBkg: '#f8fafc',
  clusterBorder: '#6366f1',
  edgeLabelBackground: '#ffffff',
  actorBkg: '#ffffff',
  actorBorder: '#6366f1',
  actorTextColor: '#0f172a',
  noteBkgColor: '#eef2ff',
  noteTextColor: '#312e81',
  noteBorderColor: '#818cf8',
  labelBoxBkgColor: '#ffffff',
  labelTextColor: '#0f172a',
};

export function createMermaidConfig(darkTheme: boolean) {
  return {
    startOnLoad: false,
    securityLevel: 'strict' as const,
    theme: 'base' as const,
    themeVariables: darkTheme ? darkThemeVariables : lightThemeVariables,
    fontFamily: 'var(--vscode-font-family), Inter, ui-sans-serif, system-ui, sans-serif',
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: 'basis' as const,
    },
    sequence: { useMaxWidth: true, wrap: true },
    gantt: { useMaxWidth: true },
    er: { useMaxWidth: true },
  };
}
