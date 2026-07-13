(function () {
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  const state = {
    files: [],
    activeFile: null,
  };

  const root = document.getElementById('root');
  const files = document.getElementById('files');
  const commands = document.getElementById('commands');
  const diagnostics = document.getElementById('diagnostics');
  const editor = document.getElementById('editor');
  const editorTitle = document.getElementById('editor-title');

  bind('validate', function () {
    post({ type: 'validate' });
  });

  bind('refresh', function () {
    post({ type: 'refresh' });
  });

  bind('evidence', function () {
    post({ type: 'executeCommand', command: 'Export local evidence summary' });
  });

  bind('save', function () {
    saveActiveFile();
  });

  window.addEventListener('message', function (event) {
    const message = event.data || {};
    if (message.type === 'hydrate') {
      state.files = Array.isArray(message.files) ? message.files : [];
      root.textContent = message.projectRoot || 'No workspace loaded';
      renderFiles();
      renderCommands(message.commands || []);
      if (!state.activeFile && state.files.length > 0) {
        openFile(state.files[0]);
      }
    }
    if (message.type === 'opened' || message.type === 'saved') {
      if (message.file) {
        openFile(message.file);
      }
    }
    if (message.type === 'commands') {
      renderCommands(message.commands || []);
    }
    if (message.type === 'evidence') {
      renderEvidence(message);
    }
  });

  function bind(id, listener) {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener('click', listener);
    }
  }

  function post(message) {
    if (vscode) {
      vscode.postMessage(message);
    }
  }

  function renderFiles() {
    replaceChildren(files);
    if (state.files.length === 0) {
      files.appendChild(empty('No criteria found', 'Open a rubric project with criteria/**/*.toml files.'));
      return;
    }
    state.files.forEach(function (file) {
      const button = document.createElement('button');
      button.className = state.activeFile && state.activeFile.fsPath === file.fsPath ? 'file active' : 'file';
      button.type = 'button';
      const strong = document.createElement('strong');
      strong.textContent = file.label;
      const meta = document.createElement('small');
      meta.textContent = file.status + ' · ' + file.id + ' · ' + file.diagnostics.length + ' diagnostics';
      button.appendChild(strong);
      button.appendChild(meta);
      button.addEventListener('click', function () {
        openFile(file);
        post({ type: 'open', file: file.fsPath });
      });
      files.appendChild(button);
    });
  }

  function renderCommands(items) {
    replaceChildren(commands);
    items.forEach(function (command) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'file';
      button.textContent = command;
      button.addEventListener('click', function () {
        if (command === 'Open first criterion' && state.files[0]) {
          openFile(state.files[0]);
          return;
        }
        if (command === 'Save current criterion') {
          saveActiveFile();
          return;
        }
        if (command === 'Show browser capabilities') {
          renderNote(
            'Browser capabilities',
            'The browser studio supports authoring, verified local persistence, deterministic fixture analysis, gold calibration, checkpoint comparison, unsigned ZIP export, and explicit BYO provider calls. Native folder writes and OS keychain storage remain desktop-only.',
          );
          return;
        }
        if (command === 'Show execution contract') {
          renderNote(
            'Execution contract',
            'This VS Code surface edits and validates criterion TOML files. It does not score providers, assign reviewers, create signatures, run source-control commands, or upload project content.',
          );
          return;
        }
        post({ type: 'executeCommand', command: command });
      });
      commands.appendChild(button);
    });
  }

  function openFile(file) {
    state.activeFile = file;
    if (editorTitle) {
      editorTitle.textContent = file.label || 'Criterion editor';
    }
    if (editor instanceof HTMLTextAreaElement) {
      editor.value = file.content || '';
    }
    renderDiagnostics(file.diagnostics || []);
    renderFiles();
  }

  function renderDiagnostics(items) {
    replaceChildren(diagnostics);
    if (!items.length) {
      diagnostics.appendChild(empty('No diagnostics', 'rubric-spec style validation is clean for this criterion.'));
      return;
    }
    items.forEach(function (item) {
      const row = document.createElement('div');
      row.className = 'diagnostic ' + item.severity;
      const strong = document.createElement('strong');
      strong.textContent = item.field + ' · line ' + (item.line + 1);
      const body = document.createElement('p');
      body.textContent = item.message;
      row.appendChild(strong);
      row.appendChild(body);
      diagnostics.appendChild(row);
    });
  }

  function renderEvidence(message) {
    renderNote(
      'Local evidence summary',
      (message.count || 0) +
        ' criterion files and ' +
        (message.issueCount || 0) +
        ' diagnostics were read from this workspace. This summary is not an archive, signature, provider run, or upload.',
    );
  }

  function renderNote(titleText, bodyText) {
    replaceChildren(diagnostics);
    const block = document.createElement('div');
    block.className = 'diagnostic hint';
    const title = document.createElement('strong');
    title.textContent = titleText;
    const body = document.createElement('p');
    body.textContent = bodyText;
    block.appendChild(title);
    block.appendChild(body);
    diagnostics.appendChild(block);
  }

  function saveActiveFile() {
    if (!state.activeFile || !(editor instanceof HTMLTextAreaElement)) {
      return;
    }
    post({ type: 'save', file: state.activeFile.fsPath, content: editor.value });
  }

  function empty(title, body) {
    const node = document.createElement('div');
    node.className = 'subtle';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const p = document.createElement('p');
    p.textContent = body;
    node.appendChild(strong);
    node.appendChild(p);
    return node;
  }

  function replaceChildren(element) {
    if (!element) {
      return;
    }
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }
})();
