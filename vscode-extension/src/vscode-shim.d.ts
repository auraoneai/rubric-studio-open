declare module 'vscode' {
  export interface ExtensionContext {
    subscriptions: Array<{ dispose(): unknown }>;
    extensionUri: Uri;
  }

  export interface Uri {
    toString(): string;
    fsPath: string;
  }

  export interface TextDocument {
    uri: Uri;
    lineCount: number;
    getText(): string;
  }

  export interface TextDocumentChangeEvent {
    document: TextDocument;
  }

  export interface CodeActionContext {
    diagnostics: Diagnostic[];
  }

  export type DocumentSelector = Array<{ scheme?: string; language?: string; pattern?: string }>;

  export interface Webview {
    html: string;
    options: Record<string, unknown>;
    cspSource: string;
    asWebviewUri(uri: Uri): Uri;
    postMessage(message: unknown): Thenable<boolean>;
    onDidReceiveMessage(listener: (message: unknown) => unknown): { dispose(): unknown };
  }

  export interface WebviewPanel {
    webview: Webview;
    reveal(): void;
    onDidDispose(listener: () => unknown): { dispose(): unknown };
  }

  export interface DiagnosticCollection {
    set(uri: Uri, diagnostics: Diagnostic[]): void;
    clear(): void;
    dispose(): void;
  }

  export class Diagnostic {
    constructor(range: Range, message: string, severity: DiagnosticSeverity);
    source?: string;
    code?: string;
    severity: DiagnosticSeverity;
  }

  export class Range {
    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
  }

  export class Position {
    constructor(line: number, character: number);
  }

  export class WorkspaceEdit {
    insert(uri: Uri, position: Position, text: string): void;
  }

  export class CodeAction {
    constructor(title: string, kind: CodeActionKind);
    edit?: WorkspaceEdit;
    diagnostics?: Diagnostic[];
    isPreferred?: boolean;
  }

  export class CodeActionKind {
    static readonly QuickFix: CodeActionKind;
  }

  export class CompletionItem {
    constructor(label: string, kind?: CompletionItemKind);
    detail?: string;
    insertText?: string;
  }

  export enum CompletionItemKind {
    Field = 5,
  }

  export enum DiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3,
  }

  export enum ViewColumn {
    One = 1,
  }

  export const commands: {
    registerCommand(command: string, callback: (...args: unknown[]) => unknown): { dispose(): unknown };
  };

  export const window: {
    createWebviewPanel(
      viewType: string,
      title: string,
      column: ViewColumn,
      options: Record<string, unknown>,
    ): WebviewPanel;
    showInformationMessage(message: string): Thenable<string | undefined>;
    showWarningMessage(message: string): Thenable<string | undefined>;
  };

  export const workspace: {
    workspaceFolders?: Array<{ uri: Uri }>;
    textDocuments: TextDocument[];
    findFiles(include: string, exclude?: string): Thenable<Uri[]>;
    onDidOpenTextDocument(listener: (document: TextDocument) => unknown): { dispose(): unknown };
    onDidChangeTextDocument(listener: (event: TextDocumentChangeEvent) => unknown): { dispose(): unknown };
    onDidSaveTextDocument(listener: (document: TextDocument) => unknown): { dispose(): unknown };
    fs: {
      readFile(uri: Uri): Thenable<Uint8Array>;
      writeFile(uri: Uri, content: Uint8Array): Thenable<void>;
    };
  };

  export const languages: {
    createDiagnosticCollection(name: string): DiagnosticCollection;
    registerCodeActionsProvider(
      selector: DocumentSelector,
      provider: {
        provideCodeActions(
          document: TextDocument,
          range: Range,
          context: CodeActionContext,
        ): CodeAction[] | Thenable<CodeAction[]>;
      },
      metadata?: { providedCodeActionKinds: CodeActionKind[] },
    ): { dispose(): unknown };
    registerCompletionItemProvider(
      selector: DocumentSelector,
      provider: {
        provideCompletionItems(document: TextDocument): CompletionItem[] | Thenable<CompletionItem[]>;
      },
      ...triggerCharacters: string[]
    ): { dispose(): unknown };
  };

  export const Uri: {
    file(path: string): Uri;
    joinPath(base: Uri, ...pathSegments: string[]): Uri;
  };
}
