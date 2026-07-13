import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { startOfficialStyleBoundary } from '../tools/official-style-boundary.mjs';

const CAPTURE_DATE = '2026-07-13';
const PRODUCT_ID = 'rubric-studio-open';
const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repoRoot = appRoot;
const websiteRoot = resolve(
  process.env.AURAONE_WEBSITE_ROOT ?? resolve(appRoot, '../auraone-website'),
);
const outputRoot = resolve(appRoot, 'docs/captures/0.2.0');
const evidencePath = resolve(outputRoot, 'capture-evidence.json');
const port = Number(process.env.RUBRIC_STUDIO_CAPTURE_PORT ?? 4331);
const baseUrl = `http://127.0.0.1:${port}`;
const verifyOnly = process.argv.includes('--verify');
const officialStyleAssetRoot = resolve(
  process.env.AURAONE_OFFICIAL_STYLE_ASSET_ROOT ??
    resolve(appRoot, '../auraone-website/public/fonts'),
);
const officialStyleSource = 'auraone-website/public/fonts';
const officialStylePackagePolicy =
  'No private font binary is copied into OSS source or distributable packages.';

const scenarios = [
  {
    id: 'author',
    tab: 'Author',
    panel: 'authoring',
    filename: 'author-criteria',
    task: '.rs-title-editor input',
    lowerMarker: '.rs-advanced summary',
    alt: 'Rubric Studio Open criterion authoring workspace with project navigation, editable criterion fields, save state, and validation.',
  },
  {
    id: 'preview',
    tab: 'Preview',
    panel: 'preview',
    filename: 'preview-scoring',
    task: '.rs-sample-deck button',
    lowerMarker: '.rs-judge-grid',
    alt: 'Rubric Studio Open reviewer preview with populated samples, deterministic local fixture scores, and criterion evidence.',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Run local fixtures' }).click();
      await expect(page.locator('.loading-state')).toHaveCount(0, { timeout: 2_000 });
      await expect(page.locator('.rs-score-row')).not.toHaveCount(0);
    },
  },
  {
    id: 'calibrate',
    tab: 'Calibrate',
    panel: 'calibration',
    filename: 'calibrate-gold',
    task: '.rs-metric-strip',
    lowerMarker: '.rs-rewrite-list',
    alt: 'Rubric Studio Open calibration workspace with deterministic agreement metrics, imported gold coverage, and a measured rewrite queue.',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Recompute calibration' }).click();
      await expect(page.locator('.rs-run-history')).toBeVisible();
    },
  },
  {
    id: 'diff',
    tab: 'Diff',
    panel: 'diff',
    filename: 'diff-score-impact',
    task: '.rs-diff-summary',
    lowerMarker: '.rs-change-card',
    alt: 'Rubric Studio Open local checkpoint comparison with a populated semantic change and deterministic fixture score impact.',
    beforeSelect: async (page) => {
      const description = page.getByLabel('Reviewer-visible behavior');
      await description.fill(
        `${await description.inputValue()} Require one quoted uncertainty boundary before the safe next step.`,
      );
    },
    prepare: async (page) => {
      await expect(page.locator('.rs-change-card')).not.toHaveCount(0);
    },
  },
  {
    id: 'export',
    tab: 'Export',
    panel: 'export',
    filename: 'export-artifacts',
    task: '.rs-export-progress',
    lowerMarker: '.rs-pack-table',
    alt: 'Rubric Studio Open review, validation, and unsigned local evidence package workflow with portable artifact outputs.',
    prepare: async (page) => {
      await expect(page.getByText('Signing:')).toContainText('Unavailable');
      await expect(page.getByRole('button', { name: 'Create evidence ZIP' })).toBeVisible();
    },
  },
];

const viewports = [
  {
    id: 'desktop',
    surface: 'desktop',
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
  },
  {
    id: 'mobile',
    surface: 'browser',
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
  },
];

const sourceInputs = [
  'index.html',
  'package.json',
  'pnpm-lock.yaml',
  'scripts/capture_screenshots.mjs',
  'src',
  'tsconfig.json',
  'vite.config.ts',
  'tools/official-style-boundary.mjs',
];
const fixtureInputs = [
  'src/domain/rubric.ts',
  'src/domain/samples.ts',
];
const sharedRuntimeInputGroups = {
  'proofline-oss': [
    'packages/proofline-oss/package.json',
    'packages/proofline-oss/src',
    'packages/proofline-oss/dist',
  ],
  'aura-ide-kit': [
    'packages/aura-ide-kit/package.json',
    'packages/aura-ide-kit/src',
    'packages/aura-ide-kit/dist',
  ],
  'platform-contracts': [
    'packages/platform-contracts/package.json',
    'packages/platform-contracts/src',
    'packages/platform-contracts/dist',
  ],
};
const captureMethod =
  'Playwright Chromium against the local Vite application; approved official stylesheet delivered through a temporary loopback private render boundary with no private font binaries in OSS source or packages; fresh page and reset storage per scenario; supported browser surface for mobile and desktop capability surface for desktop; viewport-only opaque screenshot; reduced motion; animations and caret disabled; external network blocked; deterministic populated scenarios; DOM overflow, text clipping, supported-state, and lower-content reachability assertions; deterministic cwebp conversion.';
const syntheticProvenance =
  'Repository-owned sample rubric, criteria, judge, calibration, diff, and response fixtures from src/domain/rubric.ts and src/domain/samples.ts. No customer, worker, personal, credential, endpoint secret, or sensitive source data.';

if (verifyOnly) {
  await verifyEvidence();
} else {
  await captureEvidence();
}

async function captureEvidence() {
  const packageJson = JSON.parse(await readFile(resolve(appRoot, 'package.json'), 'utf8'));
  assert(packageJson.version === '0.2.0', `Expected ${PRODUCT_ID} 0.2.0, received ${packageJson.version}`);

  const sourceState = await currentSourceState();
  const sourceDigest = await digestInputs(sourceInputs, 'Rubric Studio source');
  const fixtureDigest = await digestInputs(fixtureInputs, 'Rubric Studio synthetic fixtures');
  const sharedRuntimeDependencies = await sharedDependencyDigests();
  const sharedRuntimeSha256 = sha256(
    JSON.stringify(
      Object.entries(sharedRuntimeDependencies)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => [name, value.sha256, value.fileCount]),
    ),
  );
  const officialStyleBoundary = await officialStyleBoundaryEvidence();
  const captureSpecSha256 = captureSpecDigest(
    sharedRuntimeDependencies,
    officialStyleBoundary,
  );

  await mkdir(outputRoot, { recursive: true });
  const officialStyleServer = await startOfficialStyleBoundary({
    assetRoot: officialStyleAssetRoot,
  });
  const server = spawn(
    'pnpm',
    ['exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        NO_COLOR: '1',
        VITE_AURAONE_OFFICIAL_STYLE_URL:
          officialStyleServer.stylesheetUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let serverLog = '';
  server.stdout.on('data', (chunk) => {
    serverLog += String(chunk);
  });
  server.stderr.on('data', (chunk) => {
    serverLog += String(chunk);
  });

  const records = [];
  try {
    await waitForServer(server);
    const browser = await chromium.launch();
    try {
      for (const viewport of viewports) {
        const context = await browser.newContext({
          viewport,
          deviceScaleFactor: viewport.deviceScaleFactor,
          colorScheme: 'light',
          reducedMotion: 'reduce',
          locale: 'en-US',
          timezoneId: 'UTC',
        });
        await context.addInitScript(() => {
          window.localStorage.clear();
          window.sessionStorage.clear();
          window.localStorage.setItem('rso:onboarded', 'yes');
        });
        await context.route('**/*', async (route) => {
          const requestUrl = new URL(route.request().url());
          if (
            requestUrl.protocol === 'data:' ||
            requestUrl.protocol === 'blob:' ||
            requestUrl.hostname === '127.0.0.1' ||
            requestUrl.hostname === 'localhost'
          ) {
            await route.continue();
          } else {
            await route.abort('blockedbyclient');
          }
        });

        for (const scenario of scenarios) {
          const page = await context.newPage();
          try {
            await page.goto(`${baseUrl}/?surface=${viewport.surface}`, {
              waitUntil: 'networkidle',
            });
            await waitForOfficialStyle(page);
            await expect(page.getByRole('dialog', { name: 'First-run wizard' })).toHaveCount(0);
            await expect(page.locator('.app-shell')).toHaveAttribute(
              'data-surface',
              viewport.surface,
            );
            await page.addStyleTag({
              content:
                'html,body,#root,.app-shell{background:#f5f7fa!important}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}',
            });
            await scenario.beforeSelect?.(page);
            await page
              .getByRole('tab', { name: new RegExp(`^${scenario.tab}`, 'i') })
              .click();
            await expect(
              page.locator(`#main-panel[data-tab="${scenario.panel}"]`),
            ).toBeVisible();
            await scenario.prepare?.(page);
            await expect(page.locator('.save-readout')).toHaveClass(/saved/, {
              timeout: 2_000,
            });
            await page.evaluate(() => document.fonts.ready);
            await assertSupportedScenario(page, scenario, viewport);
            await assertLowerContentReachable(page, scenario);
            await resetCaptureScroll(page);
            await delay(150);
            await assertCaptureLayout(page, scenario, viewport);

            const suffix = viewport.id === 'mobile' ? '.mobile' : '';
            const localPng = resolve(
              outputRoot,
              `${scenario.filename}.${viewport.id}.png`,
            );
            const localWebp = resolve(
              outputRoot,
              `${scenario.filename}.${viewport.id}.webp`,
            );
            const websiteOutput = resolve(
              websiteRoot,
              `public/open/${PRODUCT_ID}/screenshots/${scenario.filename}${suffix}.webp`,
            );

            await page.screenshot({
              path: localPng,
              animations: 'disabled',
              caret: 'hide',
              fullPage: false,
              omitBackground: false,
            });
            await convertToWebp(localPng, localWebp);
            await mkdir(dirname(websiteOutput), { recursive: true });
            await copyFile(localWebp, websiteOutput);

            const pngBytes = await readFile(localPng);
            const webpBytes = await readFile(localWebp);
            const dimensions = readPngDimensions(pngBytes);
            records.push({
              id: `${PRODUCT_ID}-${scenario.id}-${viewport.id}`,
              scenario: scenario.id,
              variant: viewport.id,
              surface: viewport.surface,
              altOrCaption: scenario.alt,
              localPngOutput: relative(repoRoot, localPng),
              localWebpOutput: relative(repoRoot, localWebp),
              websiteOutput: relative(repoRoot, websiteOutput),
              viewport: {
                width: viewport.width,
                height: viewport.height,
                deviceScaleFactor: viewport.deviceScaleFactor,
              },
              dimensions,
              sourcePngSha256: sha256(pngBytes),
              sha256: sha256(webpBytes),
              fileSize: webpBytes.byteLength,
              format: 'webp',
              captureMethod,
              syntheticProvenance,
              assertions: {
                supportedSurface: true,
                populatedScenario: true,
                lowerContentReachable: true,
                viewportOriginReset: true,
                noDocumentOverflow: true,
                noCriticalTextClipping: true,
              },
            });
          } finally {
            await page.close();
          }
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${serverLog}`);
  } finally {
    server.kill('SIGTERM');
    await Promise.race([onceExit(server), delay(3_000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
    await officialStyleServer.close();
  }

  assert(records.length === 10, `Capture must produce exactly 10 records, received ${records.length}`);
  const evidence = {
    schemaVersion: 'auraone.local-product-capture.v3',
    productId: PRODUCT_ID,
    productVersion: packageJson.version,
    capturedAt: CAPTURE_DATE,
    captureEvidenceState: 'verified-local',
    releaseState: 'stale',
    releaseStateReason:
      'The captures verify the current local 0.2.0 source UI only. They do not verify a committed source snapshot, signed binary, installer, package-manager release, or updater artifact.',
    baseSourceCommit: sourceState.baseSourceCommit,
    sourceState: sourceState.state,
    sourceChangeCount: sourceState.changeCount,
    sourceChangeDigest: sourceState.changeDigest,
    sourceContentSha256: sourceDigest.sha256,
    sourceContentFileCount: sourceDigest.fileCount,
    syntheticFixtureSha256: fixtureDigest.sha256,
    syntheticFixtureFileCount: fixtureDigest.fileCount,
    sharedRuntimeDependencies,
    sharedRuntimeSha256,
    officialStyleBoundary,
    captureSpecSha256,
    captureMethod,
    syntheticProvenance,
    records,
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await verifyEvidence();
  console.log(`Captured and verified ${records.length} ${PRODUCT_ID} assets.`);
}

async function assertSupportedScenario(page, scenario, viewport) {
  if (viewport.id === 'mobile') {
    assert(
      new URL(page.url()).searchParams.get('surface') === 'browser',
      'Mobile capture must use the supported browser surface',
    );
    await expect(page.locator('.rso-browser-controls')).toBeVisible();
  }
  if (scenario.id === 'preview') {
    await expect(page.locator('.rs-sample-deck button')).not.toHaveCount(0);
    await expect(page.locator('.rs-score-row')).not.toHaveCount(0);
  }
  if (scenario.id === 'calibrate') {
    await expect(page.locator('.rs-metric-strip')).toBeVisible();
    await expect(page.locator('.rs-calibration-table > div')).not.toHaveCount(0);
  }
  if (scenario.id === 'diff') {
    await expect(page.locator('.rs-change-card')).not.toHaveCount(0);
  }
  if (scenario.id === 'export') {
    await expect(page.getByText('Signing:')).toContainText('Unavailable');
    await expect(page.locator('.rs-pack-table > div')).not.toHaveCount(0);
  }
}

async function assertLowerContentReachable(page, scenario) {
  const containerSelector = {
    author: '.rs-criterion-doc',
    preview: '.rs-preview-main',
    calibrate: '.rs-calibration-main',
    diff: '.rs-diff-main',
    export: '.rs-export-main',
  }[scenario.id];
  const result = await page.evaluate(
    ({ containerSelector: selector, markerSelector }) => {
      const container = document.querySelector(selector);
      const marker = document.querySelector(markerSelector);
      if (!container || !marker) {
        return { error: `Missing ${!container ? selector : markerSelector}` };
      }
      const containerRect = container.getBoundingClientRect();
      const markerBefore = marker.getBoundingClientRect();
      const neededScroll = markerBefore.bottom > containerRect.bottom + 1;
      marker.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'auto' });
      const markerAfter = marker.getBoundingClientRect();
      const maximum = Math.max(0, container.scrollHeight - container.clientHeight);
      const visibleAfter =
        markerAfter.bottom > containerRect.top && markerAfter.top < containerRect.bottom;
      return {
        neededScroll,
        maximum,
        actual: container.scrollTop,
        visibleAfter,
      };
    },
    { containerSelector, markerSelector: scenario.lowerMarker },
  );
  assert(!result.error, result.error);
  assert(
    !result.neededScroll || result.actual > 0,
    `${scenario.id} lower content did not move its owned scroll container`,
  );
  assert(result.visibleAfter, `${scenario.id} lower content marker is not reachable`);
}

async function resetCaptureScroll(page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    for (const selector of [
      '.tabbar',
      '.main-panel',
      '.rs-criterion-doc',
      '.rs-preview-main',
      '.rs-calibration-main',
      '.rs-diff-main',
      '.rs-export-main',
      '.rs-analysis-rail',
      '.rs-copilot-rail',
      '.rs-doc-status',
      '.rs-preview-filters',
      '.rs-sample-deck',
    ]) {
      const element = document.querySelector(selector);
      if (element) {
        element.scrollTop = 0;
        element.scrollLeft = 0;
      }
    }
  });
}

async function assertCaptureLayout(page, scenario, viewport) {
  const result = await page.evaluate(
    ({ scenarioId, expectedWidth, expectedSurface, taskSelector }) => {
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
      const assertInsideViewport = (element, label) => {
        if (!element || !isVisible(element)) return;
        const rect = element.getBoundingClientRect();
        if (rect.left < -tolerance || rect.right > innerWidth + tolerance) {
          violations.push(
            `${label} is outside the viewport (${rect.left.toFixed(1)}..${rect.right.toFixed(1)} of ${innerWidth})`,
          );
        }
      };

      const shell = document.querySelector('.app-shell');
      if (shell?.getAttribute('data-surface') !== expectedSurface) {
        violations.push(
          `surface ${shell?.getAttribute('data-surface') ?? 'missing'} does not match ${expectedSurface}`,
        );
      }
      const documentWidth = Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
      );
      if (Math.abs(innerWidth - expectedWidth) > tolerance) {
        violations.push(`viewport width ${innerWidth}px does not match ${expectedWidth}px`);
      }
      if (documentWidth > expectedWidth + tolerance) {
        violations.push(`document width ${documentWidth}px exceeds ${expectedWidth}px`);
      }

      const topbar = document.querySelector('.topbar');
      assertInsideViewport(topbar, 'topbar');
      if (topbar) {
        const rect = topbar.getBoundingClientRect();
        if (Math.abs(rect.top) > tolerance) {
          violations.push(`topbar begins at ${rect.top.toFixed(1)}px instead of the viewport origin`);
        }
      }

      const activeTab = document.querySelector('.tab.active');
      assertInsideViewport(activeTab, 'active workflow tab');
      for (const tab of document.querySelectorAll('.tab')) {
        assertInsideViewport(tab, `workflow tab "${labelFor(tab)}"`);
        const label = tab.querySelector('span');
        if (
          label &&
          isVisible(label) &&
          (label.scrollWidth > label.clientWidth + tolerance ||
            label.scrollHeight > label.clientHeight + tolerance)
        ) {
          violations.push(`workflow tab label "${labelFor(label)}" is clipped`);
        }
      }

      const surfaceHeader = document.querySelector('.rs-surface-header');
      assertInsideViewport(surfaceHeader, 'surface header');
      for (const child of surfaceHeader?.children ?? []) {
        assertInsideViewport(child, `surface header ${labelFor(child)}`);
      }

      const task = document.querySelector(taskSelector);
      if (!task || !isVisible(task)) {
        violations.push(`missing visible task ${taskSelector}`);
      } else {
        const rect = task.getBoundingClientRect();
        if (rect.top >= innerHeight || rect.bottom <= 0) {
          violations.push(`task ${taskSelector} is outside the first viewport`);
        }
      }

      const clippingTargets = document.querySelectorAll(
        [
          '.rs-header-actions button span',
          '.rs-preview-filters label',
          '.rs-sample-deck button span',
          '.rs-export-progress strong',
          '.rs-package-action button',
          '.rs-diff-main .rs-section-heading h2',
          '.rs-diff-main .rs-section-heading p',
          '.rs-change-card header p',
        ].join(','),
      );
      for (const element of clippingTargets) {
        if (!isVisible(element)) continue;
        const style = getComputedStyle(element);
        if (
          (element.scrollWidth > element.clientWidth + tolerance &&
            !['auto', 'scroll'].includes(style.overflowX)) ||
          (element.scrollHeight > element.clientHeight + tolerance &&
            !['auto', 'scroll'].includes(style.overflowY))
        ) {
          violations.push(`"${labelFor(element)}" is clipped`);
        }
      }

      if (scenarioId === 'author') {
        const description = document.querySelector('.rs-lede-editor textarea');
        assertInsideViewport(description, 'criterion description');
        if (
          description &&
          description.scrollHeight > description.clientHeight + tolerance
        ) {
          violations.push(
            `criterion description is vertically clipped (${description.clientHeight}px client, ${description.scrollHeight}px content)`,
          );
        }
        const publish = document.querySelector('[aria-label="Publish criterion"]');
        assertInsideViewport(publish, 'Publish criterion');
      }

      if (scenarioId === 'preview') {
        for (const filter of document.querySelectorAll('.rs-preview-filters label')) {
          assertInsideViewport(filter, `preview filter "${labelFor(filter)}"`);
        }
      }

      if (scenarioId === 'calibrate') {
        for (const row of document.querySelectorAll('.rs-calibration-table > div:not(.head)')) {
          const cells = Array.from(row.children).filter(isVisible);
          for (let index = 0; index < cells.length - 1; index += 1) {
            const current = cells[index].getBoundingClientRect();
            const next = cells[index + 1].getBoundingClientRect();
            const sharesRow =
              Math.min(current.bottom, next.bottom) - Math.max(current.top, next.top) > tolerance;
            if (sharesRow && current.right > next.left + tolerance) {
              violations.push(
                `calibration row cells overlap (${current.right.toFixed(1)} > ${next.left.toFixed(1)})`,
              );
            }
          }
        }
      }

      if (scenarioId === 'diff') {
        if (document.querySelectorAll('.rs-change-card').length === 0) {
          violations.push('diff capture has no populated change card');
        }
        for (const element of document.querySelectorAll(
          '.rs-diff-main .rs-section-heading h2, .rs-diff-main .rs-section-heading p, .rs-change-card header p',
        )) {
          assertInsideViewport(element, `diff text "${labelFor(element)}"`);
        }
      }

      if (scenarioId === 'export') {
        for (const step of document.querySelectorAll('.rs-export-progress strong')) {
          assertInsideViewport(step, `export step "${labelFor(step)}"`);
        }
      }

      return violations;
    },
    {
      scenarioId: scenario.id,
      expectedWidth: viewport.width,
      expectedSurface: viewport.surface,
      taskSelector: scenario.task,
    },
  );

  assert(
    result.length === 0,
    `${scenario.id}/${viewport.id} layout assertions failed:\n${result.join('\n')}`,
  );
}

async function verifyEvidence() {
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  const sourceState = await currentSourceState();
  const sourceDigest = await digestInputs(sourceInputs, 'Rubric Studio source');
  const fixtureDigest = await digestInputs(fixtureInputs, 'Rubric Studio synthetic fixtures');
  const sharedRuntimeDependencies = await sharedDependencyDigests();
  const sharedRuntimeSha256 = sha256(
    JSON.stringify(
      Object.entries(sharedRuntimeDependencies)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => [name, value.sha256, value.fileCount]),
    ),
  );
  const officialStyleBoundary = await officialStyleBoundaryEvidence();

  assert(evidence.schemaVersion === 'auraone.local-product-capture.v3', 'Unexpected capture schema');
  assert(evidence.productId === PRODUCT_ID, 'Unexpected product id');
  assert(evidence.productVersion === '0.2.0', 'Unexpected product version');
  assert(evidence.capturedAt === CAPTURE_DATE, 'Unexpected capture date');
  assert(evidence.captureEvidenceState === 'verified-local', 'Capture must be verified-local');
  assert(evidence.releaseState === 'stale', 'Release state must remain stale');
  assert(
    await isAncestorCommit(
      evidence.baseSourceCommit,
      sourceState.baseSourceCommit,
    ),
    'Recorded capture base is not an ancestor of current HEAD',
  );
  assert(evidence.sourceState === 'dirty-uncommitted', 'Expected explicit dirty-uncommitted state');
  assert(evidence.sourceState === sourceState.state, 'Recorded source state no longer matches');
  assert(evidence.sourceChangeCount === sourceState.changeCount, 'Source change count drifted');
  assert(evidence.sourceChangeDigest === sourceState.changeDigest, 'Source change digest drifted');
  assert(evidence.sourceContentSha256 === sourceDigest.sha256, 'Source content digest is stale');
  assert(evidence.sourceContentFileCount === sourceDigest.fileCount, 'Source file count drifted');
  assert(evidence.syntheticFixtureSha256 === fixtureDigest.sha256, 'Synthetic fixture digest is stale');
  assert(
    evidence.syntheticFixtureFileCount === fixtureDigest.fileCount,
    'Synthetic fixture file count drifted',
  );
  assert(
    JSON.stringify(evidence.sharedRuntimeDependencies) ===
      JSON.stringify(sharedRuntimeDependencies),
    'Shared runtime dependency closure drifted',
  );
  assert(evidence.sharedRuntimeSha256 === sharedRuntimeSha256, 'Shared runtime aggregate digest drifted');
  assert(
    JSON.stringify(evidence.officialStyleBoundary) ===
      JSON.stringify(officialStyleBoundary),
    'Official style boundary digest or policy drifted',
  );
  assert(
    evidence.captureSpecSha256 ===
      captureSpecDigest(sharedRuntimeDependencies, officialStyleBoundary),
    'Capture specification digest drifted',
  );
  assert(evidence.records.length === 10, 'Rubric release capture count must remain exactly 10');
  assert(
    new Set(evidence.records.map((record) => record.id)).size === evidence.records.length,
    'Capture record IDs must be unique',
  );

  for (const record of evidence.records) {
    assert(
      record.variant !== 'mobile' || record.surface === 'browser',
      `${record.id} mobile capture must use the browser surface`,
    );
    assert(
      Object.values(record.assertions ?? {}).every(Boolean),
      `${record.id} has an unverified scenario assertion`,
    );
    const pngPath = resolve(repoRoot, record.localPngOutput);
    const webpPath = resolve(repoRoot, record.localWebpOutput);
    const websitePath = resolve(repoRoot, record.websiteOutput);
    const pngBytes = await readFile(pngPath);
    const webpBytes = await readFile(webpPath);
    const websiteBytes = await readFile(websitePath);
    assert(sha256(pngBytes) === record.sourcePngSha256, `${record.id} PNG hash mismatch`);
    assert(sha256(webpBytes) === record.sha256, `${record.id} WebP hash mismatch`);
    assert(sha256(websiteBytes) === record.sha256, `${record.id} website hash mismatch`);
    assert(
      JSON.stringify(readPngDimensions(pngBytes)) === JSON.stringify(record.dimensions),
      `${record.id} PNG dimensions mismatch`,
    );
    assert(
      JSON.stringify(readWebpDimensions(webpBytes)) === JSON.stringify(record.dimensions),
      `${record.id} WebP dimensions mismatch`,
    );
    assert(webpBytes.byteLength === record.fileSize, `${record.id} file size mismatch`);
  }
  console.log(`Verified ${evidence.records.length} ${PRODUCT_ID} capture records.`);
}

async function currentSourceState() {
  const baseSourceCommit = (await run('git', ['rev-parse', 'HEAD'], repoRoot)).trim();
  const status = await run(
    'git',
    [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      '.',
      ':(exclude)docs/captures',
    ],
    repoRoot,
  );
  const changes = status.split(/\r?\n/).filter(Boolean).sort();
  return {
    baseSourceCommit,
    state: changes.length > 0 ? 'dirty-uncommitted' : 'clean',
    changeCount: changes.length,
    changeDigest: sha256(changes.join('\n')),
  };
}

async function isAncestorCommit(baseCommit, headCommit) {
  try {
    await run(
      'git',
      ['merge-base', '--is-ancestor', baseCommit, headCommit],
      repoRoot,
    );
    return true;
  } catch {
    return false;
  }
}

async function sharedDependencyDigests() {
  const entries = await Promise.all(
    Object.entries(sharedRuntimeInputGroups).map(async ([name, inputs]) => {
      const digest = await digestInputs(inputs, `shared runtime ${name}`);
      return [
        name,
        {
          sha256: digest.sha256,
          fileCount: digest.fileCount,
          requiredPaths: inputs.map((input) => relative(repoRoot, resolve(appRoot, input))),
        },
      ];
    }),
  );
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function captureSpecDigest(sharedRuntimeDependencies, officialStyleBoundary) {
  return sha256(
    JSON.stringify({
      productId: PRODUCT_ID,
      productVersion: '0.2.0',
      scenarios: scenarios.map(
        ({ prepare: _prepare, beforeSelect: _beforeSelect, ...scenario }) => scenario,
      ),
      viewports,
      sharedRuntimeDependencies,
      officialStyleBoundary,
      captureMethod,
      syntheticProvenance,
    }),
  );
}

async function officialStyleBoundaryEvidence() {
  const digest = await digestInputs(
    [officialStyleAssetRoot],
    'official style boundary',
  );
  return {
    source: officialStyleSource,
    sha256: digest.sha256,
    fileCount: digest.fileCount,
    delivery: 'temporary loopback server',
    packagePolicy: officialStylePackagePolicy,
  };
}

async function digestInputs(inputs, label) {
  const files = [];
  for (const input of inputs) {
    const absolute = resolve(appRoot, input);
    let info;
    try {
      info = await stat(absolute);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error(`${label} is missing required capture dependency ${absolute}`);
      }
      throw error;
    }
    if (info.isDirectory()) {
      await collectFiles(absolute, files);
    } else if (info.isFile()) {
      files.push(absolute);
    } else {
      throw new Error(`${label} dependency is not a regular file or directory: ${absolute}`);
    }
  }
  const uniqueFiles = [...new Set(files)].sort();
  assert(uniqueFiles.length > 0, `${label} dependency closure is empty`);
  const hash = createHash('sha256');
  for (const file of uniqueFiles) {
    hash.update(relative(repoRoot, file));
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return {
    sha256: hash.digest('hex'),
    fileCount: uniqueFiles.length,
  };
}

async function collectFiles(directory, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'target', 'captures'].includes(entry.name)) continue;
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(absolute, files);
    if (entry.isFile()) files.push(absolute);
  }
}

async function convertToWebp(input, output) {
  await run(
    process.env.CWEBP_BIN ?? 'cwebp',
    ['-quiet', '-q', '88', '-m', '6', '-metadata', 'none', input, '-o', output],
    appRoot,
  );
}

async function waitForServer(server) {
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    if (server.exitCode !== null) {
      throw new Error(`Vite exited with code ${server.exitCode}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The server has not bound its port yet.
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function waitForOfficialStyle(page) {
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.auraoneOfficialStyle === 'loaded',
  );
  await page.waitForFunction(
    () =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--pl-official-font-ui')
        .trim().length > 0,
  );
  await page.evaluate(() => document.fonts.ready);
}

function readPngDimensions(bytes) {
  assert(bytes.toString('ascii', 1, 4) === 'PNG', 'Invalid PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function readWebpDimensions(bytes) {
  assert(bytes.toString('ascii', 0, 4) === 'RIFF', 'Invalid WebP RIFF');
  assert(bytes.toString('ascii', 8, 12) === 'WEBP', 'Invalid WebP signature');
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (chunk === 'VP8 ') {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    const b1 = bytes[21];
    const b2 = bytes[22];
    const b3 = bytes[23];
    const b4 = bytes[24];
    return {
      width: 1 + b1 + ((b2 & 0x3f) << 8),
      height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
    };
  }
  throw new Error(`Unsupported WebP chunk ${chunk}`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run(command, args, cwd) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}\n${stdout}${stderr}`));
    });
  });
}

function onceExit(child) {
  return new Promise((resolvePromise) => child.once('exit', resolvePromise));
}
