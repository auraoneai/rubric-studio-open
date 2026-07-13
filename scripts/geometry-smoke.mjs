import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.RSO_GEOMETRY_PORT ?? 5209);
const baseUrl = `http://127.0.0.1:${port}`;
const viewports = [
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 568, height: 320 },
  { width: 768, height: 1024 },
  { width: 1020, height: 768 },
  { width: 1440, height: 900 },
];
const stages = [
  { tab: 'Author', id: 'authoring', task: '.rs-title-editor input' },
  { tab: 'Preview', id: 'preview', task: '.rs-sample-deck button' },
  { tab: 'Calibrate', id: 'calibration', task: '.rs-metric-strip' },
  { tab: 'Diff', id: 'diff', task: '.rs-diff-summary' },
  { tab: 'Export', id: 'export', task: '.rs-export-progress' },
  { tab: 'Settings', id: 'settings', task: '.rs-settings-main button, .rs-settings-main input' },
];

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
  for (const viewport of viewports) {
    await verifyViewport(browser, viewport);
  }
  await browser.close();
  console.log('Rubric Studio Open responsive geometry smoke passed.');
} finally {
  server.kill('SIGTERM');
}

async function verifyViewport(browser, viewport) {
  console.log(`Checking ${viewport.width}x${viewport.height}...`);
  const context = await browser.newContext({
    viewport,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  await context.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('rso:onboarded', 'yes');
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/?surface=browser`, { waitUntil: 'networkidle' });

  const description = page.getByLabel('Reviewer-visible behavior');
  await expect(description).toBeVisible();
  await description.fill(
    `${await description.inputValue()} Require an explicit uncertainty boundary for local fixture comparison.`,
  );

  for (const stage of stages) {
    console.log(`  ${stage.tab}`);
    await page.getByRole('tab', { name: new RegExp(stage.tab, 'i') }).click();
    await expect(page.locator(`#main-panel[data-tab="${stage.id}"]`)).toBeVisible();
    if (stage.id === 'calibration') {
      const recompute = page.getByRole('button', { name: 'Recompute calibration' });
      if (await recompute.isVisible()) {
        await recompute.click();
      }
    }
    await page.evaluate(() => document.fonts.ready);
    await assertStageGeometry(page, viewport, stage);
    await assertLowerContentReachable(page, stage.id);
  }

  await page.getByRole('tab', { name: /Author/i }).click();
  const projectTrigger = page.getByRole('button', { name: 'Open project navigation' });
  if (await projectTrigger.isVisible()) {
    await projectTrigger.click();
    await expect(page.getByRole('complementary', { name: 'Project sidebar' })).toBeVisible();
    await assertStageGeometry(page, viewport, {
      tab: 'Author project drawer',
      id: 'authoring',
      task: '.sidebar.is-open .tree-file',
    });
    await page.keyboard.press('Escape');
  }

  const inspectorTrigger = page.getByRole('button', { name: /Checks/ });
  if (await inspectorTrigger.isVisible()) {
    await inspectorTrigger.click();
    await expect(page.getByRole('complementary', { name: 'Validation and search' })).toBeVisible();
    await assertStageGeometry(page, viewport, {
      tab: 'Author checks drawer',
      id: 'authoring',
      task: '.rs-copilot-rail.is-open input, .rs-copilot-rail.is-open button',
    });
    await page.keyboard.press('Escape');
  }

  expect(pageErrors).toEqual([]);
  await context.close();
}

async function assertStageGeometry(page, viewport, stage) {
  const result = await page.evaluate(
    ({ expectedWidth, stageLabel, taskSelector, compact }) => {
      const violations = [];
      const tolerance = 1.5;
      const isVisible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) !== 0 &&
          style.clip !== 'rect(0px, 0px, 0px, 0px)' &&
          rect.width > 1 &&
          rect.height > 1
        );
      };
      const labelFor = (element) =>
        (
          element.getAttribute('aria-label') ||
          element.getAttribute('title') ||
          element.textContent ||
          element.tagName
        )
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 80);
      const scrollableAncestor = (element) => {
        let current = element.parentElement;
        while (current && current !== document.body) {
          const style = getComputedStyle(current);
          if (
            current.scrollWidth > current.clientWidth + tolerance &&
            ['auto', 'scroll'].includes(style.overflowX)
          ) {
            return current;
          }
          current = current.parentElement;
        }
        return null;
      };

      const documentWidth = Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
      );
      if (Math.abs(innerWidth - expectedWidth) > tolerance) {
        violations.push(`viewport width ${innerWidth}px does not match ${expectedWidth}px`);
      }
      if (documentWidth > innerWidth + tolerance) {
        violations.push(`document width ${documentWidth}px exceeds viewport ${innerWidth}px`);
      }

      const horizontallyCritical = document.querySelectorAll(
        [
          '.topbar',
          '.rs-surface-header',
          '.rs-surface-header button',
          '.rs-surface-header label',
          '.rs-title-editor input',
          '.rs-lede-editor textarea',
          '.rs-preview-filters label',
          '.rs-package-action button',
          '.rs-package-scope label',
          '.rs-export-progress strong',
          '.rs-diff-main .rs-section-heading h2',
          '.rs-diff-main .rs-section-heading p',
          '.rs-change-card header p',
          '.sidebar.is-open',
          '.rs-copilot-rail.is-open',
        ].join(','),
      );
      for (const element of horizontallyCritical) {
        if (!isVisible(element) || scrollableAncestor(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.left < -tolerance || rect.right > innerWidth + tolerance) {
          violations.push(
            `${labelFor(element)} escapes horizontally (${rect.left.toFixed(1)}..${rect.right.toFixed(1)})`,
          );
        }
      }

      const clippingTargets = document.querySelectorAll(
        [
          '.tab > span',
          '.rs-header-actions button span',
          '.rs-preview-filters label',
          '.rs-sample-deck button span',
          '.rs-export-progress strong',
          '.rs-package-scope label > span',
          '.rs-package-action button',
          '.rs-diff-main .rs-section-heading h2',
          '.rs-diff-main .rs-section-heading p',
          '.rs-change-card header p',
        ].join(','),
      );
      for (const element of clippingTargets) {
        if (!isVisible(element)) continue;
        const style = getComputedStyle(element);
        const horizontalClip =
          element.scrollWidth > element.clientWidth + tolerance &&
          !['auto', 'scroll'].includes(style.overflowX);
        const verticalClip =
          element.scrollHeight > element.clientHeight + tolerance &&
          !['auto', 'scroll'].includes(style.overflowY);
        if (horizontalClip || verticalClip) {
          violations.push(
            `${labelFor(element)} is clipped (${element.clientWidth}x${element.clientHeight} client, ${element.scrollWidth}x${element.scrollHeight} content)`,
          );
        }
      }

      const description = document.querySelector('.rs-lede-editor textarea');
      if (
        description &&
        isVisible(description) &&
        description.scrollHeight > description.clientHeight + tolerance
      ) {
        violations.push(
          `criterion description is vertically clipped (${description.clientHeight}px client, ${description.scrollHeight}px content)`,
        );
      }

      for (const element of document.querySelectorAll('*')) {
        if (!isVisible(element)) continue;
        const style = getComputedStyle(element);
        if (
          element.scrollWidth > element.clientWidth + tolerance &&
          ['auto', 'scroll'].includes(style.overflowX) &&
          element.tabIndex < 0
        ) {
          violations.push(`horizontal scroller "${labelFor(element)}" is not keyboard focusable`);
        }
      }

      if (compact) {
        const interactive = document.querySelectorAll(
          'button, summary, a[href], label.file-button, input, select, textarea',
        );
        for (const element of interactive) {
          if (!isVisible(element) || element.matches('input[type="file"]')) continue;
          let target = element;
          if (element.matches('input[type="checkbox"], input[type="radio"]')) {
            target = element.closest('label') ?? element;
          }
          const rect = target.getBoundingClientRect();
          if (rect.width < 43.5 || rect.height < 43.5) {
            violations.push(
              `touch target "${labelFor(target)}" is ${rect.width.toFixed(1)}x${rect.height.toFixed(1)}px`,
            );
          }
        }
      }

      const minimumBodySize = innerWidth <= 820 ? 15 : 14;
      for (const element of document.querySelectorAll(
        '.rs-criterion-doc p, .rs-preview-main p, .rs-calibration-main p, .rs-diff-main p, .rs-export-main p, .rs-settings-main p, .rs-lede-editor textarea',
      )) {
        if (!isVisible(element)) continue;
        if (
          element.matches(
            '.rs-judge-contract, .rs-validation-summary p, .probe p, .rs-change-card header p, .panel-title p, .success-chip, .inline-error',
          )
        ) {
          continue;
        }
        const size = Number.parseFloat(getComputedStyle(element).fontSize);
        if (size + 0.01 < minimumBodySize) {
          violations.push(
            `body text "${labelFor(element)}" is ${size}px; expected at least ${minimumBodySize}px`,
          );
        }
      }

      const task = document.querySelector(taskSelector);
      if (!task || !isVisible(task)) {
        violations.push(`${stageLabel} has no visible first-viewport task for ${taskSelector}`);
      } else {
        const taskRect = task.getBoundingClientRect();
        const topbarBottom =
          document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
        if (taskRect.bottom <= topbarBottom || taskRect.top >= innerHeight) {
          violations.push(
            `${stageLabel} task is outside the first viewport (${taskRect.top.toFixed(1)}..${taskRect.bottom.toFixed(1)} of ${innerHeight})`,
          );
        }
      }

      return violations;
    },
    {
      expectedWidth: viewport.width,
      stageLabel: stage.tab,
      taskSelector: stage.task,
      compact: viewport.width <= 1020,
    },
  );

  if (result.length > 0) {
    throw new Error(
      `${viewport.width}x${viewport.height} ${stage.tab} geometry failed:\n${result.join('\n')}`,
    );
  }
}

async function assertLowerContentReachable(page, stageId) {
  const selectors = {
    authoring: '.rs-criterion-doc',
    preview: '.rs-preview-main',
    calibration: '.rs-calibration-main',
    diff: '.rs-diff-main',
    export: '.rs-export-main',
    settings: '.rs-settings-body',
  };
  const selector = selectors[stageId];
  const result = await page.locator(selector).evaluate((container) => {
    const maximum = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = maximum;
    return {
      maximum,
      actual: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    };
  });
  if (result.maximum > 2 && result.actual < result.maximum - 2) {
    throw new Error(
      `${stageId} lower content is unreachable (${result.actual}/${result.maximum}, ${result.clientHeight}/${result.scrollHeight})`,
    );
  }
  await page.locator(selector).evaluate((container) => {
    container.scrollTop = 0;
    container.scrollLeft = 0;
  });
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
