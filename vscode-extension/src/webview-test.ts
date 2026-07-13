import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

type Listener = (event?: { data?: unknown }) => void;

class TestElement {
  readonly tagName: string;
  id = '';
  className = '';
  type = '';
  value = '';
  parent: TestElement | null = null;
  children: TestElement[] = [];
  private ownText = '';
  private readonly listeners = new Map<string, Listener[]>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get textContent(): string {
    return [this.ownText, ...this.children.map((child) => child.textContent)].join('');
  }

  set textContent(value: string) {
    this.ownText = value;
    this.children = [];
  }

  get firstChild(): TestElement | null {
    return this.children[0] ?? null;
  }

  appendChild(child: TestElement): TestElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: TestElement): TestElement {
    this.children = this.children.filter((candidate) => candidate !== child);
    child.parent = null;
    return child;
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  click(): void {
    for (const listener of this.listeners.get('click') ?? []) {
      listener();
    }
  }
}

class TestTextAreaElement extends TestElement {
  constructor() {
    super('textarea');
  }
}

class TestDocument {
  readonly elements = new Map<string, TestElement>();

  constructor() {
    ['root', 'files', 'commands', 'diagnostics', 'editor-title', 'validate', 'refresh', 'evidence', 'save'].forEach((id) => {
      this.elements.set(id, element('div', id));
    });
    this.elements.set('editor', textarea('editor'));
  }

  getElementById(id: string): TestElement | null {
    return this.elements.get(id) ?? null;
  }

  createElement(tagName: string): TestElement {
    return tagName.toLowerCase() === 'textarea' ? new TestTextAreaElement() : new TestElement(tagName);
  }
}

const root = join(process.cwd(), 'vscode-extension');
const script = readFileSync(join(root, 'media/webview.js'), 'utf8');
const document = new TestDocument();
const postedMessages: unknown[] = [];
const windowListeners = new Map<string, Listener[]>();
const context = {
  document,
  HTMLTextAreaElement: TestTextAreaElement,
  acquireVsCodeApi: () => ({
    postMessage: (message: unknown) => postedMessages.push(message),
  }),
  window: {
    addEventListener: (type: string, listener: Listener) => {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener]);
    },
  },
};

vm.runInNewContext(script, context);

dispatchMessage({
  type: 'hydrate',
  projectRoot: '/workspace/rubric',
  commands: [
    'Open first criterion',
    'Save current criterion',
    'Show browser capabilities',
    'Show execution contract',
    'Export local evidence summary',
  ],
  files: [
    criterionFile('/workspace/rubric/criteria/safety/safe-refusal.toml', 'safe-refusal', 'Safe refusal', 'Live', 1),
    criterionFile('/workspace/rubric/criteria/helpfulness/specificity.toml', 'specificity', 'Specificity', 'Draft', 0),
  ],
});

assert.equal(text('root'), '/workspace/rubric');
assert.equal(text('editor-title'), 'Safe refusal');
assert.match(textareaValue('editor'), /id = "safe-refusal"/);
assert.match(text('diagnostics'), /label . line 2/);
assert.match(text('files'), /Safe refusal/);
assert.match(text('commands'), /Show browser capabilities/);

buttonIn('files', 'Specificity').click();
assertPost({ type: 'open', file: '/workspace/rubric/criteria/helpfulness/specificity.toml' });
assert.equal(text('editor-title'), 'Specificity');
assert.match(text('diagnostics'), /No diagnostics/);

const editor = document.getElementById('editor') as TestTextAreaElement;
editor.value = 'id = "specificity"\nlabel = "Specificity"\n';
button('save').click();
assertPost({
  type: 'save',
  file: '/workspace/rubric/criteria/helpfulness/specificity.toml',
  content: 'id = "specificity"\nlabel = "Specificity"\n',
});

buttonIn('commands', 'Open first criterion').click();
assert.equal(text('editor-title'), 'Safe refusal');
assert.match(textareaValue('editor'), /id = "safe-refusal"/);
assert.notDeepEqual(lastPost(), { type: 'executeCommand', command: 'Open first criterion' });

editor.value = 'id = "safe-refusal"\nlabel = "Safe refusal updated"\n';
buttonIn('commands', 'Save current criterion').click();
assertPost({
  type: 'save',
  file: '/workspace/rubric/criteria/safety/safe-refusal.toml',
  content: 'id = "safe-refusal"\nlabel = "Safe refusal updated"\n',
});

buttonIn('commands', 'Show browser capabilities').click();
assert.match(text('diagnostics'), /Browser capabilities/);
assert.match(text('diagnostics'), /gold calibration/);
assert.notDeepEqual(lastPost(), { type: 'executeCommand', command: 'Show browser capabilities' });

buttonIn('commands', 'Show execution contract').click();
assert.match(text('diagnostics'), /Execution contract/);
assert.match(text('diagnostics'), /does not score providers/);
assert.notDeepEqual(lastPost(), { type: 'executeCommand', command: 'Show execution contract' });

button('validate').click();
assertPost({ type: 'validate' });
button('refresh').click();
assertPost({ type: 'refresh' });
button('evidence').click();
assertPost({ type: 'executeCommand', command: 'Export local evidence summary' });

dispatchMessage({ type: 'evidence', count: 2, issueCount: 1 });
assert.match(text('diagnostics'), /Local evidence summary/);
assert.match(text('diagnostics'), /2 criterion files and 1 diagnostics/);

console.log('Rubric Studio Open VS Code webview behavior passed.');

function criterionFile(fsPath: string, id: string, label: string, status: string, diagnosticCount: number) {
  return {
    fsPath,
    id,
    label,
    status,
    content: `id = "${id}"\nlabel = "${label}"\n`,
    diagnostics: Array.from({ length: diagnosticCount }, () => ({
      severity: 'error',
      field: 'label',
      line: 1,
      message: 'Label needs a reviewer-facing value.',
    })),
  };
}

function element(tagName: string, id = ''): TestElement {
  const node = new TestElement(tagName);
  node.id = id;
  return node;
}

function textarea(id = ''): TestTextAreaElement {
  const node = new TestTextAreaElement();
  node.id = id;
  return node;
}

function dispatchMessage(data: unknown): void {
  for (const listener of windowListeners.get('message') ?? []) {
    listener({ data });
  }
}

function button(id: string): TestElement {
  const node = document.getElementById(id);
  assert.ok(node, `Expected #${id} to exist`);
  return node;
}

function buttonIn(id: string, label: string): TestElement {
  const rootNode = button(id);
  const match = find(rootNode, (node) => node.tagName === 'BUTTON' && node.textContent.includes(label));
  assert.ok(match, `Expected a button containing ${label}`);
  return match;
}

function find(node: TestElement, predicate: (candidate: TestElement) => boolean): TestElement | null {
  if (predicate(node)) {
    return node;
  }
  for (const child of node.children) {
    const match = find(child, predicate);
    if (match) {
      return match;
    }
  }
  return null;
}

function text(id: string): string {
  return button(id).textContent;
}

function textareaValue(id: string): string {
  const node = button(id);
  assert.ok(node instanceof TestTextAreaElement, `Expected #${id} to be a textarea`);
  return node.value;
}

function lastPost(): unknown {
  return postedMessages.at(-1);
}

function assertPost(expected: unknown): void {
  assert.deepEqual(JSON.parse(JSON.stringify(lastPost())), expected);
}
