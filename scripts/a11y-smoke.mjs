import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';

const port = Number(process.env.RSO_A11Y_PORT ?? 5207);
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, CI: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', (chunk) => {
  serverOutput += String(chunk);
});
server.stderr.on('data', (chunk) => {
  serverOutput += String(chunk);
});

try {
  await waitForServer(baseUrl);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 760 } });
  await page.goto(`${baseUrl}/?surface=browser`, { waitUntil: 'networkidle' });

  const skip = page.getByRole('button', { name: 'Skip' });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }

  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Rubric Studio Open tabs' })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: /authoring panel/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Skip to editor' })).toBeAttached();

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

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+6' : 'Control+6');
  await expect(page.getByRole('tabpanel', { name: /settings panel/i })).toBeVisible();
  await page.getByRole('radio', { name: 'high-contrast' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'high-contrast');

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  if (scrollWidth > 1024) {
    throw new Error(`1024px browser layout overflowed horizontally: ${scrollWidth}px`);
  }

  await browser.close();
  console.log('Rubric Studio Open accessibility smoke passed.');
} finally {
  server.kill('SIGTERM');
}

async function waitForServer(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
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
