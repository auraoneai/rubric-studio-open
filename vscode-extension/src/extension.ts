import * as vscode from 'vscode';
import { validateCriterionToml, type RubricDiagnostic } from './validator';

interface CriterionFile {
  fsPath: string;
  id: string;
  label: string;
  status: string;
  content: string;
  diagnostics: RubricDiagnostic[];
}

type WebviewMessage =
  | { type: 'validate' }
  | { type: 'refresh' }
  | { type: 'open'; file: string }
  | { type: 'save'; file: string; content: string }
  | { type: 'executeCommand'; command: string };

const webviewCommands = [
  'Validate project',
  'Open first criterion',
  'Save current criterion',
  'Prepare intake export',
  'Show browser constraints',
  'Open desktop-only sidecar note',
];

const criterionSelector: vscode.DocumentSelector = [{ scheme: 'file', pattern: '**/criteria/**/*.toml' }];
const criterionFieldSnippets: Record<string, string> = {
  id: 'id = "new-criterion"\n',
  label: 'label = "New criterion"\n',
  description: 'description = "Describe the observable behavior this criterion measures."\n',
  weight: 'weight = 0.25\n',
  scale: 'scale = "binary"\n',
  positive_examples: 'positive_examples = ["A strong matching response", "Another positive reviewer example"]\n',
  negative_examples: 'negative_examples = ["A weak or unsafe response", "Another negative reviewer example"]\n',
};
const criterionFieldOrder = Object.keys(criterionFieldSnippets);

let currentPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('rubric-studio-open');
  context.subscriptions.push(diagnostics);
  registerLiveValidation(context, diagnostics);
  registerCriterionCompletions(context);
  registerCriterionQuickFixes(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('auraone.rubricStudio.open', async () => {
      currentPanel =
        currentPanel ??
        createPanel(context, async (message) => {
          await handleWebviewMessage(message, diagnostics);
        });
      currentPanel.reveal();
      await postProject(currentPanel, diagnostics);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('auraone.rubricStudio.validate', async () => {
      const count = await validateWorkspace(diagnostics);
      await postProject(currentPanel, diagnostics);
      await vscode.window.showInformationMessage(`Rubric Studio Open validated ${count} criterion files.`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('auraone.rubricStudio.commands', async () => {
      await ensurePanel(context, diagnostics);
      await currentPanel?.webview.postMessage({ type: 'commands', commands: webviewCommands });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('auraone.rubricStudio.exportIntake', async () => {
      const files = await readCriterionFiles();
      const issueCount = files.reduce((total, file) => total + file.diagnostics.length, 0);
      await currentPanel?.webview.postMessage({ type: 'intake', count: files.length, issueCount });
      await vscode.window.showInformationMessage(
        `Rubric Studio Open prepared an intake manifest preview for ${files.length} criteria.`,
      );
    }),
  );
}

export function deactivate(): void {
  currentPanel = undefined;
}

async function ensurePanel(
  context: vscode.ExtensionContext,
  diagnostics: vscode.DiagnosticCollection,
): Promise<void> {
  if (!currentPanel) {
    currentPanel = createPanel(context, async (message) => {
      await handleWebviewMessage(message, diagnostics);
    });
  }
  currentPanel.reveal();
  await postProject(currentPanel, diagnostics);
}

async function handleWebviewMessage(
  message: unknown,
  diagnostics: vscode.DiagnosticCollection,
): Promise<void> {
  if (!isMessage(message)) {
    return;
  }

  if (message.type === 'validate' || message.type === 'refresh') {
    await validateWorkspace(diagnostics);
    await postProject(currentPanel, diagnostics);
    return;
  }

  if (message.type === 'open') {
    const files = await readCriterionFiles();
    const file = files.find((candidate) => candidate.fsPath === message.file);
    await currentPanel?.webview.postMessage({ type: 'opened', file });
    return;
  }

  if (message.type === 'save') {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(message.file), new TextEncoder().encode(message.content));
    await validateWorkspace(diagnostics);
    const files = await readCriterionFiles();
    const file = files.find((candidate) => candidate.fsPath === message.file);
    await currentPanel?.webview.postMessage({ type: 'saved', file });
    await postProject(currentPanel, diagnostics);
    return;
  }

  if (message.type === 'executeCommand') {
    if (message.command === 'Validate project') {
      await validateWorkspace(diagnostics);
      await postProject(currentPanel, diagnostics);
    }
    if (message.command === 'Prepare intake export') {
      const files = await readCriterionFiles();
      await currentPanel?.webview.postMessage({ type: 'intake', count: files.length });
    }
  }
}

async function postProject(
  panel: vscode.WebviewPanel | undefined,
  collection: vscode.DiagnosticCollection,
): Promise<void> {
  if (!panel) {
    return;
  }
  const count = await validateWorkspace(collection);
  const files = await readCriterionFiles();
  await panel.webview.postMessage({
    type: 'hydrate',
    projectRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
    files,
    count,
    commands: webviewCommands,
  });
}

async function validateWorkspace(collection: vscode.DiagnosticCollection): Promise<number> {
  const files = await vscode.workspace.findFiles('**/criteria/**/*.toml', '**/.rubric/**');
  collection.clear();
  for (const file of files) {
    const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
    const diagnostics = validateCriterionToml({ file: file.fsPath, content }).map(toDiagnostic);
    collection.set(file, diagnostics);
  }
  return files.length;
}

function registerLiveValidation(
  context: vscode.ExtensionContext,
  collection: vscode.DiagnosticCollection,
): void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const schedule = (document: vscode.TextDocument) => {
    if (!isCriterionDocument(document)) {
      return;
    }
    const key = document.uri.fsPath;
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        validateDocument(document, collection);
        void postProject(currentPanel, collection);
      }, 150),
    );
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      void validateDocument(document, collection);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document)),
    vscode.workspace.onDidSaveTextDocument((document) => {
      void validateDocument(document, collection);
      void postProject(currentPanel, collection);
    }),
    {
      dispose() {
        timers.forEach((timer) => clearTimeout(timer));
        timers.clear();
      },
    },
  );

  vscode.workspace.textDocuments.forEach((document) => {
    if (isCriterionDocument(document)) {
      void validateDocument(document, collection);
    }
  });
}

function registerCriterionCompletions(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      criterionSelector,
      {
        provideCompletionItems(document) {
          const existing = existingFields(document.getText());
          return criterionFieldOrder
            .filter((field) => !existing.has(field))
            .map((field) => {
              const item = new vscode.CompletionItem(field, vscode.CompletionItemKind.Field);
              item.detail = 'rubric-spec v1 criterion field';
              item.insertText = criterionFieldSnippets[field];
              return item;
            });
        },
      },
      '=',
      '\n',
    ),
  );
}

function registerCriterionQuickFixes(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      criterionSelector,
      {
        provideCodeActions(document, _range, actionContext) {
          return actionContext.diagnostics
            .filter((diagnostic) => diagnostic.source === 'Rubric Studio Open')
            .map((diagnostic) => quickFixForDiagnostic(document, diagnostic))
            .filter((action): action is vscode.CodeAction => action !== null);
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );
}

async function validateDocument(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
): Promise<void> {
  if (!isCriterionDocument(document)) {
    return;
  }
  collection.set(
    document.uri,
    validateCriterionToml({ file: document.uri.fsPath, content: document.getText() }).map(toDiagnostic),
  );
}

function quickFixForDiagnostic(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
): vscode.CodeAction | null {
  const field = String(diagnostic.code ?? '');
  const snippet = criterionFieldSnippets[field];
  if (!snippet) {
    return null;
  }
  const action = new vscode.CodeAction(`Add ${field} to criterion`, vscode.CodeActionKind.QuickFix);
  const edit = new vscode.WorkspaceEdit();
  const prefix = document.getText().endsWith('\n') ? '' : '\n';
  edit.insert(document.uri, new vscode.Position(document.lineCount, 0), `${prefix}${snippet}`);
  action.edit = edit;
  action.diagnostics = [diagnostic];
  action.isPreferred = diagnostic.severity === vscode.DiagnosticSeverity.Error;
  return action;
}

async function readCriterionFiles(): Promise<CriterionFile[]> {
  const files = await vscode.workspace.findFiles('**/criteria/**/*.toml', '**/.rubric/**');
  const items: CriterionFile[] = [];
  for (const file of files) {
    const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
    const diagnostics = validateCriterionToml({ file: file.fsPath, content });
    items.push({
      fsPath: file.fsPath,
      id: fieldValue(content, 'id') || file.fsPath.split('/').pop()?.replace(/\.toml$/, '') || 'criterion',
      label: fieldValue(content, 'label') || 'Untitled criterion',
      status: fieldValue(content, 'status') || 'Draft',
      content,
      diagnostics,
    });
  }
  return items.sort((a, b) => a.label.localeCompare(b.label));
}

function existingFields(content: string): Set<string> {
  return new Set(
    content
      .split('\n')
      .map((line) => /^([a-z_]+)\s*=/.exec(line.trim())?.[1])
      .filter((field): field is string => Boolean(field)),
  );
}

function isCriterionDocument(document: vscode.TextDocument): boolean {
  return /[/\\]criteria[/\\].+\.toml$/i.test(document.uri.fsPath);
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

function createPanel(
  context: vscode.ExtensionContext,
  onMessage: (message: unknown) => Promise<void>,
): vscode.WebviewPanel {
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
  panel.webview.onDidReceiveMessage(onMessage);
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};">
  <title>Rubric Studio Open</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; background: #061113; color: #e8fbff; font-family: ui-sans-serif, system-ui; }
    main { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
    header { padding: 14px 16px; border-bottom: 1px solid rgba(134,244,226,.18); display: flex; gap: 12px; justify-content: space-between; align-items: center; }
    section { padding: 18px; display: grid; grid-template-columns: 280px minmax(0, 1fr) 280px; gap: 14px; }
    .panel { border: 1px solid rgba(134,244,226,.18); border-radius: 8px; background: rgba(12,31,36,.78); padding: 14px; min-width: 0; }
    .toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
    button { border: 0; border-radius: 8px; padding: 8px 11px; background: rgba(232,251,255,.08); color: #e8fbff; font-weight: 700; text-align: left; }
    button.primary { background: linear-gradient(135deg,#34d9ff,#18d6a3); color: #031314; }
    .file { width: 100%; margin: 4px 0; display: grid; gap: 3px; }
    .file.active { outline: 2px solid #18d6a3; }
    .file small, .subtle { color: #8fb8c0; }
    textarea { width: 100%; min-height: 56vh; box-sizing: border-box; border: 1px solid rgba(134,244,226,.2); border-radius: 8px; background: #061113; color: #e8fbff; padding: 12px; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .diagnostic { border-left: 3px solid #f0c857; padding: 8px; margin: 8px 0; background: rgba(255,255,255,.04); }
    .diagnostic.error { border-left-color: #ff6b6b; }
    .diagnostic.hint { border-left-color: #7fb7ff; }
    @media (max-width: 960px) { section { grid-template-columns: 1fr; } textarea { min-height: 42vh; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div><strong>Rubric Studio Open</strong><div class="subtle" id="root">No workspace loaded</div></div>
      <div class="toolbar">
        <button id="validate" class="primary">Validate project</button>
        <button id="refresh">Refresh</button>
        <button id="intake">Prepare intake export</button>
      </div>
    </header>
    <section>
      <aside class="panel">
        <h2>Project</h2>
        <div id="files" aria-live="polite"></div>
      </aside>
      <article class="panel">
        <h2 id="editor-title">Webview editor</h2>
        <textarea id="editor" aria-label="Criterion TOML editor"></textarea>
        <div class="toolbar"><button id="save" class="primary">Save criterion</button></div>
      </article>
      <aside class="panel">
        <h2>Command palette</h2>
        <div id="commands"></div>
        <h2>Diagnostics</h2>
        <div id="diagnostics" aria-live="polite"></div>
      </aside>
    </section>
  </main>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}

function fieldValue(content: string, field: string): string {
  const match = new RegExp(`^${field}\\s*=\\s*["']?([^"']+)["']?`, 'm').exec(content);
  return match?.[1]?.trim() ?? '';
}

function isMessage(message: unknown): message is WebviewMessage {
  if (typeof message !== 'object' || message === null || !('type' in message)) {
    return false;
  }
  const type = (message as { type: unknown }).type;
  return (
    type === 'validate' ||
    type === 'refresh' ||
    type === 'open' ||
    type === 'save' ||
    type === 'executeCommand'
  );
}
