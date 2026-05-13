(function () {
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  const button = document.getElementById('validate');
  if (button) {
    button.addEventListener('click', function () {
      if (vscode) {
        vscode.postMessage({ type: 'validate' });
      }
    });
  }
})();
