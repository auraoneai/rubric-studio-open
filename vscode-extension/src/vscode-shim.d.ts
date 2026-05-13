declare module 'vscode' {
  export interface ExtensionContext {
    subscriptions: Array<{ dispose(): unknown }>;
    extensionUri: Uri;
  }

  export interface Uri {
    toString(): string;
    fsPath: string;
  }

  export interface Webview {
    html: string;
    options: Record<string, unknown>;
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
  }

  export class Range {
    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
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
    findFiles(include: string, exclude?: string): Thenable<Uri[]>;
    fs: {
      readFile(uri: Uri): Thenable<Uint8Array>;
    };
  };

  export const languages: {
    createDiagnosticCollection(name: string): DiagnosticCollection;
  };

  export const Uri: {
    joinPath(base: Uri, ...pathSegments: string[]): Uri;
  };
}
