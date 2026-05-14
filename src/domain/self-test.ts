import { strict as assert } from 'node:assert';
import { performance } from 'node:perf_hooks';
import {
  buildCriterionRewriteSuggestions,
  calculateAdvancedCalibration,
  stageCriterionRewrite,
} from './advancedCalibration';
import { calculateVariantAbTest } from './advancedDiff';
import { createCriterionVariantBranch } from './branching';
import { browserFolderArtifacts, projectFromBrowserFolder } from './browserFolder';
import { catchViewRows } from './catchView';
import {
  buildReadOnlyCrdtSnapshot,
  parseReadOnlyCrdtSnapshot,
  summarizeReadOnlyCrdtSnapshot,
} from './collaboration';
import {
  buildSemanticDiffMarkdown,
  buildStandardTextDiff,
  calculateCalibration,
  generateExports,
  scoreSamples,
  semanticDiff,
} from './engine';
import { runLocalGitOperation } from './git';
import { htmlLangForLocale, normalizeLocale, studioMessages, supportedLocales, type StudioMessages } from './i18n';
import { configureProviderKey, keychainKeyForJudge, readBrowserProviderSecret, validateProviderSecret } from './keychain';
import { buildOllamaScoringPrompt, deriveScoreFromOllamaText, detectOllama } from './ollama';
import {
  enginePluginCatalog,
  enginePluginCompatibility,
  reviewEnginePluginManifest,
  safeExamplePluginManifest,
  summarizeEnginePluginCatalog,
  validateEnginePluginManifest,
} from './pluginMarketplace';
import { runNativeScoreRun } from './nativeScoring';
import { buildProviderScoringPrompt, isRemoteJudge, parseProviderScore, scoreProviderCriterion } from './providerJudge';
import { classifyDeepLink } from './deepLink';
import { clearRecentProjects, readRecentProjects, rememberProject } from './projectOpen';
import { buildQuickOpenItems, filterQuickOpenItems } from './quickOpen';
import { checkForPlatformUpdate, fallbackReliabilityStatus } from './reliability';
import { reorderCriteria, sampleProject } from './rubric';
import {
  calibrationScaleWalls,
  diffScaleWalls,
  goldCalibrationRows,
  isVendorProgramExport,
  previewScaleWalls,
} from './scaleWalls';
import { generateSyntheticTestSample, parseGoldSetJsonl, parseJsonlSamples, parseScratchSamples } from './samples';
import { sidecarHealthSummary, sidecarWorkerReadiness } from './sidecarHealth';
import { auditStudioActions, defaultShortcutRows, studioActionLabels } from './actions';
import { actionForShortcut, findShortcutConflicts, normalizeShortcut } from './shortcuts';
import { searchProject, validateProject } from './validation';
import { buildVersionComparisonRun, normalizeVersionRef } from './versioning';

const issues = validateProject(sampleProject);
assert.equal(sampleProject.criteria.length, 12);
assert.equal(issues.some((issue) => issue.severity === 'error'), false);
const quickFixProject = {
  ...sampleProject,
  criteria: sampleProject.criteria.map((criterion, index) =>
    index === 0
      ? {
          ...criterion,
          id: 'Not A Slug',
          label: '',
          description: '',
          weight: 1.7,
          positiveExamples: [],
          negativeExamples: [],
          references: ['not-a-reference'],
          siblingLinks: ['missing-criterion'],
        }
      : criterion,
  ),
};
const quickFixes = validateProject(quickFixProject).map((issue) => issue.quickFix).filter(Boolean);
assert.ok(quickFixes.includes('Use draft label'));
assert.ok(quickFixes.includes('Derive slug from label'));
assert.ok(quickFixes.includes('Add description starter'));
assert.ok(quickFixes.includes('Clamp weight'));
assert.ok(quickFixes.includes('Normalize theme weights'));
assert.ok(quickFixes.includes('Remove invalid references'));
assert.ok(quickFixes.includes('Remove missing sibling links'));
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
assert.ok(studioActionLabels().includes('Git fetch'));
assert.ok(studioActionLabels().includes('Git fast-forward merge'));
assert.ok(studioActionLabels().includes('Run diff overlay'));
assert.ok(studioActionLabels().includes('Load JSONL samples'));
assert.ok(studioActionLabels().includes('Paste scratch sample'));
assert.ok(studioActionLabels().includes('Generate test sample'));
assert.equal(
  actionForShortcut(
    { key: 'n', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false },
    [['Cmd/Ctrl-Shift-N', 'New theme']],
  ),
  'New theme',
);
assert.equal(
  actionForShortcut(
    { key: 'z', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false },
    defaultShortcutRows(),
  ),
  'Undo',
);
assert.equal(
  actionForShortcut(
    { key: 'z', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false },
    defaultShortcutRows(),
  ),
  'Redo',
);
assert.equal(findShortcutConflicts([['Cmd/Ctrl-K', 'Palette'], ['cmd-k', 'Search']]).length, 1);
assert.deepEqual(supportedLocales.map((locale) => locale.code), ['en', 'es', 'zh', 'ja']);
assert.equal(normalizeLocale('ja'), 'ja');
assert.equal(normalizeLocale('unsupported'), 'en');
assert.equal(htmlLangForLocale('zh'), 'zh-Hans');
const englishMessageShape = messageShape(studioMessages.en);
for (const locale of supportedLocales) {
  assert.deepEqual(messageShape(studioMessages[locale.code]), englishMessageShape);
  assert.ok(studioMessages[locale.code].tabs.preview);
  assert.ok(studioMessages[locale.code].settings.interfaceLanguage);
}
assert.equal(enginePluginCatalog.length, 5);
assert.ok(enginePluginCatalog.some((plugin) => plugin.id === 'inspect-export-adapter' && plugin.trustLevel === 'verified-community'));
assert.ok(enginePluginCatalog.every((plugin) => validateEnginePluginManifest(plugin).length === 0));
const desktopPluginSummary = summarizeEnginePluginCatalog(enginePluginCatalog, 'desktop');
assert.equal(desktopPluginSummary.total, enginePluginCatalog.length);
assert.equal(desktopPluginSummary.installed, 3);
assert.equal(desktopPluginSummary.available, 1);
assert.equal(desktopPluginSummary.blocked, 1);
assert.equal(desktopPluginSummary.sendsUserContent, 1);
const browserPluginSummary = summarizeEnginePluginCatalog(enginePluginCatalog, 'browser');
assert.equal(browserPluginSummary.installed, 1);
assert.equal(browserPluginSummary.available, 1);
assert.equal(browserPluginSummary.blocked, 3);
assert.equal(enginePluginCompatibility(enginePluginCatalog[1], 'browser').message, 'Desktop-only sidecar plugins are disabled in Browser Edition.');
assert.match(enginePluginCompatibility(enginePluginCatalog[4], 'desktop').message, /Unsigned plugins/);
assert.ok(validateEnginePluginManifest({
  ...enginePluginCatalog[3],
  id: 'Bad Plugin',
  manifestSha256: 'not-a-sha',
  sandbox: { ...enginePluginCatalog[3].sandbox, unsignedCode: true },
}).length >= 2);
const safePluginReview = reviewEnginePluginManifest(safeExamplePluginManifest(), 'browser');
assert.equal(safePluginReview.accepted, true);
assert.equal(safePluginReview.plugin?.id, 'community-safe-adapter');
assert.equal(safePluginReview.installableWithoutNetwork, true);
assert.equal(safePluginReview.executesRemoteCode, false);
assert.equal(safePluginReview.sendsUserContent, false);
const remotePluginReview = reviewEnginePluginManifest(JSON.stringify({
  ...JSON.parse(safeExamplePluginManifest()),
  id: 'unsafe-community-runner',
  manifestSha256: '3f1b9b4f68e0d02fcb0606a4bfa9084d5a57bb32e295f710af36f4a59a11a4d8',
  sandbox: {
    runtime: 'node-sidecar',
    requiresDesktop: true,
    networkAccess: 'declared-endpoints',
    fileSystem: 'project-read-write',
    sendsUserContent: true,
    unsignedCode: true,
  },
}), 'desktop');
assert.equal(remotePluginReview.accepted, false);
assert.equal(remotePluginReview.executesRemoteCode, true);
assert.equal(remotePluginReview.sendsUserContent, true);
assert.ok(remotePluginReview.errors.some((error) => error.includes('Community plugins')));
assert.equal(reviewEnginePluginManifest('{', 'browser').accepted, false);
const crdtSnapshot = buildReadOnlyCrdtSnapshot(sampleProject, 'reviewer one', '2026-05-13T00:00:00.000Z');
assert.equal(crdtSnapshot.mode, 'read-only');
assert.equal(crdtSnapshot.actorId, 'reviewer-one');
assert.equal(crdtSnapshot.criteria.length, sampleProject.criteria.length);
assert.ok(crdtSnapshot.criteria.every((record) => record.readOnly));
const parsedCrdtSnapshot = parseReadOnlyCrdtSnapshot(JSON.stringify(crdtSnapshot));
assert.ok(parsedCrdtSnapshot);
const crdtSummary = summarizeReadOnlyCrdtSnapshot(sampleProject, parsedCrdtSnapshot);
assert.equal(crdtSummary.valid, true);
assert.equal(crdtSummary.readOnly, true);
assert.deepEqual(crdtSummary.changedCriteria, []);
assert.equal(parseReadOnlyCrdtSnapshot('{'), null);
const staleCrdtSummary = summarizeReadOnlyCrdtSnapshot(
  {
    ...sampleProject,
    criteria: sampleProject.criteria.map((criterion, index) =>
      index === 0 ? { ...criterion, description: `${criterion.description} changed locally` } : criterion,
    ),
  },
  parsedCrdtSnapshot,
);
assert.equal(staleCrdtSummary.changedCriteria.length, 1);
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
const goldSetImport = parseGoldSetJsonl(
  [
    JSON.stringify({
      id: 'gold-complete',
      prompt: 'Gold prompt',
      response: 'Gold response',
      humanScores: Object.fromEntries(sampleProject.criteria.map((criterion) => [criterion.id, 1])),
    }),
    JSON.stringify({
      id: 'gold-partial',
      prompt: 'Partial gold prompt',
      response: 'Partial gold response',
      scores: { [sampleProject.criteria[0].id]: 0 },
    }),
  ].join('\n'),
  sampleProject,
);
assert.equal(goldSetImport.samples.length, 2);
assert.equal(goldSetImport.summary.totalRows, 2);
assert.equal(goldSetImport.summary.completeRows, 1);
assert.equal(goldSetImport.summary.missingScoreRows[0].sampleId, 'gold-partial');
assert.equal(goldSetImport.summary.coverageByCriterion[0].coverage, 1);
assert.ok(goldSetImport.summary.warnings.some((warning) => warning.includes('gold-partial')));
const parsedScratchSamples = parseScratchSamples('plain pasted response', sampleProject, 123);
assert.equal(parsedScratchSamples[0].id, 'scratch-123-1');
assert.equal(parsedScratchSamples[0].response, 'plain pasted response');
const generatedTestSample = generateSyntheticTestSample(sampleProject, 'browser', 456);
assert.equal(generatedTestSample.id, 'synthetic-456');
assert.equal(generatedTestSample.metadata.source, 'synthetic-meta-prompt');
assert.equal(generatedTestSample.metadata.synthetic, true);
assert.ok(generatedTestSample.metadata.meta_prompt);
assert.equal(Object.keys(generatedTestSample.goldScores).length, sampleProject.criteria.length);
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
  body: '[mandatory] Signed update manifest fixture.',
  date: '2026-05-13',
  signedBy: 'Fixture release key',
  signingDocsUrl: 'https://example.test/signing',
}));
assert.equal(availableDesktopUpdateCheck.status, 'available');
assert.equal(availableDesktopUpdateCheck.version, '0.1.1');
assert.equal(availableDesktopUpdateCheck.body, '[mandatory] Signed update manifest fixture.');
assert.equal(availableDesktopUpdateCheck.mandatory, true);
assert.equal(availableDesktopUpdateCheck.signed_by, 'Fixture release key');
assert.equal(availableDesktopUpdateCheck.signing_docs_url, 'https://example.test/signing');
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
const reorderedIds = reorderedCriteria.map((criterion) => criterion.id);
assert.equal(sampleProject.criteria.length, 12);
assert.ok(reorderedIds.indexOf('cites-uncertainty') < reorderedIds.indexOf('actionable-alternative'));
assert.ok(reorderedIds.includes('reproducible-checks'));
assert.equal(
  reorderedCriteria.find((criterion) => criterion.id === 'cites-uncertainty')?.themeId,
  'helpfulness',
);
assert.equal(reorderCriteria(sampleProject.criteria, 'missing', 'specificity'), sampleProject.criteria);

const results = scoreSamples(sampleProject, sampleProject.samples, sampleProject.judges);
assert.ok(results.length >= sampleProject.samples.length * sampleProject.criteria.length);
assert.ok(results.every((result) => result.reasoning.length > 0));
const nativeScoreReceipt = await runNativeScoreRun('desktop', sampleProject, sampleProject.samples);
assert.ok(nativeScoreReceipt);
assert.equal(nativeScoreReceipt.providerRequestOwner, 'tauri-rust-core');
assert.ok(nativeScoreReceipt.manifestPath.startsWith('.rubric/score-runs/'));
assert.equal(nativeScoreReceipt.scoreUpdateEvents, nativeScoreReceipt.results.length);
assert.equal(nativeScoreReceipt.manifestJson.includes('"sends_api_keys_to_auraone":false'), true);
const catchRows = catchViewRows(sampleProject, results, sampleProject.criteria[0].id, 'score-delta');
assert.equal(catchRows.length, sampleProject.samples.length);
assert.ok(catchRows.every((row) => row.reasoning.includes('local-mock')));
assert.ok(catchViewRows(sampleProject, results, sampleProject.criteria[0].id, 'confidence', 'pass').every((row) => row.verdict === 'pass'));

const calibration = calculateCalibration(sampleProject, results);
assert.equal(calibration.length, sampleProject.criteria.length);
assert.ok(calibration.every((item) => Number.isFinite(item.kappa)));
const advancedCalibration = calculateAdvancedCalibration(sampleProject, calibration);
assert.equal(advancedCalibration.themeSummaries.length, sampleProject.themes.length);
assert.ok(Number.isFinite(advancedCalibration.overallHierarchicalAlpha));
assert.ok(advancedCalibration.latentClasses.some((item) => item.id === 'stable-consensus'));
assert.equal(
  advancedCalibration.latentClasses.reduce((sum, item) => sum + item.criterionIds.length, 0),
  calibration.length,
);
assert.ok(advancedCalibration.themeSummaries.every((item) => item.ci95[0] <= item.hierarchicalAlpha && item.ci95[1] >= item.hierarchicalAlpha));
const weakestCalibration = calibration.slice().sort((a, b) => a.kappa - b.kappa)[0];
const rewriteSuggestions = buildCriterionRewriteSuggestions(sampleProject, weakestCalibration);
assert.equal(rewriteSuggestions.length, 3);
assert.equal(rewriteSuggestions[0].criterionId, weakestCalibration.criterionId);
assert.ok(rewriteSuggestions[0].proposedDescription.includes('observable evidence'));
const rewrittenProject = stageCriterionRewrite(sampleProject, rewriteSuggestions[0]);
const rewrittenCriterion = rewrittenProject.criteria.find((criterion) => criterion.id === weakestCalibration.criterionId);
assert.ok(rewrittenCriterion);
assert.equal(rewrittenCriterion.description, rewriteSuggestions[0].proposedDescription);
assert.equal(rewrittenCriterion.boundaries, rewriteSuggestions[0].proposedBoundaries);
assert.ok(rewrittenCriterion.positiveExamples.includes(rewriteSuggestions[0].positiveExample));
assert.ok(rewrittenCriterion.negativeExamples.includes(rewriteSuggestions[0].negativeExample));
assert.ok(rewrittenCriterion.comments.some((comment) => comment.includes('Rewrite staged')));
assert.notEqual(rewrittenProject, sampleProject);
assert.equal(stageCriterionRewrite(sampleProject, { ...rewriteSuggestions[0], criterionId: 'missing' }), sampleProject);

const diff = semanticDiff(sampleProject);
assert.equal(diff.length, sampleProject.criteria.length);
const diffReport = buildSemanticDiffMarkdown(sampleProject, diff);
assert.ok(diffReport.includes(`# Semantic Diff Report: ${sampleProject.name}`));
assert.ok(diffReport.includes('| Criterion | Severity | Summary | Pass to fail | Fail to pass |'));
assert.ok(diffReport.includes('Estimated held-out sample flips:'));
const editedProject = {
  ...sampleProject,
  criteria: sampleProject.criteria.map((criterion, index) =>
    index === 0 ? { ...criterion, description: `${criterion.description} Edited boundary.` } : criterion,
  ),
};
const textDiff = buildStandardTextDiff(sampleProject, editedProject);
assert.equal(textDiff.length, 1);
assert.equal(textDiff[0].changeType, 'modified');
assert.ok(textDiff[0].before.includes('description = """'));
assert.ok(textDiff[0].after.includes('Edited boundary.'));
const variant = createCriterionVariantBranch(sampleProject, diff);
assert.ok(variant);
assert.ok(variant.branchName.startsWith('try/'));
assert.ok(variant.proposedDescription.includes('Variant boundary'));
const variantAbTest = calculateVariantAbTest(sampleProject, variant);
assert.ok(variantAbTest);
assert.equal(variantAbTest.criterionId, variant.criterionId);
assert.equal(variantAbTest.sampleCount, sampleProject.samples.length);
assert.ok(variantAbTest.judgeCount > 0);
assert.equal(variantAbTest.judgeImpacts.length, variantAbTest.judgeCount);
assert.ok(Number.isFinite(variantAbTest.meanDelta));
assert.equal(
  variantAbTest.baselineWins + variantAbTest.variantWins + variantAbTest.ties,
  variantAbTest.judgeCount,
);
assert.equal(normalizeVersionRef('release candidate', 'main'), 'release-candidate');
assert.equal(normalizeVersionRef('   ', 'main'), 'main');
const versionOverlay = buildVersionComparisonRun({
  project: sampleProject,
  diff,
  baseRef: 'main',
  targetRef: 'working tree',
  generatedAt: '2026-05-13T00:00:00.000Z',
});
assert.equal(versionOverlay.baseRef, 'main');
assert.equal(versionOverlay.targetRef, 'working-tree');
assert.equal(versionOverlay.criteriaChanged, diff.length);
assert.equal(versionOverlay.sampleCount, sampleProject.samples.length);
assert.equal(versionOverlay.judgeCount, sampleProject.judges.filter((judge) => judge.enabled).length);
assert.ok(versionOverlay.summary.includes('main -> working-tree'));

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
for (const exportAction of [
  'Export: Rubric file',
  'Export: Judge card',
  'Export: eval-run-manifest',
  'Export: Conformance badge',
  'Export: lm-eval-harness',
  'Export: Inspect',
  'Export: OpenAI Evals',
  'Export: Promptfoo',
  'Export: Hugging Face Hub',
  'Export: Surge SOW',
  'Export: Scale task spec',
  'Export: AuraOne intake package',
  'Generate GitHub Actions helper',
  'Generate GitLab CI helper',
  'Generate CircleCI helper',
  'Generate Make helper',
]) {
  assert.ok(studioActionLabels().includes(exportAction), `${exportAction} should be command-palette addressable`);
}
const quickOpenItems = buildQuickOpenItems({
  project: sampleProject,
  exports,
  recentProjects: [{ name: 'Prior rubric', path: '/tmp/prior-rubric', lastOpenedAt: '2026-05-13T00:00:00.000Z' }],
  surface: 'desktop',
  openedProjectPath: '/tmp/current-rubric',
});
assert.ok(quickOpenItems.some((item) => item.path === 'criteria/safety/safe-refusal.toml'));
assert.ok(quickOpenItems.some((item) => item.path === 'samples/sample-001.jsonl'));
assert.ok(quickOpenItems.some((item) => item.path === 'judges/local-mock.toml'));
assert.ok(quickOpenItems.some((item) => item.path === 'exports/lm-eval-harness.yaml'));
assert.equal(filterQuickOpenItems(quickOpenItems, 'safe refusal')[0].targetId, 'safe-refusal');
assert.equal(filterQuickOpenItems(quickOpenItems, 'prior rubric')[0].kind, 'recent-project');

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
const gitStatus = runLocalGitOperation('status', {
  project: sampleProject,
  changedFiles: 3,
  targetBranch: 'review/rubric update',
  remoteUrl: '',
});
assert.equal(gitStatus.message, 'main: 3 changed files, local-only.');
const gitBranch = runLocalGitOperation('branch', {
  project: sampleProject,
  changedFiles: 3,
  targetBranch: 'review/rubric update',
  remoteUrl: 'git@github.com:auraoneai/rubric.git',
});
assert.equal(gitBranch.branch, 'review/rubric-update');
assert.equal(gitBranch.remoteConfigured, true);
assert.equal(
  runLocalGitOperation('fetch', {
    project: sampleProject,
    changedFiles: 0,
    targetBranch: 'main',
    remoteUrl: '',
  }).message,
  'Add an origin remote before fetching.',
);
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
const desktopSidecarHealth = sidecarHealthSummary('desktop');
assert.equal(desktopSidecarHealth.overallStatus, 'healthy');
assert.equal(desktopSidecarHealth.bundledRuntime, 'uv-managed Python 3.11 sidecar runtime');
assert.equal(desktopSidecarHealth.childCrashSafe, true);
assert.equal(desktopSidecarHealth.sendsApiKeys, false);
assert.equal(desktopSidecarHealth.networkAllowed, false);
assert.equal(desktopSidecarHealth.maxAttempts, 2);
assert.equal(desktopSidecarHealth.workers.filter((worker) => worker.status === 'ready').length, 5);
assert.match(sidecarWorkerReadiness(desktopSidecarHealth), /5\/5 sidecars ready/);
const browserSidecarHealth = sidecarHealthSummary('browser');
assert.equal(browserSidecarHealth.overallStatus, 'disabled');
assert.equal(browserSidecarHealth.childCrashSafe, false);
assert.equal(browserSidecarHealth.workers.every((worker) => worker.status === 'disabled'), true);
assert.match(sidecarWorkerReadiness(browserSidecarHealth), /disabled in Browser Edition/);
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

function messageShape(messages: StudioMessages): string[] {
  return Object.entries(messages)
    .flatMap(([key, value]) => {
      if (typeof value === 'object') {
        return Object.keys(value).map((childKey) => `${key}.${childKey}`);
      }
      return [key];
    })
    .sort();
}
