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
const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  env: { ...process.env, CI: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

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
  await verifyNoNetworkBrowserMode(browser);
  await verifyFirstRunSkipPersists(browser);
  await verifyLaunchWorkflow(browser);
  await browser.close();
  console.log('Rubric Studio Open browser e2e smoke passed.');
} finally {
  server.kill('SIGTERM');
}

async function verifyLaunchWorkflow(browser) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 920 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  let directProviderRequests = 0;

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.route('https://api.openai.com/v1/responses', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, content-type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        },
      });
      return;
    }

    directProviderRequests += 1;
    expect(request.headers().authorization).toBe('Bearer sk-e2e-browser-provider');
    const body = request.postDataJSON();
    expect(body.model).toBe('gpt-5.5');
    expect(body.input).toContain('Return only JSON');
    expect(body.input).toContain('Criterion:');

    if (directProviderRequests === 1) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: { message: 'Expired key' } }),
      });
      return;
    }

    if (directProviderRequests === 2) {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: { message: 'Rate limit exceeded' } }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        output_text: '{"verdict":"pass","confidence":0.94,"reasoning":"Provider e2e pass from direct browser scoring."}',
      }),
    });
  });

  await page.goto(`${baseUrl}/?surface=browser`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('dialog', { name: 'First-run wizard' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Cites uncertainty|Helpful Response Evaluation/ })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  await expect(page.locator('.brand h1')).toContainText('AuraOne · Rubric Studio');
  await expect(page.getByRole('button', { name: 'New from Template' })).toBeVisible();
  await expect(page.locator('.rso-browser-controls')).toBeHidden();

  const scrollResult = await page.evaluate(() => {
    const beforeTop = document.querySelector('.brand')?.getBoundingClientRect().top ?? null;
    window.scrollTo(0, 1200);
    document.querySelector('.main-panel')?.scrollTo(0, 1200);
    const afterTop = document.querySelector('.brand')?.getBoundingClientRect().top ?? null;
    return {
      bodyScrollY: window.scrollY,
      beforeTop,
      afterTop,
      bodyOverflow: getComputedStyle(document.body).overflow,
      shellOverflow: getComputedStyle(document.querySelector('.app-shell')).overflow,
      mainOverflowY: getComputedStyle(document.querySelector('.main-panel')).overflowY,
    };
  });
  expect(scrollResult.bodyScrollY).toBe(0);
  expect(scrollResult.beforeTop).toBe(scrollResult.afterTop);
  expect(scrollResult.bodyOverflow).toBe('hidden');
  expect(scrollResult.shellOverflow).toBe('hidden');
  expect(scrollResult.mainOverflowY).toBe('auto');

  await runCommand(page, 'Start guided tour');
  const wizard = page.getByRole('dialog', { name: 'First-run wizard' });
  await expect(wizard).toBeVisible();
  await expect(wizard.getByLabel('Telemetry')).not.toBeChecked();
  await expect(wizard.getByLabel('Crash reports')).not.toBeChecked();
  await wizard.getByRole('button', { name: 'Start tour' }).click();
  await expect(page.getByRole('dialog', { name: 'Author criteria like code' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();

  await page.getByRole('button', { name: 'New from Template' }).click();
  await expect(page.getByRole('dialog', { name: 'Create from template' })).toBeVisible();
  await page.getByLabel('Project name').fill('Browser Starter Rubric');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByLabel('Current project')).toContainText('Browser Starter Rubric');
  await expect(page.getByRole('contentinfo')).toContainText('Created browser starter project in local storage');

  await page.keyboard.press(`${modifier}+F`);
  await expect(page.getByRole('textbox', { name: 'In-file find' })).toBeFocused();
  await page.getByRole('textbox', { name: 'In-file find' }).fill('uncertainty');
  await expect(page.getByText(/match(?:es)? in this criterion/)).toBeVisible();
  await page.keyboard.press(`${modifier}+Shift+F`);
  await expect(page.getByRole('textbox', { name: 'Across-project search' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Across-project search' }).fill('safety');
  await expect(page.locator('[aria-label="Validation and search"] .search-results').getByRole('button').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Criterion comments' })).toBeVisible();
  await page.getByLabel('Add local comment').fill('Confirm the launch boundary before release.');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await expect(page.getByText('Confirm the launch boundary before release.')).toBeVisible();
  await page.keyboard.press(`${modifier}+/`);
  await expect(page.getByRole('region', { name: 'Criterion comments' })).toHaveCount(0);

  await page.getByRole('treeitem', { name: /safe-refusal\.toml/ }).click({ button: 'right' });
  await expect(page.getByRole('menu', { name: /Actions for Safe refusal/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Open containing folder' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Reveal in Finder/Explorer' }).click();
  await expect(page.getByRole('contentinfo')).toContainText('Browser edition does not expose system file-manager actions.');

  await page.keyboard.press(`${modifier}+2`);
  await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();
  await expect(page.getByText('Live testing')).toBeVisible();
  const sampleCards = page.locator('.rs-sample-deck button');
  const initialSampleCount = await sampleCards.count();
  await page.getByRole('button', { name: 'Generate synthetic' }).click();
  await expect(sampleCards).toHaveCount(initialSampleCount + 1);
  await expect(page.getByText('This response gives concrete steps')).toBeVisible();
  await page.getByLabel('Load sample JSONL').setInputFiles({
    name: 'bad-browser-e2e-samples.jsonl',
    mimeType: 'application/jsonl',
    buffer: Buffer.from('{"id":"bad-jsonl","prompt":"Missing response"}\nnot-json'),
  });
  await expect(page.getByRole('status')).toContainText('Sample import failed. Use JSONL rows with id, prompt, and response fields.');
  const jsonlSample = [
    {
      id: 'jsonl-e2e-1',
      prompt: 'Check the JSONL file import path.',
      response: 'The first imported JSONL response includes direct evidence.',
      metadata: { source: 'browser-jsonl', previewScore: 88 },
    },
    {
      id: 'jsonl-e2e-2',
      prompt: 'Check the second JSONL row.',
      response: 'The second imported JSONL response adds another held-out sample.',
      metadata: { source: 'browser-jsonl', previewScore: 91 },
    },
  ].map((sample) => JSON.stringify(sample)).join('\n');
  await page.getByLabel('Load sample JSONL').setInputFiles({
    name: 'browser-e2e-samples.jsonl',
    mimeType: 'application/jsonl',
    buffer: Buffer.from(jsonlSample),
  });
  await expect(page.getByRole('status')).toContainText('Loaded 2 samples from browser-e2e-samples.jsonl.');
  await expect(sampleCards).toHaveCount(initialSampleCount + 3);
  await expect(page.getByText('The second imported JSONL response adds another held-out sample.')).toBeVisible();
  await page.getByRole('button', { name: /Score all/ }).click();
  await expect(page.locator('body')).toContainText('Score run completed', { timeout: 5_000 });
  await page.getByRole('button', { name: /Safe refusal fail samples/i }).click();
  await expect(page.locator('.rs-analysis-rail')).toContainText('What did this catch?');

  await page.keyboard.press(`${modifier}+6`);
  await expect(page.getByRole('tabpanel', { name: /settings panel/i })).toBeVisible();
  await expect(page.getByText('BYO provider keys')).toBeVisible();
  await expect(page.getByText('Crash reports and updates')).toBeVisible();
  const openAiRow = page.locator('.rs-provider-row', { hasText: 'OpenAI GPT-5.5' });
  await openAiRow.locator('input[aria-label="OpenAI GPT-5.5 API key"]').fill('short');
  await openAiRow.getByRole('button', { name: 'Configure key' }).click();
  await expect(openAiRow).toContainText('Paste a provider key before configuring this judge.');
  await openAiRow.locator('input[aria-label="OpenAI GPT-5.5 API key"]').fill('sk-e2e-browser-provider');
  await openAiRow.getByRole('button', { name: 'Configure key' }).click();
  await expect(openAiRow.locator('input[aria-label="OpenAI GPT-5.5 API key"]')).toHaveAttribute('placeholder', 'Configured in session');
  const networkPanel = page.locator('.glass-panel', { hasText: 'No-network mode' });
  await networkPanel.getByLabel('Block outbound calls').check();
  await expect(networkPanel.getByLabel('No-network status JSON')).toContainText('"enabled": true');

  await page.keyboard.press(`${modifier}+2`);
  await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();
  const openAiPanel = page.locator('.rs-judge-panel', { hasText: 'OpenAI GPT-5.5' });
  await expect(openAiPanel.getByRole('button', { name: 'Run' }).first()).toBeDisabled();
  await page.keyboard.press(`${modifier}+6`);
  await networkPanel.getByLabel('Block outbound calls').uncheck();
  await page.keyboard.press(`${modifier}+2`);
  await openAiPanel.getByRole('button', { name: 'Run' }).first().click();
  await expect(openAiPanel).toContainText('OpenAI rejected this BYO key (401). Rotate the key in Settings and retry direct provider scoring.');
  await openAiPanel.getByRole('button', { name: 'Run' }).first().click();
  await expect(openAiPanel).toContainText('OpenAI rate limited this browser request (429). Wait for the provider limit to reset, then retry.');
  await openAiPanel.getByRole('button', { name: 'Run' }).first().click();
  await expect(openAiPanel).toContainText('pass');
  expect(directProviderRequests).toBe(3);

  await page.keyboard.press(`${modifier}+3`);
  await expect(page.getByRole('tabpanel', { name: /calibration panel/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Calibration requires desktop' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open desktop app' })).toHaveAttribute('href', 'auraone://rubric-studio/open');

  await page.keyboard.press(`${modifier}+4`);
  await expect(page.getByRole('tabpanel', { name: /diff panel/i })).toBeVisible();
  await page.getByRole('button', { name: 'Fetch' }).click();
  await expect(page.getByRole('status')).toContainText('Browser edition previews fetch; open desktop to fetch from a configured git remote.');
  await page.getByRole('button', { name: /Commit/ }).click();
  await expect(page.getByRole('status')).toContainText('Browser preview only - open desktop to commit.');
  await page.getByRole('button', { name: 'Try variant branch' }).click();
  await expect(page.getByText(/try\//)).toBeVisible();
  await page.getByRole('button', { name: 'Merge back' }).click();
  await expect(page.getByRole('status')).toContainText(/Merged try\//);

  await page.keyboard.press(`${modifier}+5`);
  await expect(page.getByRole('tabpanel', { name: /export panel/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download AuraOne intake package' })).toBeVisible();
  await expect(page.getByText('Browser export uses local download only')).toBeVisible();
  const [intakeDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download AuraOne intake package' }).click(),
  ]);
  expect(intakeDownload.suggestedFilename()).toBe('browser-starter-rubric.auraonepkg.manifest.json');
  const intakePath = await intakeDownload.path();
  if (!intakePath) throw new Error('Expected browser intake manifest download to produce a local path.');
  const intakeManifest = JSON.parse(await readFile(intakePath, 'utf8'));
  expect(intakeManifest.product).toBe('rubric-studio-open');
  expect(intakeManifest.explicit_user_action_required).toBe(true);
  expect(intakeManifest.intake_scope.destination).toBe('local-download');
  expect(intakeManifest.intake_scope.sample_count).toBeGreaterThan(0);
  expect(intakeManifest.intake_scope.criterion_count).toBeGreaterThan(0);

  await runCommand(page, 'Export: lm-eval-harness');
  await expect(page.getByRole('tabpanel', { name: /export panel/i })).toBeVisible();
  await expect(page.locator('.rs-artifact-group button.active-export', { hasText: 'lm-eval-harness.yaml' })).toBeVisible();
  const scaleTaskExport = page.locator('.rs-artifact-group button', { hasText: 'scale-task-spec.json' });
  await scaleTaskExport.click();
  await expect(page.getByRole('dialog', { name: 'Sending this to a vendor?' })).toBeVisible();
  await expect(page.getByText('AuraOne Rubric Programs gives you managed expert reviewers')).toBeVisible();
  const [scaleTaskDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download scale-task-spec.json' }).click(),
  ]);
  expect(scaleTaskDownload.suggestedFilename()).toBe('scale-task-spec.json');
  const scaleTaskPath = await scaleTaskDownload.path();
  if (!scaleTaskPath) throw new Error('Expected vendor task-spec download to produce a local path.');
  const scaleTaskSpec = JSON.parse(await readFile(scaleTaskPath, 'utf8'));
  expect(scaleTaskSpec.task_type).toBe('criterion_review');
  expect(scaleTaskSpec.rubric_id).toBe('browser-starter-rubric');
  expect(scaleTaskSpec.criteria).toContain('safe-refusal');

  await page.keyboard.press(`${modifier}+6`);
  await expect(page.getByRole('tabpanel', { name: /settings panel/i })).toBeVisible();
  const telemetryPanel = page.locator('.glass-panel', { hasText: 'Transparent event log' });
  await expect(telemetryPanel.getByLabel('Transparent telemetry event log JSON')).toHaveText('[]');
  await telemetryPanel.getByLabel('Opt in').check();
  await expect(telemetryPanel.getByLabel('Transparent telemetry event log JSON')).toContainText('telemetry.opted_in');
  await page.getByRole('radio', { name: 'High contrast' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'high-contrast');
  const reliabilityPanel = page.locator('.glass-panel', { hasText: 'Crash reports and updates' });
  await reliabilityPanel.getByLabel('Crash reports').check();
  await reliabilityPanel.getByLabel('Update channel').selectOption('beta');
  await expect(reliabilityPanel.getByLabel('Reliability status JSON')).toContainText('"update_channel": "beta"');
  await page.getByLabel('New criterion shortcut').fill('Cmd/Ctrl-K');
  await expect(page.locator('.shortcut-conflict')).toContainText('Cmd/Ctrl-K: Command palette, New criterion');
  await page.getByLabel('New criterion shortcut').fill('Cmd/Ctrl-Alt-9');
  await expect(page.locator('.shortcut-conflict')).toHaveCount(0);

  await page.goto(`${baseUrl}/?surface=browser`, { waitUntil: 'networkidle' });
  await page.keyboard.press(`${modifier}+6`);
  await expect(page.getByRole('tabpanel', { name: /settings panel/i })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'high-contrast');
  await expect(page.locator('.glass-panel', { hasText: 'Transparent event log' }).getByLabel('Opt in')).toBeChecked();
  await expect(page.locator('.glass-panel', { hasText: 'Crash reports and updates' }).getByLabel('Crash reports')).toBeChecked();
  await expect(page.locator('.glass-panel', { hasText: 'Crash reports and updates' }).getByLabel('Update channel')).toHaveValue('beta');
  expect(await page.locator('.top-actions .switch input[type="checkbox"]').evaluate((input) => input.disabled)).toBe(true);

  await expect.poll(() => pageErrors).toEqual([]);
  expect(consoleErrors.filter((entry) =>
    !entry.includes('Download the React DevTools') &&
    !entry.includes('401 (Unauthorized)') &&
    !entry.includes('429 (Too Many Requests)'),
  )).toEqual([]);
  await context.close();
}

async function runCommand(page, command) {
  await page.keyboard.press(`${modifier}+K`);
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.getByLabel('Command search').fill(command);
  await page.getByRole('button', { name: new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
}

async function verifyNoNetworkBrowserMode(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const blockedExternalRequests = [];
  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === baseUrl || requestUrl.protocol === 'data:' || requestUrl.protocol === 'blob:') {
      await route.continue();
      return;
    }
    blockedExternalRequests.push(route.request().url());
    await route.abort('blockedbyclient');
  });
  await page.goto(`${baseUrl}/?surface=browser`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: /Cites uncertainty|Helpful Response Evaluation/ })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  await page.getByLabel('Label').fill('No-network safe refusal');
  await expect(page.getByRole('heading', { name: 'No-network safe refusal' })).toBeVisible();
  await page.waitForTimeout(350);
  const savedLabel = await page.evaluate(() => {
    const project = JSON.parse(localStorage.getItem('rso:project'));
    return project.criteria.find((criterion) => criterion.id === 'no-network-safe-refusal')?.label
      ?? project.criteria.find((criterion) => criterion.label === 'No-network safe refusal')?.label;
  });
  expect(savedLabel).toBe('No-network safe refusal');
  expect(blockedExternalRequests).toEqual([]);
  await context.close();
}

async function verifyFirstRunSkipPersists(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/?surface=browser`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('dialog', { name: 'First-run wizard' })).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();

  await page.goto(`${baseUrl}/?surface=browser&onboarding=1`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('dialog', { name: 'First-run wizard' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('dialog', { name: 'First-run wizard' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('rso:onboarded'))).toBe('yes');
  await page.goto(`${baseUrl}/?surface=browser`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('dialog', { name: 'First-run wizard' })).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  await context.close();
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
      if (response.ok) {
        return;
      }
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Timed out waiting for ${url}\n${serverOutput}`);
}
