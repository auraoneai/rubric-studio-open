import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.RSO_TAURI_DRIVER_PORT ?? 4455);
const application = process.env.RSO_TAURI_APP_PATH ?? defaultApplicationPath();

const driverProbe = spawnSync('tauri-driver', ['--help'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const driverOutput = `${driverProbe.stdout ?? ''}${driverProbe.stderr ?? ''}`.trim();
if (driverProbe.status !== 0) {
  throw new Error(`Tauri native e2e requires a supported tauri-driver WebDriver backend: ${driverOutput || 'tauri-driver unavailable'}`);
}

assert.ok(existsSync(application), `Build the Tauri app before native e2e; missing ${application}`);

const driver = spawn('tauri-driver', ['--port', String(port)], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});

let driverOutputBuffer = '';
driver.stdout.on('data', (chunk) => {
  driverOutputBuffer += String(chunk);
});
driver.stderr.on('data', (chunk) => {
  driverOutputBuffer += String(chunk);
});

try {
  await waitForDriver();
  const session = await webdriver('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'wry',
        'tauri:options': { application },
      },
    },
  });
  const sessionId = session.value?.sessionId ?? session.sessionId;
  assert.ok(sessionId, `WebDriver did not return a session id: ${JSON.stringify(session)}`);

  try {
    await waitForText(sessionId, 'Rubric Studio Open');
    await clickButtonByText(sessionId, 'Skip');
    await clickButtonByText(sessionId, 'Settings');
    await waitForText(sessionId, 'Crash reports and updates');
    await clickButtonByText(sessionId, 'Check for updates');
    await waitForAnyText(sessionId, ['unavailable', 'current', 'available', 'error']);
  } finally {
    await webdriver('DELETE', `/session/${sessionId}`).catch(() => null);
  }

  console.log('Rubric Studio Open native Tauri e2e smoke passed.');
} finally {
  driver.kill('SIGTERM');
}

function defaultApplicationPath() {
  if (process.platform === 'win32') {
    return join(root, 'src-tauri/target/debug/rubric-studio-open.exe');
  }
  return join(root, 'src-tauri/target/debug/rubric-studio-open');
}

async function waitForDriver() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (driver.exitCode !== null) {
      throw new Error(`tauri-driver exited early:\n${driverOutputBuffer}`);
    }
    try {
      const status = await webdriver('GET', '/status');
      if (status?.value?.ready !== false) {
        return;
      }
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Timed out waiting for tauri-driver on port ${port}\n${driverOutputBuffer}`);
}

async function clickButtonByText(sessionId, text) {
  return execute(sessionId, `
    const needle = arguments[0].toLowerCase();
    const button = Array.from(document.querySelectorAll('button'))
      .find((candidate) => candidate.textContent.trim().toLowerCase().includes(needle));
    if (!button) return false;
    button.click();
    return true;
  `, [text]);
}

async function waitForText(sessionId, text) {
  return waitForAnyText(sessionId, [text]);
}

async function waitForAnyText(sessionId, texts) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const found = await execute(sessionId, `
      const bodyText = document.body?.innerText ?? '';
      return arguments[0].some((text) => bodyText.includes(text));
    `, [texts]);
    if (found.value === true) {
      return;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for native app text: ${texts.join(' | ')}`);
}

async function execute(sessionId, script, args = []) {
  return webdriver('POST', `/session/${sessionId}/execute/sync`, { script, args });
}

async function webdriver(method, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
  }
  return parsed;
}
