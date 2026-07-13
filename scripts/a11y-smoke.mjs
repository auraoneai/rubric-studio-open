import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.RSO_A11Y_PORT ?? 5207);
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
  await verifyFirstRunAndOperationalStates(browser);
  await verifyCompactA11y(browser, { width: 320, height: 720 });
  await verifyCompactA11y(browser, { width: 390, height: 844 });
  await verifyCompactA11y(browser, { width: 768, height: 1024 });
  await browser.close();
  console.log('Rubric Studio Open accessibility smoke passed.');
} finally {
  server.kill('SIGTERM');
}

async function verifyFirstRunAndOperationalStates(browser) {
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1024, height: 760 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(`${baseUrl}/?surface=browser&onboarding=1`, { waitUntil: 'networkidle' });

  const wizard = page.getByRole('dialog', { name: 'First-run wizard' });
  await expect(wizard).toBeVisible();
  await assertAxeClean(page, 'first-run wizard');
  await expect(wizard.getByRole('button', { name: 'Start tour' })).toBeFocused();
  await wizard.getByRole('button', { name: 'Skip' }).click();
  await expect(wizard).toHaveCount(0);

  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Rubric Studio Open tabs' })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  await assertAxeClean(page, 'authoring browser surface');
  await assertKeyboardPath(page);

  await page.keyboard.press(`${modifier}+K`);
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await expect(page.getByLabel('Command search')).toBeFocused();
  await assertAxeClean(page, 'command palette');
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);

  const templateTrigger = page.getByRole('button', { name: 'New from Template' });
  await templateTrigger.click();
  const templateDialog = page.getByRole('dialog', { name: 'Create from template' });
  await expect(templateDialog).toBeVisible();
  await assertAxeClean(page, 'template project dialog');
  await page.keyboard.press('Escape');
  await expect(templateDialog).toHaveCount(0);
  await expect(templateTrigger).toBeFocused();

  const importInput = page.locator('.rso-browser-controls input[type="file"]');
  await importInput.setInputFiles({
    name: 'invalid-project.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"project":{"id":"invalid","criteria":[]}}'),
  });
  await expect(page.getByRole('alert')).toContainText('Invalid project bundle');
  await assertAxeClean(page, 'browser import error and recovery');

  await expect.poll(() =>
    page.evaluate(() => localStorage.getItem('rso:project') !== null),
  ).toBe(true);
  const fullProject = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('rso:project') ?? '{}'),
  );
  const emptyProject = { ...fullProject, samples: [] };
  await importInput.setInputFiles({
    name: 'empty-project.rubric-project.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ project: emptyProject })),
  });
  await page.getByRole('tab', { name: /Preview/i }).click();
  await expect(page.getByText('No samples loaded')).toBeVisible();
  await assertAxeClean(page, 'empty preview state');

  await importInput.setInputFiles({
    name: 'restored-project.rubric-project.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ project: fullProject })),
  });
  await assertTabAxeClean(page, 'Preview', 'preview browser surface');
  await assertTabAxeClean(page, 'Calibrate', 'calibration browser surface', 'calibration');
  await assertTabAxeClean(page, 'Diff', 'diff browser surface');
  await assertTabAxeClean(page, 'Export', 'export browser surface');
  await assertTabAxeClean(page, 'Settings', 'settings browser surface');

  await page.getByRole('button', { name: 'Recheck' }).click();
  await expect(page.getByLabel('Operational diagnostics JSON')).not.toContainText(
    'not-run-this-session',
  );
  await assertAxeClean(page, 'settings after real diagnostics');

  await page.getByRole('radio', { name: 'High contrast' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'high-contrast');
  await assertAxeClean(page, 'settings high-contrast surface');

  const unnamedButtons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .filter((button) => {
        const name = [
          button.getAttribute('aria-label'),
          button.getAttribute('title'),
          button.textContent,
        ]
          .join(' ')
          .trim();
        return name.length === 0;
      })
      .map((button) => button.outerHTML.slice(0, 180)),
  );
  if (unnamedButtons.length > 0) {
    throw new Error(`Buttons without accessible names:\n${unnamedButtons.join('\n')}`);
  }
  await context.close();
}

async function verifyCompactA11y(browser, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('rso:onboarded', 'yes');
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/?surface=browser`, { waitUntil: 'networkidle' });

  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  await expect(page.getByLabel('Reviewer-visible behavior')).toBeVisible();
  await assertNoPageOverflow(page, viewport.width);
  await assertAxeClean(page, `${viewport.width}px authoring surface`);

  const projectTrigger = page.getByRole('button', { name: 'Open project navigation' });
  await projectTrigger.click();
  const projectDrawer = page.getByRole('complementary', { name: 'Project sidebar' });
  await expect(projectDrawer).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close project navigation' })).toBeFocused();
  await assertAxeClean(page, `${viewport.width}px project drawer`);
  await page.keyboard.press('Escape');
  await expect(projectDrawer).toBeHidden();
  await expect(projectTrigger).toBeFocused();

  await page.getByRole('button', { name: /Checks/ }).click();
  const inspector = page.getByRole('complementary', { name: 'Validation and search' });
  await expect(inspector).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close checks and search' })).toBeFocused();
  await assertAxeClean(page, `${viewport.width}px checks drawer`);
  await page.keyboard.press('Escape');
  await expect(inspector).toBeHidden();

  await page.getByRole('tab', { name: /Preview/i }).click();
  await expect(page.getByRole('tabpanel', { name: /preview panel/i })).toBeVisible();
  await assertNoPageOverflow(page, viewport.width);
  await assertAxeClean(page, `${viewport.width}px preview surface`);
  await context.close();
}

async function assertTabAxeClean(page, tabName, label, panelName = tabName) {
  await page.getByRole('tab', { name: new RegExp(tabName, 'i') }).click();
  await expect(
    page.getByRole('tabpanel', { name: new RegExp(`${panelName} panel`, 'i') }),
  ).toBeVisible();
  await assertAxeClean(page, label);
}

async function assertKeyboardPath(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to editor' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeFocused();
  await page.keyboard.press('Tab');
  const focusedName = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return '';
    const labelledBy = active
      .getAttribute('aria-labelledby')
      ?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    const labels =
      'labels' in active && active.labels
        ? Array.from(active.labels)
            .map((label) => label.textContent?.trim() ?? '')
            .filter(Boolean)
            .join(' ')
        : '';
    return (
      active.getAttribute('aria-label') ||
      labelledBy ||
      labels ||
      active.getAttribute('title') ||
      active.textContent?.trim() ||
      ''
    );
  });
  if (!focusedName) {
    throw new Error(
      'Keyboard-only path did not land on a named interactive control after the editor skip link.',
    );
  }
}

async function assertNoPageOverflow(page, viewportWidth) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.viewport).toBe(viewportWidth);
  expect(dimensions.document).toBe(viewportWidth);
  expect(dimensions.body).toBe(viewportWidth);
}

async function assertAxeClean(page, label) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  if (results.violations.length > 0) {
    throw new Error(
      `${label} has axe violations:\n${results.violations
        .map((violation) => {
          const nodes = violation.nodes
            .map(
              (node) =>
                `${node.target.join(' ')}: ${node.failureSummary ?? violation.help}`,
            )
            .join('\n');
          return `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help}\n${nodes}`;
        })
        .join('\n\n')}`,
    );
  }
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
