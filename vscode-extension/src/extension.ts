import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { appendRevisionNote, deleteRevisionNote } from './notes.js';
import { renderMdx } from './renderer.js';

type PreviewMessage =
  | { type: 'ready' }
  | { type: 'addNote'; context: string; note: string }
  | { type: 'deleteNote'; noteId: string };

class PreviewSession implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private renderGeneration = 0;
  private updateTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly document: vscode.TextDocument,
    private readonly panel: vscode.WebviewPanel,
  ) {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media'), vscode.Uri.joinPath(context.extensionUri, 'dist')],
    };
    panel.webview.html = this.shellHtml();
    this.disposables.push(
      panel,
      panel.webview.onDidReceiveMessage((message: PreviewMessage) => void this.handleMessage(message)),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === document.uri.toString()) this.scheduleUpdate();
      }),
    );
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Beside, true);
    void this.update();
  }

  dispose(): void {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }

  private scheduleUpdate(): void {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => void this.update(), 180);
  }

  private async update(): Promise<void> {
    const generation = ++this.renderGeneration;
    try {
      const html = await renderMdx(this.document.getText());
      if (generation !== this.renderGeneration) return;
      await this.panel.webview.postMessage({
        type: 'render',
        html,
        title: this.document.fileName.split(/[\\/]/).at(-1),
      });
    } catch (error) {
      if (generation !== this.renderGeneration) return;
      const message = error instanceof Error ? error.message : String(error);
      await this.panel.webview.postMessage({ type: 'renderError', message });
    }
  }

  private async handleMessage(message: PreviewMessage): Promise<void> {
    if (message.type === 'ready') {
      await this.update();
      return;
    }
    try {
      const source = this.document.getText();
      const updated = message.type === 'addNote'
        ? appendRevisionNote(source, message.context, message.note)
        : deleteRevisionNote(source, message.noteId);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        this.document.uri,
        new vscode.Range(this.document.positionAt(0), this.document.positionAt(source.length)),
        updated,
      );
      if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code could not update the MDX document.');
      await this.panel.webview.postMessage({ type: 'noteSaved' });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.panel.webview.postMessage({ type: 'noteError', message: detail });
    }
  }

  private shellHtml(): string {
    const nonce = randomBytes(18).toString('base64');
    const styleUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.css'));
    const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this.panel.webview.cspSource} data: https:; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link rel="stylesheet" href="${styleUri}">
    <title>render-mdx Preview</title>
  </head>
  <body>
    <header class="rmx-toolbar"><span class="rmx-mark">MDX</span><strong data-document-title>Preview</strong><span data-status>Rendering…</span></header>
    <main class="rmx-page"><article class="sl-markdown-content" data-content></article></main>
    <dialog class="rmx-note-dialog" data-note-dialog>
      <form method="dialog" data-note-form>
        <div class="rmx-dialog-header"><div><small>REVISION NOTE</small><strong>Add feedback to this MDX file</strong></div><button type="button" data-note-cancel aria-label="Close">×</button></div>
        <p data-note-context></p>
        <textarea data-note-input rows="5" maxlength="10000" required placeholder="What should be revised, clarified, removed, or added?"></textarea>
        <p class="rmx-note-status" data-note-status aria-live="polite"></p>
        <div class="rmx-dialog-actions"><button type="button" data-note-cancel>Cancel</button><button type="submit" class="primary" data-note-save>Save to MDX</button></div>
      </form>
    </dialog>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

const sessions = new Map<string, PreviewSession>();

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('renderMdx.openPreview', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.toLowerCase().endsWith('.mdx')) {
      void vscode.window.showInformationMessage('Open an .mdx file to use the render-mdx preview.');
      return;
    }
    const key = editor.document.uri.toString();
    const existing = sessions.get(key);
    if (existing) {
      existing.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'renderMdx.preview',
      `${editor.document.fileName.split(/[\\/]/).at(-1)} Preview`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {},
    );
    const session = new PreviewSession(context, editor.document, panel);
    sessions.set(key, session);
    panel.onDidDispose(() => sessions.delete(key));
    context.subscriptions.push(session);
  }));
}

export function deactivate(): void {
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
}
