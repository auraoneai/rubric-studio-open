import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.RSO_E2E_PORT ?? 5208);
const baseUrl = `http://127.0.0.1:${port}`;
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
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 860 } });
  let directProviderRequests = 0;
  await page.addInitScript(() => {
    window.__rsoE2eFolderFiles = {};
    window.__rsoE2eFolderMode = 'readwrite';

    function folderHandle(prefix = '') {
      return {
        async getDirectoryHandle(name) {
          return folderHandle(`${prefix}${name}/`);
        },
        async getFileHandle(name) {
          const path = `${prefix}${name}`;
          return {
            async createWritable() {
              return {
                async write(content) {
                  window.__rsoE2eFolderFiles[path] = String(content);
                },
                async close() {},
              };
            },
            async getFile() {
              const content = window.__rsoE2eFolderFiles[path];
              if (content === undefined) {
                throw new DOMException(`Missing ${path}`, 'NotFoundError');
              }
              return new File([content], name, { type: 'application/json' });
            },
          };
        },
      };
    }

    window.showDirectoryPicker = async (options) => {
      window.__rsoE2eFolderMode = options?.mode ?? 'read';
      return folderHandle();
    };
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
    expect(body.model).toBe('gpt-5-mini');
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

  const startTour = page.getByRole('button', { name: 'Start tour' });
  if (await startTour.isVisible().catch(() => false)) {
    const wizard = page.getByRole('dialog', { name: 'First-run wizard' });
    await expect(wizard.getByLabel('Telemetry')).not.toBeChecked();
    await expect(wizard.getByLabel('Crash reports')).not.toBeChecked();
    await wizard.locator('.setting-row', { hasText: 'Ollama local' }).getByRole('button', { name: 'Detect local judge' }).click();
    await expect(wizard.locator('.setting-row', { hasText: 'Ollama local' })).toContainText('Browser edition cannot detect local Ollama. Open the desktop app for local model judges.');
    await wizard.getByLabel('GPT-5 mini first-run API key').fill('short');
    await wizard.locator('.setting-row', { hasText: 'GPT-5 mini' }).getByRole('button', { name: 'Configure key' }).click();
    await expect(wizard.locator('.setting-row', { hasText: 'GPT-5 mini' })).toContainText('Paste a provider key before configuring this judge.');
    await startTour.click();
    await expect(page.getByRole('dialog', { name: 'Author criteria like code' })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();
    await page.getByRole('button', { name: 'Skip tour' }).click();
  }

  await expect(page.getByRole('button', { name: 'Export folder' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import folder' })).toBeVisible();
  await page.evaluate(() => {
    window.__rsoE2eDirectoryPicker = window.showDirectoryPicker;
    window.showDirectoryPicker = undefined;
  });
  await page.getByRole('button', { name: 'Export folder' }).click();
  await expect(page.getByRole('alert')).toContainText('Browser folder export requires a File System Access capable browser. Use Export bundle as a fallback.');
  await page.getByRole('button', { name: 'Import folder' }).click();
  await expect(page.getByRole('alert')).toContainText('Browser folder import requires a File System Access capable browser. Use Import bundle as a fallback.');
  await page.evaluate(() => {
    window.showDirectoryPicker = window.__rsoE2eDirectoryPicker;
  });
  await page.getByLabel('Import bundle').setInputFiles({
    name: 'not-json.rubric-project.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{'),
  });
  await expect(page.getByRole('alert')).toContainText('Project import failed. Check that the file is valid JSON and try again.');
  await page.getByLabel('Import bundle').setInputFiles({
    name: 'wrong-shape.rubric-project.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schema: 'https://spec.auraone.ai/rubric-studio-open/project-bundle/v1' })),
  });
  await expect(page.getByRole('alert')).toContainText('Invalid project bundle. Choose a Rubric Studio Open JSON export with a project and criteria.');
  await page.getByLabel('Import bundle').setInputFiles({
    name: 'schema-errors.rubric-project.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      schema: 'https://spec.auraone.ai/rubric-studio-open/project-bundle/v1',
      project: {
        id: 'schema-errors',
        name: 'Schema Errors',
        version: '0.1.0',
        branch: 'main',
        themes: [{ id: 'safety', label: 'Safety', description: 'Safety theme.', collapsed: false }],
        criteria: [{
          id: '',
          label: '',
          themeId: 'safety',
          description: '',
          weight: 2,
          scale: 'binary',
          positiveExamples: [],
          negativeExamples: [],
          antiPatterns: [],
          boundaries: '',
          edgeCases: [],
          evidenceRequirement: 'none',
          tags: [],
          references: [],
          siblingLinks: [],
          status: 'Draft',
          comments: [],
        }],
        samples: [],
        judges: [],
        commentsVisible: true,
      },
    })),
  });
  await expect(page.getByRole('alert')).toContainText('Project bundle has 4 schema errors. Fix the bundle and import again.');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'File menu' })).toBeVisible();
  await page.getByRole('menuitem', { name: /New project from template/ }).click();
  await expect(page.getByRole('dialog', { name: 'Create from template' })).toBeVisible();
  await page.getByLabel('Project name').fill('Browser Starter Rubric');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('Browser Starter Rubric')).toBeVisible();
  await expect(page.locator('body')).toContainText('Created browser starter project in local storage');
  await page.getByRole('button', { name: 'Export folder' }).click();
  await expect(page.getByText(/Exported \d+ files to the selected browser folder/)).toBeVisible();
  const exportedFolder = await page.evaluate(() => ({
    mode: window.__rsoE2eFolderMode,
    paths: Object.keys(window.__rsoE2eFolderFiles).sort(),
    bundle: JSON.parse(window.__rsoE2eFolderFiles['project-bundle.json']),
  }));
  expect(exportedFolder.mode).toBe('readwrite');
  expect(exportedFolder.paths).toContain('project-bundle.json');
  expect(exportedFolder.paths).toContain('rubric.json');
  expect(exportedFolder.paths).toContain('samples/samples.json');
  expect(exportedFolder.paths.filter((path) => path.startsWith('criteria/')).length).toBeGreaterThan(0);
  expect(exportedFolder.bundle.project.name).toBe('Browser Starter Rubric');
  await page.evaluate(() => {
    window.__rsoE2eFolderFiles = {};
  });
  await page.getByRole('button', { name: 'Import folder' }).click();
  await expect(page.getByRole('alert')).toContainText('Browser folder is missing project-bundle.json or rubric.json with criteria.');
  await page.evaluate(() => {
    window.__rsoE2eFolderFiles = {
      'project-bundle.json': JSON.stringify({
        schema: 'https://spec.auraone.ai/rubric-studio-open/project-bundle/v1',
        exportedAt: '2026-05-13T00:00:00.000Z',
        project: {
          id: 'folder-schema-errors',
          name: 'Folder Schema Errors',
          version: '0.1.0',
          branch: 'main',
          themes: [{ id: 'safety', label: 'Safety', description: 'Safety theme.', collapsed: false }],
          criteria: [{
            id: '',
            label: '',
            themeId: 'safety',
            description: '',
            weight: 2,
            scale: 'binary',
            positiveExamples: [],
            negativeExamples: [],
            antiPatterns: [],
            boundaries: '',
            edgeCases: [],
            evidenceRequirement: 'none',
            tags: [],
            references: [],
            siblingLinks: [],
            status: 'Draft',
            comments: [],
          }],
          samples: [],
          judges: [],
          commentsVisible: true,
        },
      }),
    };
  });
  await page.getByRole('button', { name: 'Import folder' }).click();
  await expect(page.getByRole('alert')).toContainText('Browser folder has 4 schema errors. Fix the folder and import again.');
  await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('rso:project'));
    window.__rsoE2eFolderFiles = {
      'project-bundle.json': JSON.stringify({
        schema: 'https://spec.auraone.ai/rubric-studio-open/project-bundle/v1',
        exportedAt: '2026-05-13T00:00:00.000Z',
        project: {
          ...current,
          id: 'folder-imported-rubric',
          name: 'Folder Imported Rubric',
        },
      }),
    };
  });
  await page.getByRole('button', { name: 'Import folder' }).click();
  await expect(page.getByText('Folder Imported Rubric', { exact: true })).toBeVisible();
  await expect(page.getByText('Imported Folder Imported Rubric from browser folder.')).toBeVisible();
  const [bundleDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export bundle' }).click(),
  ]);
  expect(bundleDownload.suggestedFilename()).toBe('folder-imported-rubric.rubric-project.json');
  const bundlePath = await bundleDownload.path();
  if (!bundlePath) {
    throw new Error('Expected browser bundle export to produce a local path.');
  }
  const exportedBundle = JSON.parse(await readFile(bundlePath, 'utf8'));
  expect(exportedBundle.schema).toBe('https://spec.auraone.ai/rubric-studio-open/project-bundle/v1');
  expect(exportedBundle.project.id).toBe('folder-imported-rubric');
  expect(exportedBundle.project.criteria.length).toBeGreaterThan(0);

  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.getByLabel('Command search').fill('Open semantic diff');
  await page.getByRole('button', { name: /Open semantic diff/ }).click();
  await expect(page.getByRole('tabpanel', { name: /diff panel/i })).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await expect(page.getByRole('button', { name: /Open semantic diff.*Recent/ })).toBeVisible();
  await page.getByLabel('Command search').fill('Switch to Authoring');
  await page.getByRole('button', { name: /Switch to Authoring/ }).click();
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /Save current project/ }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rso:project')).id)).toBe('folder-imported-rubric');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: /Switch to Preview/ }).click();
  await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitem', { name: /Open keyboard shortcuts/ }).click();
  await expect(page.getByRole('tabpanel', { name: /settings panel/i })).toBeVisible();
  await expect(page.getByText('Remappable controls')).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+1' : 'Control+1');
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  await expect(page.getByRole('textbox', { name: 'In-file find' })).toBeFocused();
  await page.getByRole('textbox', { name: 'In-file find' }).fill('refuses');
  await expect(page.getByText(/match(?:es)? in this criterion/)).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+F' : 'Control+Shift+F');
  await expect(page.getByRole('textbox', { name: 'Across-project search' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Across-project search' }).fill('safety');
  await expect(page.locator('[aria-label="Validation and search"] .search-results').last().getByRole('button', { name: /safe-refusal/ }).first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Criterion comments' })).toBeVisible();
  await page.getByLabel('Add local comment').fill('Confirm the safe-alternative boundary before launch.');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await expect(page.getByText('Confirm the safe-alternative boundary before launch.')).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+/' : 'Control+/');
  await expect(page.getByRole('region', { name: 'Criterion comments' })).toHaveCount(0);
  await page.waitForTimeout(350);
  await page.getByRole('treeitem', { name: /safe-refusal\.toml/ }).click({ button: 'right' });
  await expect(page.getByRole('menu', { name: /Actions for Safe refusal/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Open containing folder' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Reveal in Finder/Explorer' }).click();
  await expect(page.getByRole('contentinfo')).toContainText('Browser edition does not expose system file-manager actions.');
  await page.getByRole('treeitem', { name: /safe-refusal\.toml/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New sibling' }).click();
  await expect(page.getByRole('treeitem', { name: /safe-refusal-copy\.toml/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Safe refusal copy' })).toBeVisible();
  await page.getByRole('treeitem', { name: /safe-refusal-copy\.toml/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete Safe refusal copy?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('treeitem', { name: /safe-refusal-copy\.toml/ })).toBeVisible();
  await page.getByRole('treeitem', { name: /safe-refusal-copy\.toml/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete criterion' }).click();
  await expect(page.getByRole('treeitem', { name: /safe-refusal-copy\.toml/ })).toHaveCount(0);
  await expect(page.getByRole('treeitem', { name: /safe-refusal\.toml/ })).toBeVisible();
  await page.locator('[data-criterion-id="cites-uncertainty"]').dragTo(page.locator('[data-criterion-id="actionable-alternative"]'));
  await expect(page.locator('[data-criterion-id="cites-uncertainty"][data-theme-id="helpfulness"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cites uncertainty' })).toBeVisible();
  const criterionOrder = await page.locator('[aria-label="Criterion tree"] [data-criterion-id]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-criterion-id')),
  );
  expect(criterionOrder.slice(0, 4)).toEqual(['safe-refusal', 'cites-uncertainty', 'actionable-alternative', 'specificity']);
  await page.getByLabel('Select Actionable alternative for bulk operations').check();
  await page.getByLabel('Select Specificity for bulk operations').check();
  await page.getByLabel('Set selected criteria scale').selectOption('continuous');
  await expect(page.locator('[data-criterion-id="actionable-alternative"] small')).toHaveText('continuous');
  await expect(page.locator('[data-criterion-id="specificity"] small')).toHaveText('continuous');
  await page.getByLabel('Select Actionable alternative for bulk operations').check();
  await page.getByLabel('Select Specificity for bulk operations').check();
  await page.getByLabel('Move selected criteria to theme').selectOption('evidence');
  await expect(page.locator('[data-criterion-id="actionable-alternative"][data-theme-id="evidence"]')).toBeVisible();
  await expect(page.locator('[data-criterion-id="specificity"][data-theme-id="evidence"]')).toBeVisible();
  await page.getByLabel('Select Actionable alternative for bulk operations').check();
  await page.getByLabel('Select Specificity for bulk operations').check();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete selected' }).click();
  await expect(page.locator('[data-criterion-id="actionable-alternative"]')).toHaveCount(0);
  await expect(page.locator('[data-criterion-id="specificity"]')).toHaveCount(0);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+2' : 'Control+2');
  await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();
  await expect(page.getByText('Live testing')).toBeVisible();
  const sampleSelect = page.locator('.sample-controls select');
  const initialSampleCount = await sampleSelect.locator('option').count();
  await page.getByRole('button', { name: 'Generate synthetic' }).click();
  await expect(sampleSelect.locator('option')).toHaveCount(initialSampleCount + 1);
  await expect(sampleSelect).toHaveValue(/synthetic-/);
  await expect(page.locator('blockquote')).toContainText('This response includes concrete steps');
  await page.getByLabel('Load JSONL').setInputFiles({
    name: 'bad-browser-e2e-samples.jsonl',
    mimeType: 'application/jsonl',
    buffer: Buffer.from('{"id":"bad-jsonl","prompt":"Missing response"}\nnot-json'),
  });
  await expect(page.getByRole('alert')).toContainText('Sample import failed. Use JSONL rows with id, prompt, and response fields, or paste plain text.');
  await expect(sampleSelect.locator('option')).toHaveCount(initialSampleCount + 1);
  const jsonlSample = [
    {
      id: 'jsonl-e2e-1',
      prompt: 'Check the JSONL file import path.',
      response: 'The first imported JSONL response includes direct evidence.',
      metadata: { source: 'browser-jsonl' },
    },
    {
      id: 'jsonl-e2e-2',
      prompt: 'Check the second JSONL row.',
      response: 'The second imported JSONL response adds another held-out sample.',
      metadata: { source: 'browser-jsonl' },
    },
  ].map((sample) => JSON.stringify(sample)).join('\n');
  await page.getByLabel('Load JSONL').setInputFiles({
    name: 'browser-e2e-samples.jsonl',
    mimeType: 'application/jsonl',
    buffer: Buffer.from(jsonlSample),
  });
  await expect(sampleSelect.locator('option')).toHaveCount(initialSampleCount + 3);
  await expect(sampleSelect).toHaveValue('jsonl-e2e-2');
  await expect(page.locator('blockquote')).toContainText('The second imported JSONL response');
  await page.getByLabel('Paste sample').fill(JSON.stringify({
    id: 'scratch-e2e',
    prompt: 'Check the scratch sample path.',
    response: 'A scratch response with clear evidence and a safe alternative.',
    metadata: { source: 'browser-e2e' },
  }));
  await page.getByRole('button', { name: 'Add scratch' }).click();
  await expect(sampleSelect).toHaveValue('scratch-e2e');
  await expect(page.locator('blockquote')).toContainText('A scratch response with clear evidence');
  await page.getByRole('button', { name: 'Score all' }).click();
  await expect(page.getByText('Scoring all criteria with cancellable progress')).toBeVisible();
  const cancelScoreRun = page.getByRole('button', { name: 'Cancel score run' });
  if (await cancelScoreRun.isVisible().catch(() => false)) {
    await cancelScoreRun.click();
    await expect(page.locator('body')).toContainText(/Score run (canceled|completed)/);
  } else {
    await expect(page.locator('body')).toContainText('Score run completed');
  }
  await page.getByRole('button', { name: 'Score all' }).click();
  await expect(page.locator('body')).toContainText('Score run completed', { timeout: 5_000 });
  await page.getByRole('button', { name: /Safe refusal fail samples/i }).click();
  await expect(page.locator('.catch-controls select').nth(2)).toHaveValue('fail');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+3' : 'Control+3');
  await expect(page.getByRole('tabpanel', { name: /calibration panel/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Calibration requires desktop' })).toBeVisible();
  await expect(page.getByText('iaa-kit, judge-bench, and contamination-audit run as local Python sidecars')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open desktop app' })).toHaveAttribute('href', 'auraone://rubric-studio/open');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+4' : 'Control+4');
  await expect(page.getByRole('tabpanel', { name: /diff panel/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Init' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Fetch' })).toBeDisabled();
  await page.getByRole('button', { name: 'Try variant branch' }).click();
  await expect(page.getByText(/try\//)).toBeVisible();
  await page.getByRole('button', { name: 'Merge back' }).click();

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+5' : 'Control+5');
  await expect(page.getByRole('tabpanel', { name: /export panel/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download AuraOne intake package' })).toBeVisible();
  await expect(page.getByText('Browser edition is local download only')).toBeVisible();
  await expect(page.locator('.intake-flow select').nth(1)).toBeDisabled();
  const [intakeDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download AuraOne intake package' }).click(),
  ]);
  expect(intakeDownload.suggestedFilename()).toBe('folder-imported-rubric.auraonepkg.manifest.json');
  const intakePath = await intakeDownload.path();
  if (!intakePath) {
    throw new Error('Expected browser intake manifest download to produce a local path.');
  }
  const intakeManifest = JSON.parse(await readFile(intakePath, 'utf8'));
  expect(intakeManifest.product).toBe('rubric-studio-open');
  expect(intakeManifest.explicit_user_action_required).toBe(true);
  expect(intakeManifest.intake_scope.destination).toBe('local-download');
  expect(intakeManifest.intake_scope.sample_count).toBeGreaterThan(0);
  expect(intakeManifest.intake_scope.criterion_count).toBeGreaterThan(0);
  await expect(page.getByText('CLI parity')).toBeVisible();
  const scaleTaskExport = page.locator('details.export-item', { hasText: 'scale-task-spec.json' });
  await scaleTaskExport.getByText('scale-task-spec.json').click();
  await scaleTaskExport.getByRole('button', { name: 'Download' }).click();
  await expect(page.getByRole('dialog', { name: 'Sending this to a vendor?' })).toBeVisible();
  await expect(page.getByText('AuraOne Rubric Programs gives you managed expert reviewers')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await scaleTaskExport.getByRole('button', { name: 'Download' }).click();
  await expect(page.getByRole('dialog', { name: 'Sending this to a vendor?' })).toBeVisible();
  const [scaleTaskDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download scale-task-spec.json' }).click(),
  ]);
  expect(scaleTaskDownload.suggestedFilename()).toBe('scale-task-spec.json');
  const scaleTaskPath = await scaleTaskDownload.path();
  if (!scaleTaskPath) {
    throw new Error('Expected vendor task-spec download to produce a local path.');
  }
  const scaleTaskSpec = JSON.parse(await readFile(scaleTaskPath, 'utf8'));
  expect(scaleTaskSpec.task_type).toBe('criterion_review');
  expect(scaleTaskSpec.rubric_id).toBe('folder-imported-rubric');
  expect(scaleTaskSpec.criteria).toContain('safe-refusal');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+6' : 'Control+6');
  await expect(page.getByRole('tabpanel', { name: /settings panel/i })).toBeVisible();
  await expect(page.getByText('BYO provider settings')).toBeVisible();
  await expect(page.getByText('Crash reports and updates')).toBeVisible();
  const telemetryPanel = page.locator('.glass-panel', { hasText: 'Transparent event log' });
  const telemetryLog = telemetryPanel.getByLabel('Transparent telemetry event log JSON');
  await expect(telemetryLog).toHaveText('[]');
  await telemetryPanel.getByLabel('Opt in').check();
  await expect(telemetryLog).toContainText('telemetry.opted_in');
  await page.getByRole('tab', { name: /Authoring/ }).click();
  await page.getByRole('tab', { name: /Settings/ }).click();
  await expect(telemetryLog).toContainText('tab.opened');
  await telemetryPanel.getByLabel('Opt in').uncheck();
  await expect(telemetryLog).toContainText('telemetry.opted_out');
  const telemetryAfterOptOut = JSON.parse(await telemetryLog.textContent());
  await page.getByRole('tab', { name: /Authoring/ }).click();
  await page.getByRole('tab', { name: /Settings/ }).click();
  expect(JSON.parse(await telemetryLog.textContent()).length).toBe(telemetryAfterOptOut.length);
  await telemetryPanel.getByLabel('Opt in').check();
  await expect(telemetryLog).toContainText('telemetry.opted_in');
  await page.getByRole('radio', { name: 'high-contrast' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'high-contrast');
  const reliabilityPanel = page.locator('.glass-panel', { hasText: 'Crash reports and updates' });
  const reliabilityLog = reliabilityPanel.getByLabel('Reliability status JSON');
  await expect(reliabilityLog).toContainText('"crash_reporting_enabled": false');
  await expect(reliabilityLog).toContainText('"crash_default_off": true');
  await expect(reliabilityLog).toContainText('"sends_user_authored_content": false');
  await reliabilityPanel.getByLabel('Crash reports').check();
  await expect(reliabilityLog).toContainText('"crash_reporting_enabled": true');
  await reliabilityPanel.getByLabel('Update channel').selectOption('beta');
  await expect(reliabilityLog).toContainText('"update_channel": "beta"');
  await page.reload({ waitUntil: 'networkidle' });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+6' : 'Control+6');
  await expect(page.getByRole('tabpanel', { name: /settings panel/i })).toBeVisible();
  const reloadedTelemetryPanel = page.locator('.glass-panel', { hasText: 'Transparent event log' });
  const reloadedReliabilityPanel = page.locator('.glass-panel', { hasText: 'Crash reports and updates' });
  const reloadedReliabilityLog = reloadedReliabilityPanel.getByLabel('Reliability status JSON');
  await expect(reloadedTelemetryPanel.getByLabel('Opt in')).toBeChecked();
  await expect(reloadedReliabilityPanel.getByLabel('Crash reports')).toBeChecked();
  await expect(reloadedReliabilityPanel.getByLabel('Update channel')).toHaveValue('beta');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'high-contrast');
  await expect(reloadedReliabilityLog).toContainText('"crash_reporting_enabled": true');
  await expect(reloadedReliabilityLog).toContainText('"update_channel": "beta"');
  await expect(page.getByRole('checkbox', { name: 'Browser constraints' })).toBeDisabled();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Command search').fill('Toggle browser constraints');
  await page.getByRole('button', { name: /Toggle browser constraints/ }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-surface', 'browser');
  await expect(page.getByRole('contentinfo')).toContainText('Browser edition keeps desktop-only features disabled.');
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await expect(page.locator('.success-chip', { hasText: 'unavailable' })).toBeVisible();
  await expect(page.getByText('Remappable controls')).toBeVisible();
  await page.getByLabel('New criterion shortcut').fill('Cmd/Ctrl-K');
  await expect(page.locator('.shortcut-conflict')).toContainText('Cmd/Ctrl-K: Command palette, New criterion');
  await page.getByLabel('New criterion shortcut').fill('Cmd/Ctrl-Alt-9');
  await expect(page.locator('.shortcut-conflict')).toHaveCount(0);
  await page.getByLabel('GPT-5 mini API key').fill('short');
  await page.locator('.setting-row', { hasText: 'GPT-5 mini' }).getByRole('button', { name: 'Configure key' }).click();
  await expect(page.locator('.setting-row', { hasText: 'GPT-5 mini' })).toContainText('Paste a provider key before configuring this judge.');
  await page.getByLabel('GPT-5 mini API key').fill('sk-e2e-browser-provider');
  await page.locator('.setting-row', { hasText: 'GPT-5 mini' }).getByRole('button', { name: 'Configure key' }).click();
  await expect(page.getByLabel('GPT-5 mini API key')).toHaveAttribute('placeholder', 'Configured in session');
  await page.locator('.setting-row', { hasText: 'Ollama local' }).getByRole('button', { name: 'Detect Ollama' }).click();
  await expect(page.locator('.setting-row', { hasText: 'Ollama local' })).toContainText('Browser edition cannot detect local Ollama. Open the desktop app for local model judges.');
  await page.locator('.setting-row', { hasText: 'Ollama local' }).getByLabel('Enabled').check();

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+2' : 'Control+2');
  await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();
  const ollamaColumn = page.locator('.judge-column', { hasText: 'Ollama local' });
  await expect(ollamaColumn.getByText('Desktop only')).toBeVisible();
  await expect(ollamaColumn.getByText('Browser edition cannot reach local model judges. Open the desktop app for Ollama streaming.')).toBeVisible();
  await ollamaColumn.locator('details.score-card').first().locator('summary').click();
  await expect(ollamaColumn.getByRole('button', { name: 'Stream Ollama trace' }).first()).toBeDisabled();
  const gptColumn = page.locator('.judge-column', { hasText: 'GPT-5 mini' });
  await expect(gptColumn.getByText('Direct BYO scoring')).toBeVisible();
  await gptColumn.locator('details.score-card').first().locator('summary').click();
  await gptColumn.getByRole('button', { name: 'Run direct provider score' }).first().click();
  await expect(gptColumn.getByText('OpenAI rejected this BYO key (401). Rotate the key in Settings and retry direct provider scoring.')).toBeVisible();
  await gptColumn.getByRole('button', { name: 'Run direct provider score' }).first().click();
  await expect(gptColumn.getByText('OpenAI rate limited this browser request (429). Wait for the provider limit to reset, then retry.')).toBeVisible();
  await gptColumn.getByRole('button', { name: 'Run direct provider score' }).first().click();
  await expect(gptColumn.getByText('Provider e2e pass from direct browser scoring.')).toBeVisible();
  expect(directProviderRequests).toBe(3);

  await browser.close();
  console.log('Rubric Studio Open browser e2e smoke passed.');
} finally {
  server.kill('SIGTERM');
}

async function verifyNoNetworkBrowserMode(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const blockedExternalRequests = [];
  await page.addInitScript(() => {
    localStorage.setItem('rso:onboarded', 'yes');
  });
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
  await expect(page.getByRole('heading', { name: 'Rubric Studio Open' })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  await page.getByLabel('Label').fill('No-network safe refusal');
  await expect(page.getByRole('heading', { name: 'No-network safe refusal' })).toBeVisible();
  await page.waitForTimeout(350);
  const savedLabel = await page.evaluate(() => JSON.parse(localStorage.getItem('rso:project')).criteria[0].label);
  expect(savedLabel).toBe('No-network safe refusal');
  expect(blockedExternalRequests).toEqual([]);
  await context.close();
}

async function verifyFirstRunSkipPersists(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/?surface=browser`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('dialog', { name: 'First-run wizard' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('dialog', { name: 'First-run wizard' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('rso:onboarded'))).toBe('yes');
  await page.reload({ waitUntil: 'networkidle' });
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
