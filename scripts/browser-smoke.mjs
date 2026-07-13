import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.RSO_E2E_PORT ?? 5208);
const baseUrl = `http://127.0.0.1:${port}`;
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const server = spawn(
  process.execPath,
  [
    join(root, 'node_modules/vite/bin/vite.js'),
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
  {
    cwd: root,
    env: { ...process.env, CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let serverOutput = '';
let serverStartError;
server.stdout.on('data', (chunk) => {
  serverOutput += String(chunk);
});
server.stderr.on('data', (chunk) => {
  serverOutput += String(chunk);
});
server.on('error', (error) => {
  serverStartError = error;
});

try {
  await waitForServer(baseUrl);
  const browser = await chromium.launch();
  await verifyFirstRunAndOverlayContract(browser);
  await verifyBrowserPersistenceFailure(browser);
  await verifyLocalOnlyLaunch(browser);
  await verifyOperationalWorkflow(browser);
  await browser.close();
  console.log('Rubric Studio Open browser e2e smoke passed.');
} finally {
  server.kill('SIGTERM');
}

async function verifyFirstRunAndOverlayContract(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(`${baseUrl}/?surface=browser`, { waitUntil: 'networkidle' });

  const wizard = page.getByRole('dialog', { name: 'First-run wizard' });
  await expect(wizard).toBeVisible();
  await expect(wizard.getByRole('button', { name: 'Start tour' })).toBeFocused();
  expect(await page.locator('.topbar').evaluate((element) => ({
    inert: element.inert,
    ariaHidden: element.getAttribute('aria-hidden'),
  }))).toEqual({ inert: true, ariaHidden: 'true' });

  for (let index = 0; index < 18; index += 1) {
    await page.keyboard.press('Tab');
    expect(await wizard.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(wizard).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('rso:onboarded'))).toBe('yes');

  const templateTrigger = page.getByRole('button', { name: 'New from Template' });
  await templateTrigger.focus();
  await templateTrigger.click();
  const templateDialog = page.getByRole('dialog', { name: 'Create from template' });
  await expect(templateDialog).toBeVisible();
  await expect(page.getByLabel('Project name')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(templateDialog).toHaveCount(0);
  await expect(templateTrigger).toBeFocused();

  const reopened = await context.newPage();
  await reopened.goto(`${baseUrl}/?surface=browser`, { waitUntil: 'networkidle' });
  await expect(reopened.getByRole('dialog', { name: 'First-run wizard' })).toHaveCount(0);
  await context.close();
}

async function verifyBrowserPersistenceFailure(browser) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 760 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('rso:onboarded', 'yes');
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === 'rso:project') {
        throw new DOMException('Simulated browser quota failure', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    };
  });
  await page.goto(`${baseUrl}/?surface=browser`, { waitUntil: 'networkidle' });
  await expect(page.locator('.save-readout.error')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.save-readout.error')).toHaveAttribute(
    'title',
    /Simulated browser quota failure/,
  );
  await context.close();
}

async function verifyLocalOnlyLaunch(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await context.addInitScript(() => {
    localStorage.setItem('rso:onboarded', 'yes');
  });
  const page = await context.newPage();
  const externalRequests = [];
  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      requestUrl.origin === baseUrl ||
      requestUrl.protocol === 'data:' ||
      requestUrl.protocol === 'blob:'
    ) {
      await route.continue();
      return;
    }
    externalRequests.push(route.request().url());
    await route.abort('blockedbyclient');
  });

  await page.goto(`${baseUrl}/?surface=browser`, { waitUntil: 'networkidle' });
  await page.getByLabel('Label').fill('No-network safe refusal');
  await expect(page.getByRole('heading', { name: 'No-network safe refusal' })).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() => {
      const project = JSON.parse(localStorage.getItem('rso:project') ?? '{}');
      return project.criteria?.some((criterion) => criterion.label === 'No-network safe refusal');
    }),
  ).toBe(true);
  expect(externalRequests).toEqual([]);
  await context.close();
}

async function verifyOperationalWorkflow(browser) {
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 920 },
  });
  await context.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('rso:onboarded', 'yes');
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  let directProviderRequests = 0;

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  await page.route('https://api.openai.com/v1/responses', async (route) => {
    directProviderRequests += 1;
    const request = route.request();
    expect(request.headers().authorization).toBe('Bearer sk-e2e-browser-provider');
    const body = request.postDataJSON();
    expect(body.model).toBe('gpt-5.5');
    expect(body.input).toContain('Return only JSON');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        output_text:
          '{"verdict":"pass","confidence":0.94,"reasoning":"Direct provider result returned by the browser e2e fixture."}',
      }),
    });
  });

  await page.goto(`${baseUrl}/?surface=browser`, { waitUntil: 'networkidle' });
  await expect(page.locator('.rso-browser-controls')).toBeVisible();
  const exportProjectBundle = page.getByRole('button', { name: 'Export project bundle' });
  await expect(exportProjectBundle).toBeVisible();
  await expect(page.locator('.rso-browser-controls input[type="file"]')).toBeAttached();

  const [initialDownload] = await Promise.all([
    page.waitForEvent('download'),
    exportProjectBundle.click(),
  ]);
  expect(initialDownload.suggestedFilename()).toBe(
    'helpful-response-evaluation.rubric-project.json',
  );
  const initialPath = await initialDownload.path();
  if (!initialPath) throw new Error('Browser project export did not produce a local file.');
  const initialBundle = JSON.parse(await readFile(initialPath, 'utf8'));
  expect(initialBundle.project.name).toBe('Helpful Response Evaluation');

  const importInput = page.locator('.rso-browser-controls input[type="file"]');
  await importInput.setInputFiles({
    name: 'invalid-project.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"project":{"id":"broken","criteria":[]}}'),
  });
  await expect(page.getByRole('alert')).toContainText('Invalid project bundle');
  await expect(page.getByRole('button', { name: 'Download valid template' })).toBeVisible();

  const importedProject = structuredClone(initialBundle.project);
  importedProject.id = 'browser-contract-project';
  importedProject.name = 'Browser Contract Project';
  await importInput.setInputFiles({
    name: 'browser-contract-project.rubric-project.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ project: importedProject })),
  });
  await expect(page.getByLabel('Current project')).toContainText('Browser Contract Project');
  await expect.poll(() =>
    page.evaluate(() => JSON.parse(localStorage.getItem('rso:project') ?? '{}').name),
  ).toBe('Browser Contract Project');

  const labelInput = page.getByLabel('Label');
  await labelInput.fill('Shortcut isolation criterion');
  await page.keyboard.press(`${modifier}+2`);
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press(`${modifier}+2`);
  await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();

  const sampleInput = page.getByLabel('Load sample JSONL');
  await sampleInput.setInputFiles({
    name: 'bad-samples.jsonl',
    mimeType: 'application/jsonl',
    buffer: Buffer.from('{"id":"missing-response","prompt":"Prompt"}\nnot-json'),
  });
  await expect(page.getByRole('alert')).toContainText('Sample import failed');
  await sampleInput.setInputFiles({
    name: 'unlabeled-samples.jsonl',
    mimeType: 'application/jsonl',
    buffer: Buffer.from(
      JSON.stringify({
        id: 'jsonl-unlabeled-1',
        prompt: 'Inspect an imported sample.',
        response: 'This response names uncertainty and gives a concrete safe next step.',
        metadata: { source: 'browser-e2e' },
      }),
    ),
  });
  await expect(page.locator('.success-chip', { hasText: 'Missing gold labels remain unlabeled' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const project = JSON.parse(localStorage.getItem('rso:project') ?? '{}');
    return JSON.stringify(
      project.samples?.find((sample) => sample.id === 'jsonl-unlabeled-1')?.goldScores ?? null,
    );
  })).toBe('{}');

  await page.getByRole('tab', { name: /Settings/i }).click();
  const openAiRow = page.locator('.rs-provider-row', { hasText: 'OpenAI GPT-5.5' });
  await openAiRow.locator('input[aria-label="OpenAI GPT-5.5 API key"]').fill(
    'sk-e2e-browser-provider',
  );
  await openAiRow.getByRole('button', { name: 'Configure key' }).click();
  await expect(
    openAiRow.locator('input[aria-label="OpenAI GPT-5.5 API key"]'),
  ).toHaveAttribute('placeholder', 'Configured in session');

  await page.getByRole('tab', { name: /Preview/i }).click();
  const openAiPanel = page.locator('.rs-judge-panel', { hasText: 'OpenAI GPT-5.5' });
  await openAiPanel.getByRole('button', { name: 'Run provider' }).first().click();
  await expect(openAiPanel).toContainText('Direct provider result returned');
  expect(directProviderRequests).toBe(1);

  const existingCoverage = await page.evaluate(() => {
    const project = JSON.parse(localStorage.getItem('rso:project') ?? '{}');
    return project.samples.reduce(
      (total, sample) => total + Object.keys(sample.goldScores ?? {}).length,
      0,
    );
  });
  await page.getByRole('tab', { name: /Calibrate/i }).click();
  await page.locator('.rs-calibration-surface input[type="file"]').setInputFiles({
    name: 'expert-gold.jsonl',
    mimeType: 'application/jsonl',
    buffer: Buffer.from(
      JSON.stringify({
        id: 'expert-gold-new-sample',
        prompt: 'A new held-out expert-labeled prompt.',
        response: 'I cannot provide harmful instructions, but I can offer a safe alternative and cite uncertainty.',
        scores: {
          'safe-refusal': 1,
          'actionable-alternative': 1,
          specificity: 1,
          'cites-uncertainty': 1,
        },
      }),
    ),
  });
  await expect(page.locator('.success-chip', { hasText: '4 labeled decisions' })).toBeVisible();
  await expect(
    page.locator('.rs-metric-strip > div', { hasText: 'Gold coverage' }).locator('strong'),
  ).toHaveText(String(existingCoverage + 4));
  await page.getByRole('button', { name: 'Recompute calibration' }).click();
  await expect(
    page.locator('.success-chip', { hasText: `${existingCoverage + 4} labeled decisions` }),
  ).toBeVisible();

  await page.getByRole('tab', { name: /Author/i }).click();
  const description = page.getByLabel('Reviewer-visible behavior');
  const originalDescription = await description.inputValue();
  await description.fill(`${originalDescription} Require a quoted uncertainty boundary.`);
  await page.getByRole('tab', { name: /Diff/i }).click();
  await expect(page.locator('.rs-change-card')).toHaveCount(1);
  await expect(page.locator('.rs-change-card')).toContainText('description');
  await page.getByRole('button', { name: 'Save checkpoint' }).click();
  await expect(page.locator('.success-chip', { hasText: 'Saved local comparison checkpoint' })).toBeVisible();
  await expect(page.getByText('Working draft matches checkpoint')).toBeVisible();

  await page.getByRole('tab', { name: /Author/i }).click();
  await description.fill(`${originalDescription} Add a second local checkpoint change.`);
  await page.getByRole('tab', { name: /Diff/i }).click();
  await expect(page.locator('.rs-change-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Restore checkpoint' }).click();
  await expect(page.locator('.success-chip', { hasText: 'Restored the working draft' })).toBeVisible();
  await expect(page.getByText('Working draft matches checkpoint')).toBeVisible();

  await page.getByRole('tab', { name: /Export/i }).click();
  await expect(page.getByText('Signing:')).toContainText('Unavailable');
  const [packageDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Create evidence ZIP' }).click(),
  ]);
  expect(packageDownload.suggestedFilename()).toBe(
    'browser-contract-project.rubric-evidence.zip',
  );
  const packagePath = await packageDownload.path();
  if (!packagePath) throw new Error('Evidence ZIP download did not produce a local file.');
  const entries = readStoredZipEntries(await readFile(packagePath));
  const manifestEntry = [...entries.entries()].find(([name]) => name.endsWith('/manifest.json'));
  if (!manifestEntry) throw new Error('Evidence ZIP is missing manifest.json.');
  const manifest = JSON.parse(manifestEntry[1].toString('utf8'));
  expect(manifest.signed).toBe(false);
  expect(manifest.signature).toBeNull();
  expect(manifest.signingStatus).toBe('unavailable-in-this-build');
  expect(manifest.privacy.destination).toBe('local-download');
  expect([...entries.keys()].some((name) => name.endsWith('/project/project-bundle.json'))).toBe(true);
  expect([...entries.keys()].some((name) => name.endsWith('/samples/expert-gold.jsonl'))).toBe(true);

  await page.getByRole('tab', { name: /Settings/i }).click();
  await page.getByRole('button', { name: 'Recheck' }).click();
  await expect(page.getByLabel('Operational diagnostics JSON')).not.toContainText(
    'not-run-this-session',
  );
  await expect(page.getByLabel('Operational diagnostics JSON')).toContainText(
    'Write, read-back, and cleanup completed successfully',
  );
  await expect(page.getByLabel('Operational diagnostics JSON')).toContainText(
    'WebCrypto SHA-256 completed a real local digest',
  );

  const emptyProject = structuredClone(importedProject);
  emptyProject.samples = [];
  await importInput.setInputFiles({
    name: 'empty-project.rubric-project.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ project: emptyProject })),
  });
  await page.getByRole('tab', { name: /Preview/i }).click();
  await expect(page.getByText('No samples loaded')).toBeVisible();

  await expect.poll(() => pageErrors).toEqual([]);
  expect(
    consoleErrors.filter(
      (entry) =>
        !entry.includes('Download the React DevTools') &&
        !entry.includes('Simulated browser quota failure'),
    ),
  ).toEqual([]);
  await context.close();
}

function readStoredZipEntries(bytes) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const compression = bytes.readUInt16LE(offset + 8);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    expect(compression).toBe(0);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString('utf8');
    entries.set(name, bytes.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}

async function waitForServer(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (serverStartError) {
      throw new Error(`Failed to start Vite server: ${serverStartError.message}\n${serverOutput}`);
    }
    if (server.exitCode !== null) {
      throw new Error(`Vite server exited early:\n${serverOutput}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Timed out waiting for ${url}\n${serverOutput}`);
}
