import * as vscode from 'vscode';
import { validateCriterionToml, type RubricDiagnostic } from './validator';

let currentPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('rubric-studio-open');
  context.subscriptions.push(diagnostics);

  context.subscriptions.push(
    vscode.commands.registerCommand('auraone.rubricStudio.open', async () => {
      currentPanel =
        currentPanel ??
        createPanel(context, async () => {
          const count = await validateWorkspace(diagnostics);
          await vscode.window.showInformationMessage(`Rubric Studio validated ${count} criterion files.`);
        });
      currentPanel.reveal();
      await currentPanel.webview.postMessage({
        type: 'hydrate',
        projectRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
      });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('auraone.rubricStudio.validate', async () => {
      const count = await validateWorkspace(diagnostics);
      await vscode.window.showInformationMessage(`Rubric Studio validated ${count} criterion files.`);
    }),
  );
}

export function deactivate(): void {
  currentPanel = undefined;
}

async function validateWorkspace(collection: vscode.DiagnosticCollection): Promise<number> {
  const files = await vscode.workspace.findFiles('**/criteria/**/*.toml', '**/.rubric/**');
  collection.clear();
  for (const file of files) {
    const bytes = await vscode.workspace.fs.readFile(file);
    const content = new TextDecoder().decode(bytes);
    const diagnostics = validateCriterionToml({ file: file.fsPath, content }).map(toDiagnostic);
    collection.set(file, diagnostics);
  }
  return files.length;
}

function toDiagnostic(input: RubricDiagnostic): vscode.Diagnostic {
  const severity =
    input.severity === 'error'
      ? vscode.DiagnosticSeverity.Error
      : input.severity === 'warning'
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Hint;
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(Math.max(0, input.line), 0, Math.max(0, input.line), 120),
    input.message,
    severity,
  );
  diagnostic.source = 'Rubric Studio Open';
  diagnostic.code = input.field;
  return diagnostic;
}

function createPanel(context: vscode.ExtensionContext, validate: () => Promise<void>): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'rubricStudioOpen',
    'Rubric Studio Open',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [context.extensionUri],
    },
  );

  panel.webview.html = webviewHtml(panel.webview, context.extensionUri);
  panel.webview.onDidReceiveMessage(async (message) => {
    if (isMessage(message) && message.type === 'validate') {
      await validate();
    }
  });
  panel.onDidDispose(() => {
    currentPanel = undefined;
  });
  return panel;
}

function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.js'));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${scriptUri};">
  <title>Rubric Studio Open</title>
  <style>
    body { margin: 0; background: #061113; color: #e8fbff; font-family: ui-sans-serif, system-ui; }
    main { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
    header { padding: 14px 16px; border-bottom: 1px solid rgba(134,244,226,.18); display: flex; justify-content: space-between; }
    section { padding: 18px; display: grid; grid-template-columns: 260px 1fr; gap: 14px; }
    .panel { border: 1px solid rgba(134,244,226,.18); border-radius: 8px; background: rgba(12,31,36,.78); padding: 14px; }
    button { border: 0; border-radius: 8px; padding: 8px 11px; background: linear-gradient(135deg,#34d9ff,#18d6a3); color: #031314; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <header><strong>Rubric Studio Open</strong><button id="validate">Validate project</button></header>
    <section>
      <aside class="panel"><h2>Project</h2><p>Workspace rubric files appear in the VS Code explorer. Diagnostics use rubric-spec-style validation.</p></aside>
      <article class="panel"><h2>Webview editor</h2><p>This surface opens the same folder-based rubric project format, provides command-palette integration, and delegates full desktop-only sidecars to the Tauri app.</p></article>
    </section>
  </main>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}

function isMessage(message: unknown): message is { type: string } {
  return typeof message === 'object' && message !== null && 'type' in message;
}
