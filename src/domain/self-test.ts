import { strict as assert } from 'node:assert';
import { performance } from 'node:perf_hooks';
import { createCriterionVariantBranch } from './branching';
import { browserFolderArtifacts, projectFromBrowserFolder } from './browserFolder';
import { catchViewRows } from './catchView';
import { calculateCalibration, generateExports, scoreSamples, semanticDiff } from './engine';
import { configureProviderKey, keychainKeyForJudge, readBrowserProviderSecret, validateProviderSecret } from './keychain';
import { buildOllamaScoringPrompt, deriveScoreFromOllamaText, detectOllama } from './ollama';
import { buildProviderScoringPrompt, isRemoteJudge, parseProviderScore, scoreProviderCriterion } from './providerJudge';
import { classifyDeepLink } from './deepLink';
import { clearRecentProjects, readRecentProjects, rememberProject } from './projectOpen';
import { checkForPlatformUpdate, fallbackReliabilityStatus } from './reliability';
import { reorderCriteria, sampleProject } from './rubric';
import {
  calibrationScaleWalls,
  diffScaleWalls,
  goldCalibrationRows,
  isVendorProgramExport,
  previewScaleWalls,
} from './scaleWalls';
import { auditStudioActions, defaultShortcutRows, studioActionLabels } from './actions';
import { actionForShortcut, findShortcutConflicts, normalizeShortcut } from './shortcuts';
import { searchProject, validateProject } from './validation';

const issues = validateProject(sampleProject);
assert.ok(issues.some((issue) => issue.severity === 'warning'));
assert.ok(sampleProject.judges.some((judge) => judge.provider === 'ollama' && judge.model.includes('llama')));
const openAiJudge = sampleProject.judges.find((judge) => judge.provider === 'openai');
assert.ok(openAiJudge);
assert.ok(isRemoteJudge(openAiJudge));
assert.equal(keychainKeyForJudge(openAiJudge).scope, 'byo-api-keys');
assert.equal(validateProviderSecret('short')?.includes('provider key'), true);
assert.equal(validateProviderSecret('sk-test-value'), null);
const sessionMemory = new Map<string, string>();
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: {
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
assert.ok(results.length >= sampleProject.samples.length * sampleProject.criteria.length);
assert.ok(results.every((result) => result.reasoning.length > 0));
const catchRows = catchViewRows(sampleProject, results, sampleProject.criteria[0].id, 'score-delta');
assert.equal(catchRows.length, sampleProject.samples.length);
assert.ok(catchRows.every((row) => row.reasoning.includes('local-mock')));
assert.ok(catchViewRows(sampleProject, results, sampleProject.criteria[0].id, 'confidence', 'pass').every((row) => row.verdict === 'pass'));

const calibration = calculateCalibration(sampleProject, results);
assert.equal(calibration.length, sampleProject.criteria.length);
assert.ok(calibration.every((item) => Number.isFinite(item.kappa)));

const diff = semanticDiff(sampleProject);
assert.equal(diff.length, sampleProject.criteria.length);
const variant = createCriterionVariantBranch(sampleProject, diff);
assert.ok(variant);
assert.ok(variant.branchName.startsWith('try/'));
assert.ok(variant.proposedDescription.includes('Variant boundary'));

const exports = generateExports(sampleProject, issues, calibration);
assert.ok(exports['rubric.json'].includes('"schema"'));
assert.ok(exports['judge-card.md'].includes('Judge Card'));
assert.ok(exports['.github/workflows/rubric.yml'].includes('rubric validate'));
assert.ok(exports['lm-eval-harness.yaml'].includes('criterion_pass_rate'));
assert.ok(exports['inspect-task.py'].includes('Generated by Rubric Studio Open'));
assert.ok(exports['openai-evals.yaml'].includes('evals:'));
assert.ok(exports['promptfoo.yaml'].includes('providers:'));
assert.ok(exports['huggingface-dataset-card.md'].includes('license: mit'));
assert.ok(exports['surge-sow.txt'].includes('Scope: expert review'));
assert.ok(exports['scale-task-spec.json'].includes('criterion_review'));

const search = searchProject(sampleProject, {
  query: 'safety',
  regex: false,
  caseSensitive: false,
  wholeWord: false,
});
assert.ok(search.length > 0);
assert.equal(goldCalibrationRows(sampleProject), sampleProject.samples.length);
assert.deepEqual(calibrationScaleWalls(sampleProject), []);
assert.deepEqual(diffScaleWalls(5), []);
assert.equal(diffScaleWalls(6)[0].id, 'diff-sixth-commit');
assert.equal(isVendorProgramExport('surge-sow.txt'), true);
assert.equal(isVendorProgramExport('scale-task-spec.json'), true);
assert.equal(isVendorProgramExport('rubric.json'), false);
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
const scaleWallProject = {
  ...largeProject,
  samples: Array.from({ length: 1001 }, (_, index) => ({
    ...sampleProject.samples[index % sampleProject.samples.length],
    id: `scale-wall-${index}`,
  })),
  judges: sampleProject.judges.map((judge, index) => ({ ...judge, enabled: index < 3 })),
};
assert.deepEqual(
  previewScaleWalls(scaleWallProject).map((prompt) => prompt.id),
  ['preview-sample-batch', 'preview-third-judge'],
);
assert.equal(calibrationScaleWalls(scaleWallProject)[0].id, 'calibration-gold-set');
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
});
const diffMs = performance.now() - diffStart;
assert.ok(diffMs < 2000, `diff exceeded held-out overlay budget in local regression check: ${diffMs.toFixed(2)}ms`);

console.log('Rubric Studio Open domain self-test passed.');
