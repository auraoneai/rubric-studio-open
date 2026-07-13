import { strict as assert } from 'node:assert';
import { performance } from 'node:perf_hooks';
import { createCriterionVariantWorkspace } from './branching';
import { browserFolderArtifacts, projectFromBrowserFolder } from './browserFolder';
import { catchViewRows } from './catchView';
import { calculateCalibration, generateExports, scoreSamples, semanticDiff } from './engine';
import {
  configureProviderKey,
  keychainKeyForJudge,
  readBrowserProviderSecret,
  rubricIntakeInstallSigningKeypairKey,
  validateProviderSecret,
} from './keychain';
import { buildUnsignedEvidencePackage } from './packageArchive';
import { buildOllamaScoringPrompt, deriveScoreFromOllamaText, detectOllama } from './ollama';
import {
  createRubricPlatformTelemetryEvent,
  TelemetryEventLog,
  toAuraTelemetryEvents,
} from './platformTelemetry';
import { buildProviderScoringPrompt, isRemoteJudge, parseProviderScore, scoreProviderCriterion } from './providerJudge';
import { classifyDeepLink } from './deepLink';
import { clearRecentProjects, readRecentProjects, rememberProject } from './projectOpen';
import { checkForPlatformUpdate, fallbackReliabilityStatus } from './reliability';
import { loadRubricRelease, RUBRIC_RELEASES_URL } from './releaseManifest';
import { reorderCriteria, sampleProject } from './rubric';
import { parseGoldJsonl, parseJsonlSamples, parseScratchSamples } from './samples';
import { auditStudioActions, defaultShortcutRows, studioActionLabels } from './actions';
import { actionForShortcut, findShortcutConflicts, normalizeShortcut } from './shortcuts';
import { searchProject, validateProject } from './validation';

const issues = validateProject(sampleProject);
assert.ok(issues.some((issue) => issue.severity === 'warning'));
assert.ok(sampleProject.judges.some((judge) => judge.provider === 'ollama' && judge.model.includes('llama')));
const openAiJudge = sampleProject.judges.find((judge) => judge.provider === 'openai');
assert.ok(openAiJudge);
assert.ok(isRemoteJudge(openAiJudge));
const anthropicJudge = sampleProject.judges.find((judge) => judge.provider === 'anthropic');
assert.ok(anthropicJudge);
assert.ok(isRemoteJudge(anthropicJudge));
const googleJudge = sampleProject.judges.find((judge) => judge.provider === 'google');
assert.ok(googleJudge);
assert.ok(isRemoteJudge(googleJudge));
assert.equal(keychainKeyForJudge(openAiJudge).scope, 'byo-api-keys');
assert.deepEqual(rubricIntakeInstallSigningKeypairKey, {
  service: 'rubric-studio-open',
  scope: 'intake-install-signing-key',
  identifier: 'ed25519-install-keypair-v1',
});
assert.equal(validateProviderSecret('short')?.includes('provider key'), true);
assert.equal(validateProviderSecret('sk-test-value'), null);
const sessionMemory = new Map<string, string>();
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: {
    get length() {
      return sessionMemory.size;
    },
    key: (index: number) => [...sessionMemory.keys()][index] ?? null,
    setItem: (key: string, value: string) => sessionMemory.set(key, value),
    getItem: (key: string) => sessionMemory.get(key) ?? null,
    removeItem: (key: string) => sessionMemory.delete(key),
  },
});
const localMemory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    setItem: (key: string, value: string) => localMemory.set(key, value),
    getItem: (key: string) => localMemory.get(key) ?? null,
    removeItem: (key: string) => localMemory.delete(key),
  },
});
const browserKeyReceipt = await configureProviderKey(openAiJudge, 'sk-test-value', 'browser');
assert.equal(browserKeyReceipt.backend, 'browser-session-memory');
assert.equal(browserKeyReceipt.stores_user_content, false);
assert.equal(sessionMemory.get(`rso:key:${openAiJudge.provider}:${openAiJudge.id}`), 'configured');
assert.equal(readBrowserProviderSecret(openAiJudge), 'sk-test-value');
const telemetryLog = new TelemetryEventLog();
const localPreviewEntry = telemetryLog.record(
  createRubricPlatformTelemetryEvent('criterion.created', { surface: 'browser' }),
  true,
);
const wouldSendEntry = telemetryLog.record(
  createRubricPlatformTelemetryEvent('telemetry.opted_out', { surface: 'browser' }),
  false,
);
assert.equal(localPreviewEntry.status, 'local_preview');
assert.equal(wouldSendEntry.status, 'would_send');
assert.deepEqual(telemetryLog.list().map((entry) => entry.status), [
  'local_preview',
  'would_send',
]);
assert.equal(telemetryLog.exportJson().includes('"sent"'), false);
const auraTelemetryEvents = toAuraTelemetryEvents(telemetryLog.list());
assert.equal(auraTelemetryEvents[0].optedIn, true);
assert.equal(auraTelemetryEvents[0].destination, 'local');
assert.equal(auraTelemetryEvents[0].deliveryStatus, 'local_preview');
assert.equal(auraTelemetryEvents[1].optedIn, false);
assert.equal(auraTelemetryEvents[1].destination, 'local');
assert.equal(auraTelemetryEvents[1].deliveryStatus, 'would_send');
assert.equal(normalizeShortcut('cmd-shift-n'), 'Cmd/Ctrl-Shift-N');
const shortcutAudit = auditStudioActions(defaultShortcutRows());
assert.deepEqual(shortcutAudit.missingShortcutLabels, []);
assert.deepEqual(shortcutAudit.unknownShortcutLabels, []);
assert.deepEqual(shortcutAudit.duplicateLabels, []);
assert.equal(defaultShortcutRows().length, studioActionLabels().length);
assert.equal(findShortcutConflicts(defaultShortcutRows()).length, 0);
assert.equal(
  actionForShortcut(
    { key: 'n', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false },
    [['Cmd/Ctrl-Shift-N', 'New theme']],
  ),
  'New theme',
);
assert.equal(findShortcutConflicts([['Cmd/Ctrl-K', 'Palette'], ['cmd-k', 'Search']]).length, 1);
const parsedJsonlSamples = parseJsonlSamples(
  [
    JSON.stringify({
      id: 'jsonl-domain-1',
      prompt: 'Domain prompt',
      response: 'Domain response',
      metadata: { source: 'self-test' },
    }),
  ].join('\n'),
  sampleProject,
);
assert.equal(parsedJsonlSamples[0].id, 'jsonl-domain-1');
assert.throws(() => parseJsonlSamples('not json', sampleProject), /not valid JSON/);
assert.throws(() => parseJsonlSamples(JSON.stringify({ id: 'missing-response', prompt: 'Prompt' }), sampleProject), /id, prompt, and response/);
const goldImport = parseGoldJsonl(
  JSON.stringify({ sampleId: 'sample-001', scores: { 'safe-refusal': 0.25, specificity: 1 } }),
  sampleProject,
);
assert.equal(goldImport.importedRows, 1);
assert.equal(goldImport.labeledDecisions, 2);
assert.equal(goldImport.samples.find((sample) => sample.id === 'sample-001')?.goldScores['safe-refusal'], 0.25);
assert.throws(
  () => parseGoldJsonl(JSON.stringify({ sampleId: 'sample-001', scores: { missing: 1 } }), sampleProject),
  /unknown criterion missing/,
);
const parsedScratchSamples = parseScratchSamples('plain pasted response', sampleProject, 123);
assert.equal(parsedScratchSamples[0].id, 'scratch-123-1');
assert.equal(parsedScratchSamples[0].response, 'plain pasted response');
assert.deepEqual(parsedScratchSamples[0].goldScores, {});
const ollamaPrompt = buildOllamaScoringPrompt(sampleProject.criteria[0], sampleProject.samples[0]);
assert.ok(ollamaPrompt.includes('Rubric Studio Open local judge'));
assert.ok(ollamaPrompt.includes(sampleProject.criteria[0].label));
const ollamaStatus = await detectOllama(async () => new Response(
  JSON.stringify({ models: [{ name: 'llama3.1:8b' }] }),
  { headers: { 'Content-Type': 'application/json' } },
));
assert.equal(ollamaStatus.detected, true);
assert.equal(ollamaStatus.models[0].name, 'llama3.1:8b');
const providerPrompt = buildProviderScoringPrompt(sampleProject.criteria[0], sampleProject.samples[0]);
assert.ok(providerPrompt.includes('Return only JSON'));
assert.ok(providerPrompt.includes(sampleProject.samples[0].response));
const providerScore = parseProviderScore(
  'gpt-5-mini',
  sampleProject.criteria[0].id,
  sampleProject.samples[0].id,
  '{"verdict":"partial","confidence":0.83,"reasoning":"Needs one more concrete step."}',
);
assert.equal(providerScore.verdict, 'partial');
assert.equal(providerScore.confidence, 0.83);
const directOpenAiScore = await scoreProviderCriterion({
  judge: openAiJudge,
  criterion: sampleProject.criteria[0],
  sample: sampleProject.samples[0],
  apiKey: 'sk-test-value',
  fetcher: async (input, init) => {
    assert.equal(String(input), 'https://api.openai.com/v1/responses');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer sk-test-value');
    assert.ok(String(init?.body).includes(sampleProject.criteria[0].label));
    return new Response(
      JSON.stringify({ output_text: '{"verdict":"pass","confidence":0.91,"reasoning":"Meets the criterion."}' }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  },
});
assert.equal(directOpenAiScore.verdict, 'pass');
assert.equal(directOpenAiScore.judgeId, openAiJudge.id);
const directAnthropicScore = await scoreProviderCriterion({
  judge: anthropicJudge,
  criterion: sampleProject.criteria[0],
  sample: sampleProject.samples[0],
  apiKey: 'sk-ant-test-value',
  fetcher: async (input, init) => {
    assert.equal(String(input), 'https://api.anthropic.com/v1/messages');
    assert.equal((init?.headers as Record<string, string>)['x-api-key'], 'sk-ant-test-value');
    assert.equal((init?.headers as Record<string, string>)['anthropic-version'], '2023-06-01');
    const body = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ content: string }> };
    assert.equal(body.model, anthropicJudge.model);
    assert.ok(body.messages[0].content.includes(sampleProject.criteria[0].label));
    return new Response(
      JSON.stringify({ content: [{ text: '{"verdict":"fail","confidence":0.77,"reasoning":"Missing the refusal boundary."}' }] }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  },
});
assert.equal(directAnthropicScore.verdict, 'fail');
assert.equal(directAnthropicScore.confidence, 0.77);
assert.equal(directAnthropicScore.judgeId, anthropicJudge.id);
const directGoogleScore = await scoreProviderCriterion({
  judge: googleJudge,
  criterion: sampleProject.criteria[0],
  sample: sampleProject.samples[0],
  apiKey: 'gemini-test-value',
  fetcher: async (input, init) => {
    assert.equal(
      String(input),
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(googleJudge.model)}:generateContent`,
    );
    assert.equal((init?.headers as Record<string, string>)['x-goog-api-key'], 'gemini-test-value');
    const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
    assert.ok(body.contents[0].parts[0].text.includes(sampleProject.samples[0].response));
    return new Response(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: '{"verdict":"partial","confidence":0.68,"reasoning":"Covers safety but lacks specificity."}' }] } },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  },
});
assert.equal(directGoogleScore.verdict, 'partial');
assert.equal(directGoogleScore.confidence, 0.68);
assert.equal(directGoogleScore.judgeId, googleJudge.id);
await assert.rejects(
  () =>
    scoreProviderCriterion({
      judge: openAiJudge,
      criterion: sampleProject.criteria[0],
      sample: sampleProject.samples[0],
      apiKey: 'sk-expired-value',
      fetcher: async () => new Response('{}', { status: 401 }),
    }),
  /OpenAI rejected this BYO key \(401\)\. Rotate the key in Settings/,
);
await assert.rejects(
  () =>
    scoreProviderCriterion({
      judge: googleJudge,
      criterion: sampleProject.criteria[0],
      sample: sampleProject.samples[0],
      apiKey: 'gemini-test-value',
      fetcher: async () => {
        throw new TypeError('Failed to fetch');
      },
    }),
  /Google network request failed\. Check browser network or CORS access/,
);
const reliabilityStatus = fallbackReliabilityStatus(false, 'beta');
assert.equal(reliabilityStatus.crash.default_off, true);
assert.equal(reliabilityStatus.crash.sends_user_authored_content, false);
assert.equal(reliabilityStatus.updater.channel, 'beta');
assert.equal(reliabilityStatus.updater.signature_required, true);
assert.ok(reliabilityStatus.updater.endpoints.every((endpoint) => endpoint.startsWith('https://updates')));
const browserUpdateCheck = await checkForPlatformUpdate('browser');
assert.equal(browserUpdateCheck.status, 'unavailable');
assert.ok(Date.parse(browserUpdateCheck.checked_at) > 0);
assert.equal(browserUpdateCheck.reason.includes('Browser edition'), true);
const currentDesktopUpdateCheck = await checkForPlatformUpdate('desktop', async () => null);
assert.equal(currentDesktopUpdateCheck.status, 'current');
const availableDesktopUpdateCheck = await checkForPlatformUpdate('desktop', async () => ({
  version: '0.1.1',
  body: 'Signed update manifest fixture.',
  date: '2026-05-13',
}));
assert.equal(availableDesktopUpdateCheck.status, 'available');
assert.equal(availableDesktopUpdateCheck.version, '0.1.1');
assert.equal(availableDesktopUpdateCheck.body, 'Signed update manifest fixture.');
const failedDesktopUpdateCheck = await checkForPlatformUpdate('desktop', async () => {
  throw new Error('signed manifest endpoint unavailable');
});
assert.equal(failedDesktopUpdateCheck.status, 'error');
assert.equal(failedDesktopUpdateCheck.reason, 'signed manifest endpoint unavailable');
const verifiedRelease = await loadRubricRelease(
  async () => new Response(JSON.stringify({
    product: 'rubric-studio-open',
    version: '0.2.0',
    publishedAt: '2026-07-12T00:00:00.000Z',
    releaseUrl: 'https://github.com/auraoneai/rubric-studio-open/releases/tag/v0.2.0',
    artifacts: [{
      platform: 'macos',
      architecture: 'aarch64',
      format: 'dmg',
      url: [
        'https://github.com/auraoneai/rubric-studio-open',
        'releases',
        'download',
        'v0.2.0',
        'rubric.dmg',
      ].join('/'),
      sha256: 'verified-fixture',
      verified: true,
    }],
  }), { headers: { 'Content-Type': 'application/json' } }),
  'https://rubric-studio.auraone.ai/release-manifest.json',
);
assert.equal(verifiedRelease.status, 'available');
if (verifiedRelease.status === 'available') {
  assert.equal(verifiedRelease.manifest.version, '0.2.0');
  assert.equal(verifiedRelease.artifact.format, 'dmg');
}
const rejectedRelease = await loadRubricRelease(
  async () => new Response(JSON.stringify({
    product: 'rubric-studio-open',
    version: '0.2.0',
    publishedAt: '2026-07-12T00:00:00.000Z',
    releaseUrl: 'http://insecure.example/release',
    artifacts: [],
  }), { headers: { 'Content-Type': 'application/json' } }),
);
assert.equal(rejectedRelease.status, 'unavailable');
if (rejectedRelease.status === 'unavailable') {
  assert.equal(rejectedRelease.releaseUrl, RUBRIC_RELEASES_URL);
}
assert.deepEqual(
  classifyDeepLink({
    flagship: 'rubric-studio-open',
    action: 'open-project',
    params: { path: '/tmp/rubric-project' },
  }),
  {
    kind: 'open-project',
    flagship: 'rubric-studio-open',
    path: '/tmp/rubric-project',
  },
);
assert.equal(
  classifyDeepLink({
    flagship: 'agent-studio-open',
    action: 'open-project',
    params: { path: '/tmp/agent-project' },
  }).kind,
  'ignored-flagship',
);
assert.equal(
  classifyDeepLink({
    flagship: 'future-studio',
    action: 'open',
    params: {},
    installUrl: 'https://auraone.ai/open/future-studio',
  }).kind,
  'install',
);
clearRecentProjects();
rememberProject('First rubric', '/tmp/rubrics/first', new Date('2026-05-13T12:00:00.000Z'));
rememberProject('Second rubric', '/tmp/rubrics/second', new Date('2026-05-13T12:05:00.000Z'));
rememberProject('First rubric renamed', '/tmp/rubrics/first', new Date('2026-05-13T12:10:00.000Z'));
assert.deepEqual(
  readRecentProjects().map((project) => [project.name, project.path]),
  [
    ['First rubric renamed', '/tmp/rubrics/first'],
    ['Second rubric', '/tmp/rubrics/second'],
  ],
);
clearRecentProjects();
assert.equal(
  deriveScoreFromOllamaText('safe-refusal', 'sample-001', '{"verdict":"fail","confidence":0.91}').verdict,
  'fail',
);

const reorderedCriteria = reorderCriteria(sampleProject.criteria, 'cites-uncertainty', 'actionable-alternative');
assert.deepEqual(
  reorderedCriteria.map((criterion) => criterion.id),
  ['safe-refusal', 'cites-uncertainty', 'actionable-alternative', 'specificity'],
);
assert.equal(
  reorderedCriteria.find((criterion) => criterion.id === 'cites-uncertainty')?.themeId,
  'helpfulness',
);
assert.equal(reorderCriteria(sampleProject.criteria, 'missing', 'specificity'), sampleProject.criteria);

const results = scoreSamples(sampleProject, sampleProject.samples, sampleProject.judges);
assert.equal(results.length, sampleProject.samples.length * sampleProject.criteria.length);
assert.ok(results.every((result) => result.reasoning.length > 0));
const catchRows = catchViewRows(sampleProject, results, sampleProject.criteria[0].id, 'score-delta');
assert.equal(catchRows.length, sampleProject.samples.length);
assert.ok(catchRows.every((row) => row.reasoning.includes('local-mock')));
assert.ok(catchViewRows(sampleProject, results, sampleProject.criteria[0].id, 'confidence', 'pass').every((row) => row.verdict === 'pass'));

const calibration = calculateCalibration(sampleProject, results);
assert.equal(calibration.length, sampleProject.criteria.length);
assert.ok(calibration.every((item) => Number.isFinite(item.kappa)));
assert.ok(calibration.every((item) => Number.isFinite(item.weightedKappa)));
assert.ok(calibration.every((item) => Number.isFinite(item.krippendorffAlpha)));
assert.ok(calibration.every((item) => Number.isFinite(item.fleissKappa)));
assert.ok(calibration.every((item) => item.ci95[0] <= item.ci95[1]));
const renamedMockProject = {
  ...sampleProject,
  judges: sampleProject.judges.map((judge) =>
    judge.provider === 'mock' ? { ...judge, id: 'renamed-local-fixture' } : judge,
  ),
};
const renamedMockResults = scoreSamples(
  renamedMockProject,
  renamedMockProject.samples,
  renamedMockProject.judges,
);
assert.ok(calculateCalibration(renamedMockProject, renamedMockResults).every((item) => item.coverage > 0));

const baselineProject = JSON.parse(JSON.stringify(sampleProject));
const changedProject = {
  ...sampleProject,
  criteria: sampleProject.criteria.map((criterion, index) =>
    index === 0
      ? { ...criterion, description: `${criterion.description} Require an explicit safe alternative.` }
      : criterion,
  ),
};
const diff = semanticDiff(changedProject, baselineProject);
assert.equal(diff.length, 1);
assert.equal(diff[0].changedFields.includes('description'), true);
const variant = createCriterionVariantWorkspace(changedProject, diff);
assert.ok(variant);
assert.ok(variant.workspaceName.includes('local variant'));
assert.ok(variant.proposedDescription.includes('Local variant boundary'));

const exports = generateExports(sampleProject, issues, calibration);
assert.ok(exports['rubric.json'].includes('"schema"'));
assert.ok(exports['judge-card.md'].includes('Judge Card'));
assert.ok(exports['.github/workflows/rubric.yml'].includes('rubric validate'));
assert.ok(exports['lm-eval-harness.yaml'].includes('criterion_pass_rate'));
assert.ok(exports['inspect-task.py'].includes('Generated by Rubric Studio Open'));
assert.ok(exports['openai-evals.yaml'].includes('evals:'));
assert.ok(exports['promptfoo.yaml'].includes('providers:'));
assert.ok(exports['huggingface-dataset-card.md'].includes('license: mit'));
assert.ok(exports['local-review-plan.txt'].includes('no reviewer assignment'));
assert.ok(exports['local-review-task-spec.json'].includes('"execution_status": "not-started"'));
const evidencePackage = await buildUnsignedEvidencePackage(sampleProject, {
  'rubric.json': exports['rubric.json'],
  'judge-card.md': exports['judge-card.md'],
}, {
  reviewers: 3,
  turnaround: '5 business days',
});
assert.equal(evidencePackage.manifest.signed, false);
assert.equal(evidencePackage.manifest.signature, null);
assert.equal(evidencePackage.filename, 'helpful-response-evaluation.rubric-evidence.zip');
const evidenceBytes = new Uint8Array(await evidencePackage.blob.arrayBuffer());
assert.equal(new DataView(evidenceBytes.buffer).getUint32(0, true), 0x04034b50);

const search = searchProject(sampleProject, {
  query: 'safety',
  regex: false,
  caseSensitive: false,
  wholeWord: false,
});
assert.ok(search.length > 0);
const browserFolder = browserFolderArtifacts(sampleProject, new Date('2026-05-13T00:00:00.000Z'));
assert.ok(browserFolder.some((artifact) => artifact.path === 'project-bundle.json'));
assert.ok(browserFolder.some((artifact) => artifact.path === 'rubric.json'));
assert.equal(browserFolder.filter((artifact) => artifact.path.startsWith('criteria/')).length, sampleProject.criteria.length);
const browserFolderFiles = Object.fromEntries(browserFolder.map((artifact) => [artifact.path, artifact.content]));
assert.equal(projectFromBrowserFolder(browserFolderFiles)?.id, sampleProject.id);
assert.equal(projectFromBrowserFolder({ 'rubric.json': browserFolderFiles['rubric.json'] })?.name, sampleProject.name);
assert.equal(projectFromBrowserFolder({ 'project-bundle.json': '{' }), null);

const largeProject = {
  ...sampleProject,
  samples: Array.from({ length: 1000 }, (_, index) => ({
    ...sampleProject.samples[index % sampleProject.samples.length],
    id: `perf-${index}`,
  })),
};
const validateStart = performance.now();
validateProject(largeProject);
const validateMs = performance.now() - validateStart;
assert.ok(validateMs < 5, `validator exceeded p50 budget in local regression check: ${validateMs.toFixed(2)}ms`);

const diffStart = performance.now();
semanticDiff({
  ...sampleProject,
  criteria: Array.from({ length: 1000 }, (_, index) => ({
    ...sampleProject.criteria[index % sampleProject.criteria.length],
    id: `${sampleProject.criteria[index % sampleProject.criteria.length].id}-${index}`,
  })),
}, sampleProject);
const diffMs = performance.now() - diffStart;
assert.ok(diffMs < 2000, `diff exceeded held-out overlay budget in local regression check: ${diffMs.toFixed(2)}ms`);

console.log('Rubric Studio Open domain self-test passed.');
