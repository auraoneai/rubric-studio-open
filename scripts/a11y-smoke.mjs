import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.RSO_A11Y_PORT ?? 5207);
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port)], {
  cwd: root,
  env: { ...process.env, CI: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
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
  const context = await browser.newContext({ viewport: { width: 1024, height: 760 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/?surface=browser`, { waitUntil: 'networkidle' });

  const skip = page.getByRole('button', { name: 'Skip' });
  if (await page.getByRole('dialog', { name: 'First-run wizard' }).isVisible().catch(() => false)) {
    await assertAxeClean(page, 'first-run wizard');
    await page.getByRole('button', { name: 'Start tour' }).click();
    await expect(page.getByRole('dialog', { name: 'Author criteria like code' })).toBeVisible();
    await assertAxeClean(page, 'guided onboarding tour');
    await page.getByRole('button', { name: 'Skip tour' }).click();
  }
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }

  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Rubric Studio Open tabs' })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Skip to editor' })).toBeAttached();
  await assertAxeClean(page, 'authoring browser surface');
  await assertKeyboardPath(page);

  const unnamedButtons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .filter((button) => {
        const name = [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent]
          .join(' ')
          .trim();
        return name.length === 0;
      })
      .map((button) => button.outerHTML.slice(0, 160)),
  );
  if (unnamedButtons.length > 0) {
    throw new Error(`Buttons without accessible names:\n${unnamedButtons.join('\n')}`);
  }

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.getByLabel('Command search').fill('Settings');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);

  await page.getByRole('button', { name: 'New from Template' }).click();
  await expect(page.getByRole('dialog', { name: 'Create from template' })).toBeVisible();
  await assertAxeClean(page, 'template project dialog');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Create from template' })).toHaveCount(0);

  await assertTabAxeClean(page, 'Preview', 'preview browser surface');
  await assertTabAxeClean(page, 'Calibration', 'calibration browser surface');
  await assertTabAxeClean(page, 'Diff', 'diff browser surface');
  await assertTabAxeClean(page, 'Export', 'export browser surface');
  await assertTabAxeClean(page, 'Settings', 'settings browser surface');

  await page.getByRole('radio', { name: 'high-contrast' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'high-contrast');
  await assertAxeClean(page, 'settings high-contrast surface');

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  if (scrollWidth > 1024) {
    throw new Error(`1024px browser layout overflowed horizontally: ${scrollWidth}px`);
  }

  await context.close();
  await browser.close();
  console.log('Rubric Studio Open accessibility smoke passed.');
} finally {
  server.kill('SIGTERM');
}

async function assertTabAxeClean(page, tabName, label) {
  await page.getByRole('tab', { name: new RegExp(tabName, 'i') }).click();
  await expect(page.getByRole('tabpanel', { name: new RegExp(`${tabName} panel`, 'i') })).toBeVisible();
  await assertAxeClean(page, label);
}

async function assertKeyboardPath(page) {
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to editor' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeFocused();
  await page.keyboard.press('Tab');
  const focusedName = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
  if (!focusedName) {
    throw new Error('Keyboard-only path did not land on a named interactive control after the editor skip link.');
  }
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
            .map((node) => `${node.target.join(' ')}: ${node.failureSummary ?? violation.help}`)
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
      if (response.ok) {
        return;
      }
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Timed out waiting for ${url}\n${serverOutput}`);
}
