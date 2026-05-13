import { spawn } from 'node:child_process';
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.goto(`${baseUrl}/?surface=browser`, { waitUntil: 'networkidle' });

  const startTour = page.getByRole('button', { name: 'Start tour' });
  if (await startTour.isVisible().catch(() => false)) {
    await startTour.click();
    await expect(page.getByRole('dialog', { name: 'Author criteria like code' })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();
    await page.getByRole('button', { name: 'Skip tour' }).click();
  }

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'File menu' })).toBeVisible();
  await page.getByRole('menuitem', { name: /New project from template/ }).click();
  await expect(page.getByRole('dialog', { name: 'Create from template' })).toBeVisible();
  await page.getByLabel('Project name').fill('Browser Starter Rubric');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('Browser Starter Rubric')).toBeVisible();
  await expect(page.locator('body')).toContainText('Created browser starter project in local storage');

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
  await page.getByRole('treeitem', { name: /safe-refusal\.toml/ }).click({ button: 'right' });
  await expect(page.getByRole('menu', { name: /Actions for Safe refusal/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Open containing folder' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Reveal in Finder/Explorer' }).click();
  await expect(page.locator('body')).toContainText('Browser edition does not expose system file-manager actions.');
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
  await page.getByRole('button', { name: 'Score all' }).click();
  await expect(page.getByText('Scoring all criteria with cancellable progress')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel score run' }).click();
  await expect(page.locator('body')).toContainText('Score run canceled');
  await page.getByRole('button', { name: 'Score all' }).click();
  await expect(page.locator('body')).toContainText('Score run completed', { timeout: 5_000 });
  await page.getByRole('button', { name: /Safe refusal fail samples/i }).click();
  await expect(page.locator('.catch-controls select').nth(2)).toHaveValue('fail');

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
  await expect(page.getByText('CLI parity')).toBeVisible();
  const scaleTaskExport = page.locator('details.export-item', { hasText: 'scale-task-spec.json' });
  await scaleTaskExport.getByText('scale-task-spec.json').click();
  await scaleTaskExport.getByRole('button', { name: 'Download' }).click();
  await expect(page.getByRole('dialog', { name: 'Sending this to a vendor?' })).toBeVisible();
  await expect(page.getByText('AuraOne Rubric Programs gives you managed expert reviewers')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+6' : 'Control+6');
  await expect(page.getByRole('tabpanel', { name: /settings panel/i })).toBeVisible();
  await expect(page.getByText('BYO provider settings')).toBeVisible();
  await expect(page.getByText('Crash reports and updates')).toBeVisible();
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await expect(page.locator('.success-chip', { hasText: 'unavailable' })).toBeVisible();
  await expect(page.getByText('Remappable controls')).toBeVisible();

  await browser.close();
  console.log('Rubric Studio Open browser e2e smoke passed.');
} finally {
  server.kill('SIGTERM');
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
