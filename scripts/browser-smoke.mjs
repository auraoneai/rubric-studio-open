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
  await verifyFirstRunScoreSample(browser);
  await verifyDesktopGitOperations(browser);
  await verifyUpdateNotificationUx(browser);
  await verifyDesktopCalibrationRewrite(browser);
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
    await expect(wizard).toHaveAttribute('data-focus-trap', 'active');
    await expect.poll(() => wizard.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await expect(wizard).toContainText('12-criterion helpful-response project');
    await expect(wizard).toContainText('Read the diff');
    await expect(wizard.getByLabel('Telemetry')).not.toBeChecked();
    await expect(wizard.getByLabel('Crash reports')).not.toBeChecked();
    await wizard.locator('.setting-row', { hasText: 'Ollama local' }).getByRole('button', { name: 'Detect local judge' }).click();
    await expect(wizard.locator('.setting-row', { hasText: 'Ollama local' })).toContainText('Browser edition cannot detect local Ollama. Open the desktop app for local model judges.');
    await wizard.getByLabel('GPT-5 mini first-run API key').fill('short');
    await wizard.locator('.setting-row', { hasText: 'GPT-5 mini' }).getByRole('button', { name: 'Configure key' }).click();
    await expect(wizard.locator('.setting-row', { hasText: 'GPT-5 mini' })).toContainText('Paste a provider key before configuring this judge.');
    await startTour.click();
    const tourDialog = page.getByRole('dialog', { name: 'Author criteria like code' });
    await expect(tourDialog).toBeVisible();
    await expect(tourDialog).toHaveAttribute('data-focus-trap', 'active');
    await expect.poll(() => tourDialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('dialog', { name: 'Test against samples immediately' })).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('dialog', { name: 'Author criteria like code' })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Test against samples immediately' })).toHaveCount(0);
  }

  await expect(page.getByRole('button', { name: 'Export folder' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import folder' })).toBeVisible();
  await page.getByRole('tab', { name: /Calibration/ }).click();
  await expect(page.getByRole('heading', { name: 'Calibration requires desktop' })).toBeVisible();
  await expect(page.getByText('iaa-kit, judge-bench, and contamination-audit run as local Python sidecars')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load gold JSONL' })).toHaveCount(0);
  await page.getByRole('tab', { name: /Author/ }).click();
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
  await expect(page.getByRole('alert')).toContainText('First error at schema-errors.rubric-project.json: line');
  await expect(page.getByRole('alert')).toContainText('field label on criterion <missing id>');
  const [repairTemplateDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download valid template' }).click(),
  ]);
  expect(repairTemplateDownload.suggestedFilename()).toMatch(/\.repair-template\.rubric-project\.json$/);
  await page.getByRole('button', { name: 'New from Template' }).click();
  await expect(page.getByRole('dialog', { name: 'Create from template' })).toBeVisible();
  await page.getByLabel('Project name').fill('Browser Starter Rubric');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByLabel('Project sidebar').getByText('Browser Starter Rubric')).toBeVisible();
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
  await expect(page.getByRole('alert')).toContainText('First error at project-bundle.json: line');
  await expect(page.getByRole('alert')).toContainText('Quick action: Use draft label.');
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
  await expect(page.getByLabel('Project sidebar').getByText('Folder Imported Rubric', { exact: true })).toBeVisible();
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
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tabpanel', { name: /diff panel/i })).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await expect(page.getByRole('button', { name: /Open semantic diff.*Recent/ })).toBeVisible();
  await page.getByLabel('Command search').fill('Switch to');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Command search').fill('Switch to Authoring');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Command search').fill('Save current project');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rso:project')).id)).toBe('folder-imported-rubric');
  await expect(page.getByRole('contentinfo')).toContainText('Saved current project');
  const fileMenuButton = page.getByRole('button', { name: 'File', exact: true });
  if (await fileMenuButton.isVisible().catch(() => false)) {
    await fileMenuButton.focus();
    await expect(fileMenuButton).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('button', { name: 'View', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    const keyboardViewMenu = page.getByRole('menu', { name: 'View menu' });
    await expect(keyboardViewMenu).toBeVisible();
    await expect(keyboardViewMenu.getByRole('menuitem', { name: /Command palette/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(keyboardViewMenu.getByRole('menuitem', { name: /Switch to Preview/ })).toBeFocused();
    await page.keyboard.press('Enter');
  } else {
    await page.getByRole('tab', { name: /Preview/ }).click();
  }
  await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+1' : 'Control+1');
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  const authoringTab = page.getByRole('tab', { name: /Authoring/ });
  await authoringTab.focus();
  await expect(authoringTab).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Preview/ })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: /Settings/ })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: /settings panel/i })).toBeVisible();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: /Authoring/ })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Command search').fill('Quick open');
  await page.getByRole('dialog', { name: 'Command palette' }).getByRole('button', { name: /Quick open/ }).click();
  await expect(page.getByRole('dialog', { name: 'Quick open' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Command search').fill('Git commit');
  await page.getByRole('button', { name: /Git commit/ }).click();
  await expect(page.getByRole('contentinfo')).toContainText('Browser edition previews git actions; open desktop to commit.');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Command search').fill('Git init');
  await page.getByRole('button', { name: /Git init/ }).click();
  await expect(page.getByRole('contentinfo')).toContainText('Browser edition previews git actions; open desktop to initialize git.');
  await page.getByRole('tab', { name: /Preview/ }).click();
  await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Command search').fill('Open keyboard shortcuts');
  await page.getByRole('button', { name: /Open keyboard shortcuts/ }).click();
  await expect(page.getByRole('tabpanel', { name: /settings panel/i })).toBeVisible();
  await expect(page.getByText('Remappable controls')).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+1' : 'Control+1');
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  const labelInput = page.getByLabel('Label');
  await expect(labelInput).toHaveValue('Safe refusal');
  await labelInput.fill('Undoable safe refusal');
  await expect(page.getByRole('heading', { name: 'Undoable safe refusal' })).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
  await expect(labelInput).toHaveValue('Safe refusal');
  await expect(page.getByRole('contentinfo')).toContainText('Undid last project edit');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Shift+Z');
  await expect(labelInput).toHaveValue('Undoable safe refusal');
  await expect(page.getByRole('contentinfo')).toContainText('Redid last project edit');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Command search').fill('Undo');
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(labelInput).toHaveValue('Safe refusal');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
  const quickOpen = page.getByRole('dialog', { name: 'Quick open' });
  await expect(quickOpen).toBeVisible();
  await quickOpen.getByLabel('Quick open search').fill('safe refusal');
  await quickOpen.locator('button', { hasText: 'criteria/safety/safe-refusal.toml' }).click();
  await expect(page.getByRole('heading', { name: 'Safe refusal' })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('Opened criteria/safety/safe-refusal.toml');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
  await page.getByRole('dialog', { name: 'Quick open' }).getByLabel('Quick open search').fill('sample-002');
  await page.getByRole('dialog', { name: 'Quick open' }).locator('button', { hasText: 'samples/sample-002.jsonl' }).click();
  await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();
  await expect(page.locator('blockquote')).toContainText('I cannot help disable a safety mechanism');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
  await page.getByRole('dialog', { name: 'Quick open' }).getByLabel('Quick open search').fill('lm-eval');
  await page.getByRole('dialog', { name: 'Quick open' }).locator('button', { hasText: 'exports/lm-eval-harness.yaml' }).click();
  await expect(page.getByRole('tabpanel', { name: /export panel/i })).toBeVisible();
  await expect(page.locator('details.export-item.active-export', { hasText: 'lm-eval-harness.yaml' })).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+1' : 'Control+1');
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  const inFileFind = page.locator('input[aria-label="In-file find"], .rs-rail-search input').first();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Command search').fill('Find in current criterion');
  await page.keyboard.press('Enter');
  await expect(inFileFind).toBeFocused();
  await inFileFind.fill('refuses');
  await expect(page.getByText(/match(?:es)? in this criterion/)).toBeVisible();
  const projectSearch = page.locator('input[aria-label="Across-project search"], .rs-rail-search input').last();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Command search').fill('Find across project');
  await page.keyboard.press('Enter');
  await expect(projectSearch).toBeFocused();
  await projectSearch.fill('safety');
  await expect(page.locator('[aria-label="Validation and search"] .search-results').last().getByRole('button', { name: /safe-refusal/ }).first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Criterion comments' })).toBeVisible();
  await page.getByLabel('Add local comment').fill('Confirm the safe-alternative boundary before launch.');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await expect(page.getByText('Confirm the safe-alternative boundary before launch.')).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+/' : 'Control+/');
  await expect(page.getByRole('region', { name: 'Criterion comments' })).toHaveCount(0);
  await page.waitForTimeout(350);
  const safeRefusalTreeItem = page.getByRole('treeitem', { name: /Safe refusal/ });
  await safeRefusalTreeItem.focus();
  await expect(safeRefusalTreeItem).toBeFocused();
  await page.keyboard.press('ContextMenu');
  const keyboardContextMenu = page.getByRole('menu', { name: /Actions for Safe refusal/ });
  await expect(keyboardContextMenu).toBeVisible();
  await expect(keyboardContextMenu.getByRole('menuitem', { name: 'Open', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(keyboardContextMenu.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(keyboardContextMenu).toHaveCount(0);
  await page.getByRole('treeitem', { name: /Safe refusal/ }).click({ button: 'right' });
  await expect(page.getByRole('menu', { name: /Actions for Safe refusal/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Open containing folder' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Reveal in Finder/Explorer' }).click();
  await expect(page.getByRole('contentinfo')).toContainText('Browser edition does not expose system file-manager actions.');
  await page.getByRole('treeitem', { name: /Safe refusal/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New sibling' }).click();
  await expect(page.getByRole('treeitem', { name: /Safe refusal copy/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Safe refusal copy' })).toBeVisible();
  await page.getByRole('treeitem', { name: /Safe refusal copy/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const deleteCriterionDialog = page.getByRole('dialog', { name: 'Delete Safe refusal copy?' });
  await expect(deleteCriterionDialog).toBeVisible();
  await expect(deleteCriterionDialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('treeitem', { name: /Safe refusal copy/ })).toBeVisible();
  await page.getByRole('treeitem', { name: /Safe refusal copy/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete criterion' }).click();
  await expect(page.getByRole('treeitem', { name: /Safe refusal copy/ })).toHaveCount(0);
  await expect(page.getByRole('treeitem', { name: /Safe refusal/ })).toBeVisible();
  await page.locator('.rs-example-card.positive textarea').fill('Only one positive calibration example');
  await expect(page.getByLabel('Validation and search').getByText('Add at least two positive examples for reviewer calibration.')).toBeVisible();
  await expect(page.locator('.issue-list').getByRole('button', { name: /Add positive example/ })).toBeVisible();
  await page.locator('.issue-list').getByRole('button', { name: /Add positive example/ }).click();
  await expect(page.locator('.rs-example-card.positive textarea')).toHaveValue(/Positive calibration example 2/);
  const weightInput = page.getByLabel('Weight');
  await weightInput.fill('2');
  await expect(page.locator('.issue-list').getByRole('button', { name: /Clamp weight/ })).toBeVisible();
  await page.locator('.issue-list').getByRole('button', { name: /Clamp weight/ }).click();
  await expect(weightInput).toHaveValue('1');
  await expect(page.locator('.issue-list').getByRole('button', { name: /Normalize theme weights/ })).toBeVisible();
  await page.locator('.issue-list').getByRole('button', { name: /Normalize theme weights/ }).click();
  await expect(weightInput).toHaveValue('0.33');
  await page.locator('[data-criterion-id="cites-uncertainty"]').dragTo(page.locator('[data-criterion-id="actionable-alternative"]'));
  await expect(page.locator('[data-criterion-id="cites-uncertainty"][data-theme-id="helpfulness"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cites uncertainty' })).toBeVisible();
  const criterionOrder = await page.locator('[aria-label="Rubric criteria files"] [data-criterion-id]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-criterion-id')),
  );
  expect(criterionOrder.length).toBe(12);
  expect(criterionOrder.indexOf('cites-uncertainty')).toBeLessThan(criterionOrder.indexOf('actionable-alternative'));
  expect(criterionOrder).toContain('reproducible-checks');
  await expect(page.locator('[data-criterion-id="actionable-alternative"]')).toBeVisible();
  await expect(page.locator('[data-criterion-id="specificity"]')).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+2' : 'Control+2');
  await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();
  await expect(page.getByText('Live testing')).toBeVisible();
  const sampleSelect = page.locator('.sample-controls select');
  const initialSampleCount = await sampleSelect.locator('option').count();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Command search').fill('Generate test sample');
  await page.getByRole('dialog', { name: 'Command palette' }).getByRole('button', { name: /Generate test sample/ }).click();
  await expect(sampleSelect.locator('option')).toHaveCount(initialSampleCount + 1);
  await expect(sampleSelect).toHaveValue(/synthetic-/);
  await expect(page.locator('.sample-provenance')).toContainText('synthetic-meta-prompt');
  await expect(page.locator('.sample-provenance')).toContainText('Generate a sample response for testing');
  await expect(page.locator('blockquote')).toContainText('This generated test response gives concrete steps');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Command search').fill('Load JSONL samples');
  await page.getByRole('dialog', { name: 'Command palette' }).getByRole('button', { name: /Load JSONL samples/ }).click();
  await expect(page.getByRole('contentinfo')).toContainText('Focused JSONL sample loader');
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
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Command search').fill('Paste scratch sample');
  await page.getByRole('dialog', { name: 'Command palette' }).getByRole('button', { name: /Paste scratch sample/ }).click();
  await expect(page.getByLabel('Paste sample')).toBeFocused();
  await page.getByLabel('Paste sample').fill(JSON.stringify({
    id: 'scratch-e2e',
    prompt: 'Check the scratch sample path.',
    response: 'A scratch response with clear evidence and a safe alternative.',
    metadata: { source: 'browser-e2e' },
  }));
  await page.getByRole('button', { name: 'Add scratch' }).click();
  await expect(sampleSelect).toHaveValue('scratch-e2e');
  await expect(page.locator('blockquote')).toContainText('A scratch response with clear evidence');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Command search').fill('Score current sample');
  await page.getByRole('dialog', { name: 'Command palette' }).getByRole('button', { name: /Score current sample/ }).click();
  await expect(page.getByText('Scoring current sample with cancellable progress')).toBeVisible();
  await expect(page.locator('.loading-state .skeleton-pulse')).toBeVisible();
  const cancelScoreRun = page.getByRole('button', { name: 'Cancel score run' });
  if (await cancelScoreRun.isVisible().catch(() => false)) {
    await cancelScoreRun.click();
    await expect(page.locator('body')).toContainText(/Score run canceled|Current sample score run completed/);
  } else {
    await expect(page.locator('body')).toContainText('Current sample score run completed');
  }
  await page.getByRole('button', { name: 'Score all' }).click();
  await expect(page.getByText('Scoring all samples with cancellable progress')).toBeVisible();
  await expect(page.locator('.loading-state .skeleton-pulse')).toBeVisible();
  await expect(page.locator('body')).toContainText('All samples score run completed', { timeout: 5_000 });
  await page.getByRole('checkbox', { name: 'Disagreements' }).check();
  await page.getByRole('button', { name: 'Compare' }).first().click();
  const comparisonPanel = page.getByLabel('Side-by-side judge comparison');
  await expect(comparisonPanel).toBeVisible();
  await expect(comparisonPanel).toContainText('Local mock judge');
  await expect(comparisonPanel).toContainText('GPT-5 mini');
  await expect(comparisonPanel).toContainText('Confidence');
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
  await expect(page.locator('.text-diff-panel')).toContainText('Standard text diff');
  await expect(page.locator('.text-diff-panel')).toContainText('criteria/safety/safe-refusal.toml');
  const versionCompare = page.getByLabel('Version comparison');
  await expect(versionCompare).toContainText('Re-score held-out overlay');
  await versionCompare.getByLabel('Compare from').fill('main');
  await versionCompare.getByLabel('Compare to').fill('HEAD');
  await versionCompare.getByRole('button', { name: 'Run diff overlay' }).click();
  await expect(page.getByLabel('Diff overlay run progress')).toBeVisible();
  await expect(versionCompare.locator('.skeleton-pulse')).toBeVisible();
  await versionCompare.getByRole('button', { name: 'Cancel diff overlay' }).click();
  await expect(versionCompare).toContainText('Held-out diff overlay canceled');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Command search').fill('Run diff overlay');
  await page.getByRole('dialog', { name: 'Command palette' }).getByRole('button', { name: /Run diff overlay/ }).click();
  await expect(versionCompare).toContainText('Running held-out diff overlay');
  await expect(versionCompare).toContainText('Version overlay main -> HEAD');
  await expect(versionCompare).toContainText('Changed criteria');
  await expect(versionCompare).toContainText('Held-out diff overlay completed');
  await expect(page.getByRole('contentinfo')).toContainText('Ran held-out diff overlay');
  const [diffReportDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download markdown report' }).click(),
  ]);
  expect(diffReportDownload.suggestedFilename()).toBe('folder-imported-rubric-semantic-diff.md');
  const diffReportPath = await diffReportDownload.path();
  if (!diffReportPath) {
    throw new Error('Expected semantic diff report download to produce a local path.');
  }
  const diffReport = await readFile(diffReportPath, 'utf8');
  expect(diffReport).toContain('# Semantic Diff Report: Folder Imported Rubric');
  expect(diffReport).toContain('| Criterion | Severity | Summary | Pass to fail | Fail to pass |');
  await page.getByRole('button', { name: 'Git commit' }).click();
  await expect(page.locator('.success-chip', { hasText: 'Browser preview only - open desktop to commit.' })).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Command search').fill('Try criterion variant');
  await page.getByRole('button', { name: /Try criterion variant/ }).click();
  await expect(page.getByText(/try\//)).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('Started criterion variant branch');
  await page.getByRole('button', { name: 'Merge back' }).click();
  await expect(page.locator('.success-chip', { hasText: /Merged try\// })).toBeVisible();
  const collaborationPanel = page.getByLabel('Read-only CRDT collaboration');
  await expect(collaborationPanel).toBeVisible();
  await expect(collaborationPanel).toContainText('Read-only CRDT snapshot');
  await expect(collaborationPanel).toContainText('Read-only snapshot is current');
  await expect(collaborationPanel).toContainText('Participants local-author');
  const crdtJson = collaborationPanel.getByLabel('Read-only CRDT snapshot JSON');
  await expect(crdtJson).toContainText('"mode": "read-only"');
  await crdtJson.fill('{');
  await expect(collaborationPanel).toContainText('Snapshot is not valid Rubric Studio Open CRDT JSON.');
  await collaborationPanel.getByRole('button', { name: 'Reset local snapshot' }).click();
  await expect(collaborationPanel).toContainText('Read-only snapshot is current');

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
  for (const [command, artifact] of [
    ['Export: Rubric file', 'rubric.json'],
    ['Export: Judge card', 'judge-card.md'],
    ['Export: eval-run-manifest', 'eval-run-manifest.json'],
    ['Export: Conformance badge', 'conformance-badge.svg'],
    ['Export: lm-eval-harness', 'lm-eval-harness.yaml'],
    ['Export: Inspect', 'inspect-task.py'],
    ['Export: OpenAI Evals', 'openai-evals.yaml'],
    ['Export: Promptfoo', 'promptfoo.yaml'],
    ['Export: Hugging Face Hub', 'huggingface-dataset-card.md'],
    ['Export: Surge SOW', 'surge-sow.txt'],
    ['Export: Scale task spec', 'scale-task-spec.json'],
    ['Generate GitHub Actions helper', '.github/workflows/rubric.yml'],
    ['Generate GitLab CI helper', '.gitlab-ci.yml'],
    ['Generate CircleCI helper', '.circleci/config.yml'],
    ['Generate Make helper', 'Makefile'],
  ]) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    await page.getByLabel('Command search').fill(command);
    await page.getByRole('button', { name: new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
    const artifactExport = page.locator('details.export-item.active-export', { hasText: artifact });
    await expect(artifactExport).toBeVisible();
    await expect(artifactExport).toHaveAttribute('open', '');
    await expect(artifactExport.getByRole('status')).toContainText(`Command selected ${artifact}.`);
  }
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Command search').fill('Export: AuraOne intake package');
  await page.getByRole('button', { name: /Export: AuraOne intake package/ }).click();
  await expect(page.locator('.export-command-status', { hasText: 'Command selected AuraOne intake package export.' })).toBeVisible();
  const scaleTaskExport = page.locator('details.export-item', { hasText: 'scale-task-spec.json' });
  if ((await scaleTaskExport.getAttribute('open')) === null) {
    await scaleTaskExport.getByText('scale-task-spec.json').click();
  }
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
  await page.getByLabel('Interface language').selectOption('es');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-locale', 'es');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('button', { name: /Nuevo desde plantilla/ })).toBeVisible();
  await page.locator('.locale-row select').selectOption('zh');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-locale', 'zh');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
  await expect(page.getByRole('button', { name: /从模板新建/ })).toBeVisible();
  await page.locator('.locale-row select').selectOption('ja');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-locale', 'ja');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.getByRole('button', { name: /テンプレートから新規作成/ })).toBeVisible();
  await page.locator('.locale-row select').selectOption('en');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-locale', 'en');
  const reliabilityPanel = page.locator('.glass-panel', { hasText: 'Crash reports and updates' });
  const reliabilityLog = reliabilityPanel.getByLabel('Reliability status JSON');
  await expect(reliabilityLog).toContainText('"crash_reporting_enabled": false');
  await expect(reliabilityLog).toContainText('"crash_default_off": true');
  await expect(reliabilityLog).toContainText('"sends_user_authored_content": false');
  await reliabilityPanel.getByLabel('Crash reports').check();
  await expect(reliabilityLog).toContainText('"crash_reporting_enabled": true');
  await reliabilityPanel.getByLabel('Update channel').selectOption('beta');
  await expect(reliabilityLog).toContainText('"update_channel": "beta"');
  const networkPanel = page.locator('.glass-panel', { hasText: 'No-network mode' });
  const noNetworkLog = networkPanel.getByLabel('No-network status JSON');
  await networkPanel.getByLabel('Block outbound calls').check();
  await expect(noNetworkLog).toContainText('"enabled": true');
  await reliabilityPanel.getByRole('button', { name: 'No-network active' }).click();
  await expect(reliabilityPanel.locator('.success-chip', { hasText: 'unavailable' })).toBeVisible();
  await expect(reliabilityLog).toContainText('No-network mode is active');
  const diagnosticsPanel = page.locator('.glass-panel', { hasText: 'Operational recovery' });
  const diagnosticsLog = diagnosticsPanel.getByLabel('Operational diagnostics JSON');
  await expect(diagnosticsPanel.getByRole('article').filter({ hasText: 'Sidecar crash' })).toContainText('Python sidecars are disabled in Browser Edition');
  await expect(diagnosticsPanel.getByRole('article').filter({ hasText: 'Git conflict' })).toContainText('cannot open a three-way local git conflict view');
  await expect(diagnosticsPanel.getByRole('article').filter({ hasText: 'Disk full' })).toContainText('local storage or the File System Access target is full');
  await expect(diagnosticsPanel.getByRole('article').filter({ hasText: 'Missing dependency' })).toContainText('needs no Python, git, or OS keychain');
  await diagnosticsPanel.getByRole('button', { name: 'Recheck' }).click();
  await expect(diagnosticsLog).toContainText('"recovery_states_covered"');
  await expect(diagnosticsLog).toContainText('"sidecar-crash"');
  await expect(diagnosticsLog).not.toContainText('not-run-this-session');
  const pluginPanel = page.locator('.glass-panel', { hasText: 'Engine plugin catalog' });
  const pluginCatalog = pluginPanel.getByLabel('Engine plugin catalog JSON');
  await expect(pluginPanel.getByLabel('Engine plugin marketplace')).toBeVisible();
  await expect(pluginPanel).toContainText('rubric-spec validator');
  await expect(pluginPanel).toContainText('Inspect export adapter');
  await expect(pluginPanel).toContainText('Unsigned remote runner');
  await expect(pluginPanel).toContainText('Desktop-only sidecar plugins are disabled in Browser Edition.');
  await expect(pluginCatalog).toContainText('"total": 5');
  await expect(pluginCatalog).toContainText('"available": 1');
  await expect(pluginCatalog).toContainText('"blocked": 3');
  await expect(pluginCatalog).toContainText('"sendsUserContent": 1');
  await pluginPanel.getByRole('button', { name: 'Load safe example' }).click();
  await expect(pluginPanel.getByLabel('Engine plugin manifest JSON')).toContainText('community-safe-adapter');
  await pluginPanel.getByRole('button', { name: 'Review manifest' }).click();
  await expect(pluginPanel).toContainText('Plugin manifest accepted');
  await expect(pluginPanel).toContainText('No remote code was installed');
  await expect(pluginPanel).toContainText('Community safe adapter');
  await expect(pluginCatalog).toContainText('"total": 6');
  await expect(pluginCatalog).toContainText('"plugin_id": "community-safe-adapter"');
  await expect(pluginCatalog).toContainText('"installable_without_network": true');
  await page.reload({ waitUntil: 'networkidle' });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+6' : 'Control+6');
  await expect(page.getByRole('tabpanel', { name: /settings panel/i })).toBeVisible();
  const reloadedTelemetryPanel = page.locator('.glass-panel', { hasText: 'Transparent event log' });
  const reloadedReliabilityPanel = page.locator('.glass-panel', { hasText: 'Crash reports and updates' });
  const reloadedNetworkPanel = page.locator('.glass-panel', { hasText: 'No-network mode' });
  const reloadedReliabilityLog = reloadedReliabilityPanel.getByLabel('Reliability status JSON');
  await expect(reloadedTelemetryPanel.getByLabel('Opt in')).toBeChecked();
  await expect(reloadedReliabilityPanel.getByLabel('Crash reports')).toBeChecked();
  await expect(reloadedReliabilityPanel.getByLabel('Update channel')).toHaveValue('beta');
  await expect(reloadedNetworkPanel.getByLabel('Block outbound calls')).toBeChecked();
  await reloadedNetworkPanel.getByLabel('Block outbound calls').uncheck();
  await expect(reloadedNetworkPanel.getByLabel('No-network status JSON')).toContainText('"enabled": false');
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
  await page.getByLabel('New criterion shortcut').fill('Cmd/Ctrl-Alt-0');
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
  await page.locator('.glass-panel', { hasText: 'No-network mode' }).getByLabel('Block outbound calls').check();

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+2' : 'Control+2');
  await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();
  const ollamaColumn = page.locator('.judge-column', { hasText: 'Ollama local' });
  await expect(ollamaColumn.getByText('Desktop only')).toBeVisible();
  await expect(ollamaColumn.getByText('Browser edition cannot reach local model judges. Open the desktop app for Ollama streaming.')).toBeVisible();
  await ollamaColumn.locator('details.score-card').first().locator('summary').click();
  await expect(ollamaColumn.getByRole('button', { name: 'Stream Ollama trace' }).first()).toBeDisabled();
  const gptColumn = page.locator('.judge-column', { hasText: 'GPT-5 mini' });
  await expect(gptColumn.getByText('Direct BYO scoring')).toBeVisible();
  await expect(gptColumn.getByText('Direct provider scoring is disabled; local mock scores, authoring, validation, diff, and local exports stay available.')).toBeVisible();
  await gptColumn.locator('details.score-card').first().locator('summary').click();
  await expect(gptColumn.getByRole('button', { name: 'Run direct provider score' }).first()).toBeDisabled();
  await page.getByRole('tab', { name: /Settings/ }).click();
  await page.locator('.glass-panel', { hasText: 'No-network mode' }).getByLabel('Block outbound calls').uncheck();
  await page.getByRole('tab', { name: /Preview/ }).click();
  await gptColumn.locator('details.score-card').first().locator('summary').click();
  await gptColumn.getByRole('button', { name: 'Run direct provider score' }).first().click();
  await expect(gptColumn.getByText('OpenAI rejected this BYO key (401). Rotate the key in Settings and retry direct provider scoring.')).toBeVisible();
  await expect(gptColumn.getByRole('button', { name: 'Retry direct provider scoring' })).toBeVisible();
  await gptColumn.getByRole('button', { name: 'Retry direct provider scoring' }).click();
  await expect(gptColumn.getByText('OpenAI rate limited this browser request (429). Wait for the provider limit to reset, then retry.')).toBeVisible();
  await gptColumn.getByRole('button', { name: 'Rotate key in Settings' }).click();
  await expect(page.getByRole('tabpanel', { name: /settings panel/i })).toBeVisible();
  await page.getByRole('tab', { name: /Preview/ }).click();
  await gptColumn.locator('details.score-card').first().locator('summary').click();
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
  await expect(page.getByRole('banner')).toContainText('AuraOne');
  await expect(page.getByRole('banner')).toContainText('Rubric Studio');
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  await page.getByLabel('Label').fill('No-network safe refusal');
  await expect(page.getByRole('heading', { name: 'No-network safe refusal' })).toBeVisible();
  await page.waitForTimeout(350);
  const savedLabel = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('rso:project')).criteria.find((criterion) => criterion.id === 'cites-uncertainty')?.label,
  );
  expect(savedLabel).toBe('No-network safe refusal');
  expect(blockedExternalRequests).toEqual([]);
  await context.close();
}

async function verifyFirstRunSkipPersists(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/?surface=browser&tour=1`, { waitUntil: 'networkidle' });
  const firstRunDialog = page.getByRole('dialog', { name: 'First-run wizard' });
  await expect(firstRunDialog).toBeVisible();
  await expect(firstRunDialog).toHaveAttribute('data-focus-trap', 'active');
  await expect.poll(() => firstRunDialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'First-run wizard' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('rso:onboarded'))).toBe('yes');
  await page.goto(`${baseUrl}/?surface=browser`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('dialog', { name: 'First-run wizard' })).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  await context.close();
}

async function verifyFirstRunScoreSample(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/?surface=browser&tour=1`, { waitUntil: 'networkidle' });
  const firstRunDialog = page.getByRole('dialog', { name: 'First-run wizard' });
  await expect(firstRunDialog).toBeVisible();
  await firstRunDialog.getByRole('button', { name: 'Score sample now' }).click();
  await expect(firstRunDialog).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();
  await expect(page.getByText('Scoring current sample with cancellable progress')).toBeVisible();
  await expect(page.locator('.loading-state .skeleton-pulse')).toBeVisible();
  await expect(page.locator('body')).toContainText('Current sample score run completed', { timeout: 5_000 });
  await expect(page.locator('.score-card').first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('rso:onboarded'))).toBe('yes');
  await context.close();
}

async function verifyUpdateNotificationUx(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('rso:onboarded', 'yes');
    window.__RUBRIC_STUDIO_TEST_UPDATE__ = {
      version: '0.2.0',
      body: '[mandatory]\n- Signed updater fixture from the platform release channel.',
      date: '2026-05-13',
      mandatory: true,
      signedBy: 'Fixture AuraOne Open Studio release key',
      signingDocsUrl: 'https://example.test/signing',
    };
  });
  await page.goto(`${baseUrl}/?surface=desktop`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /Settings/ }).click();
  await page.getByRole('button', { name: 'Check for updates' }).click();
  const updateDialog = page.getByRole('dialog', { name: 'Update available' });
  await expect(updateDialog).toBeVisible();
  await expect(updateDialog).toContainText('0.1.0');
  await expect(updateDialog).toContainText('0.2.0');
  await expect(updateDialog).toContainText('Signed updater fixture');
  await expect(updateDialog).toContainText('Fixture AuraOne Open Studio release key');
  await expect(updateDialog.getByRole('button', { name: 'Install on next launch' })).toBeVisible();
  await expect(updateDialog.getByRole('button', { name: 'Install now and restart' })).toBeVisible();
  await expect(updateDialog.getByRole('button', { name: 'Remind me later' })).toHaveCount(0);
  await updateDialog.getByRole('button', { name: 'Install now and restart' }).click();
  await expect(updateDialog.getByRole('status')).toContainText('Ready to install 0.2.0');
  await context.close();
}

async function verifyDesktopCalibrationRewrite(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('rso:onboarded', 'yes');
  });
  await page.goto(`${baseUrl}/?surface=desktop`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /Calibration/ }).click();
  await expect(page.getByRole('tabpanel', { name: /calibration panel/i })).toBeVisible();
  await page.getByRole('button', { name: 'Run calibration' }).click();
  await expect(page.locator('.calibration-run-status')).toContainText('Running iaa-kit calibration');
  await expect(page.getByLabel('Calibration run progress')).toBeVisible();
  await expect(page.locator('.calibration-run-status .skeleton-pulse')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel calibration run' }).click();
  await expect(page.locator('.calibration-run-status')).toContainText('Calibration run canceled');
  await page.getByRole('button', { name: 'Run calibration' }).click();
  await expect(page.locator('.calibration-run-status')).toContainText('Running iaa-kit calibration');
  await expect(page.locator('.calibration-run-status')).toContainText('Calibration run recorded in history');
  await page.getByRole('button', { name: 'Run bias probes' }).click();
  await expect(page.locator('.calibration-run-status')).toContainText('Running judge-bench bias probes');
  await expect(page.locator('.calibration-run-status')).toContainText('Bias probes completed');
  await page.getByRole('button', { name: 'Run contamination audit' }).click();
  await expect(page.locator('.calibration-run-status')).toContainText('Running contamination-audit leakage check');
  await expect(page.locator('.calibration-run-status')).toContainText('Contamination audit completed');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('rso:project'))).not.toBeNull();
  const criteriaIds = await page.evaluate(() => JSON.parse(localStorage.getItem('rso:project')).criteria.map((criterion) => criterion.id));
  const completeScores = Object.fromEntries(criteriaIds.map((criterionId) => [criterionId, 1]));
  await page.getByLabel('Load gold JSONL').setInputFiles({
    name: 'desktop-gold-set.jsonl',
    mimeType: 'application/jsonl',
    buffer: Buffer.from([
      JSON.stringify({
        id: 'desktop-gold-complete',
        prompt: 'Gold prompt with complete scores.',
        response: 'Gold response with observable evidence.',
        humanScores: completeScores,
      }),
      JSON.stringify({
        id: 'desktop-gold-partial',
        prompt: 'Gold prompt with missing scores.',
        response: 'Gold response missing most criterion scores.',
        scores: { [criteriaIds[0]]: 0 },
      }),
    ].join('\n')),
  });
  const goldSetSummary = page.getByLabel('Gold set validation summary');
  await expect(goldSetSummary).toContainText('1/2 complete rows');
  await expect(goldSetSummary).toContainText('desktop-gold-partial is missing');
  await expect(page.getByRole('contentinfo')).toContainText('Loaded 2 expert-scored gold rows');
  await page.getByRole('button', { name: 'Suggest rewrite' }).click();
  const rewritePanel = page.locator('.rewrite-panel');
  await expect(rewritePanel).toContainText('Make the pass threshold observable');
  await rewritePanel.getByLabel('Proposed description').fill('Desktop e2e staged description with observable review evidence.');
  await rewritePanel.getByLabel('Boundary guidance').fill('Desktop e2e staged boundary guidance.');
  await rewritePanel.getByLabel('Positive example').fill('Desktop e2e positive example.');
  await rewritePanel.getByLabel('Negative example').fill('Desktop e2e negative example.');
  await rewritePanel.getByRole('button', { name: 'Stage accepted rewrite' }).click();
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  const criterionDescription = page.getByRole('textbox', { name: 'Criterion description' });
  await expect(criterionDescription).toHaveValue('Desktop e2e staged description with observable review evidence.');
  await page.getByText('tags · domain · risk · fallback_behavior · stop_conditions').click();
  await expect(page.getByLabel('Boundaries')).toHaveValue('Desktop e2e staged boundary guidance.');
  await expect(page.locator('.rs-example-card.positive textarea')).toHaveValue(/Desktop e2e positive example\./);
  await expect(page.locator('.rs-example-card.negative textarea')).toHaveValue(/Desktop e2e negative example\./);
  await expect(page.locator('.rs-meta-strip label', { hasText: 'Status' }).locator('select')).toHaveValue('Draft');
  await expect(page.getByRole('contentinfo')).toContainText('Staged rewrite in the criterion editor');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
  await expect(criterionDescription).not.toHaveValue('Desktop e2e staged description with observable review evidence.');
  await context.close();
}

async function verifyDesktopGitOperations(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('rso:onboarded', 'yes');
  });
  await page.goto(`${baseUrl}/?surface=desktop`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /Calibration/ }).click();
  await expect(page.getByLabel('Advanced calibration analysis')).toBeVisible();
  await expect(page.getByLabel('Advanced calibration analysis')).toContainText('Hierarchical IAA');
  await expect(page.getByLabel('Advanced calibration analysis')).toContainText('Latent class analysis');
  await expect(page.getByLabel('Advanced calibration analysis')).toContainText('Stable consensus');
  await page.getByRole('tab', { name: /Preview/ }).click();
  await page.getByRole('button', { name: 'Score all' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Desktop score-run preview' })).toContainText('tauri-rust-core prepared');
  await expect(page.getByRole('status').filter({ hasText: 'Desktop score-run preview' })).toContainText('.rubric/score-runs/');
  await page.getByRole('tab', { name: /Diff/ }).click();
  await expect(page.getByRole('tabpanel', { name: /diff panel/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fetch' })).toBeEnabled();
  await page.getByRole('button', { name: 'Status', exact: true }).click();
  await expect(page.locator('.success-chip')).toContainText('main: 0 changed files, local-only.');
  await page.getByLabel('Target branch').fill('review/e2e update');
  await page.getByRole('button', { name: 'Branch', exact: true }).click();
  await expect(page.locator('.success-chip')).toContainText('Created local branch review/e2e-update from main.');
  await page.getByRole('button', { name: 'Fetch' }).click();
  await expect(page.locator('.success-chip')).toContainText('Add an origin remote before fetching.');
  await page.getByLabel('Origin remote').fill('git@github.com:auraoneai/rubric-studio-open.git');
  await page.getByRole('button', { name: 'Remote add' }).click();
  await expect(page.locator('.success-chip')).toContainText('Configured origin remote');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Command search').fill('Git fetch');
  await page.getByRole('button', { name: /Git fetch/ }).click();
  await expect(page.locator('.success-chip')).toContainText('Fetched refs from origin');
  await page.getByRole('button', { name: 'Fetch' }).click();
  await expect(page.locator('.success-chip')).toContainText('Fetched refs from origin');
  await page.getByRole('button', { name: 'Pull' }).click();
  await expect(page.locator('.success-chip')).toContainText('Pulled review/e2e-update with fast-forward-only policy.');
  await page.getByRole('button', { name: 'Push' }).click();
  await expect(page.locator('.success-chip')).toContainText('Pushed main to origin.');
  await page.getByRole('button', { name: 'Fast-forward merge' }).click();
  await expect(page.locator('.success-chip')).toContainText('Fast-forward merged review/e2e-update into main');
  await page.getByRole('button', { name: 'Try variant branch' }).click();
  await expect(page.getByLabel('Live judge fleet A/B test')).toBeVisible();
  await expect(page.getByLabel('Live judge fleet A/B test')).toContainText('Advanced diff');
  await expect(page.getByLabel('Live judge fleet A/B test')).toContainText('Variant wins');
  await expect(page.getByLabel('Live judge fleet A/B test')).toContainText('Baseline wins');
  await page.getByRole('button', { name: 'Discard' }).click();
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
