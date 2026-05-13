import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  buildIntakePackageManifest,
  calculateCalibration,
  createTelemetryEvent,
  distributionForCriterion,
  generateExports,
  projectHealth,
  runBiasProbes,
  runContaminationAudit,
  scoreSamples,
  semanticDiff,
  summarizeCatchView,
} from './domain/engine';
import {
  createCriterion,
  evidenceOptions,
  sampleProject,
  scaleOptions,
  slugify,
  statusOptions,
  type Criterion,
  type RubricProject,
  type SurfaceMode,
  type TelemetryEvent,
} from './domain/rubric';
import { searchProject, validateProject } from './domain/validation';
import { ProjectSidebar } from './components/ProjectSidebar';

type Tab = 'authoring' | 'preview' | 'calibration' | 'diff' | 'export' | 'settings';
type Action =
  | { type: 'select'; criterionId: string }
  | { type: 'updateCriterion'; criterionId: string; patch: Partial<Criterion> }
  | { type: 'addCriterion'; themeId: string }
  | { type: 'duplicateCriterion'; criterionId: string }
  | { type: 'deleteCriterion'; criterionId: string }
  | { type: 'toggleTheme'; themeId: string }
  | { type: 'moveCriterion'; criterionId: string; direction: -1 | 1 }
  | { type: 'toggleJudge'; judgeId: string }
  | { type: 'setKeyConfigured'; judgeId: string; configured: boolean }
  | { type: 'toggleComments' };

interface StudioState {
  project: RubricProject;
  selectedCriterionId: string;
  selectedSampleId: string;
}

const tabs: Array<{ id: Tab; label: string; shortcut: string }> = [
  { id: 'authoring', label: 'Authoring', shortcut: '1' },
  { id: 'preview', label: 'Preview', shortcut: '2' },
  { id: 'calibration', label: 'Calibration', shortcut: '3' },
  { id: 'diff', label: 'Diff', shortcut: '4' },
  { id: 'export', label: 'Export', shortcut: '5' },
  { id: 'settings', label: 'Settings', shortcut: ',' },
];

const commandList = [
  'New criterion',
  'Duplicate criterion',
  'Delete criterion',
  'Run preview',
  'Score current sample',
  'Score all samples',
  'Open calibration',
  'Run bias probes',
  'Run contamination audit',
  'Open semantic diff',
  'Try criterion variant',
  'Export: lm-eval-harness',
  'Export: Inspect',
  'Export: OpenAI Evals',
  'Export: Promptfoo',
  'Export: AuraOne intake package',
  'Generate CI helper',
  'Git init',
  'Git commit',
  'Toggle comments',
  'Open keyboard shortcuts',
];

const shortcutRows = [
  ['Cmd/Ctrl-N', 'New criterion'],
  ['Cmd/Ctrl-Shift-N', 'New theme'],
  ['Cmd/Ctrl-S', 'Save current project'],
  ['Cmd/Ctrl-P', 'Quick open'],
  ['Cmd/Ctrl-K', 'Command palette'],
  ['Cmd/Ctrl-1..5', 'Switch primary tabs'],
  ['Cmd/Ctrl-Enter', 'Score current sample'],
  ['Cmd/Ctrl-Shift-Enter', 'Score all samples'],
  ['Cmd/Ctrl-/', 'Toggle criterion comments'],
  ['Cmd/Ctrl-D', 'Duplicate criterion'],
  ['Cmd/Ctrl-Backspace', 'Delete criterion'],
  ['Cmd/Ctrl-Z / Cmd/Ctrl-Shift-Z', 'Undo / redo'],
];

function reducer(state: StudioState, action: Action): StudioState {
  switch (action.type) {
    case 'select':
      return { ...state, selectedCriterionId: action.criterionId };
    case 'updateCriterion': {
      const criteria = state.project.criteria.map((criterion) =>
        criterion.id === action.criterionId ? { ...criterion, ...action.patch } : criterion,
      );
      const selectedCriterionId =
        action.patch.id && state.selectedCriterionId === action.criterionId
          ? action.patch.id
          : state.selectedCriterionId;
      return { ...state, selectedCriterionId, project: { ...state.project, criteria } };
    }
    case 'addCriterion': {
      const criterion = createCriterion(action.themeId, state.project.criteria.length + 1);
      return {
        ...state,
        selectedCriterionId: criterion.id,
        project: { ...state.project, criteria: [...state.project.criteria, criterion] },
      };
    }
    case 'duplicateCriterion': {
      const original = state.project.criteria.find((criterion) => criterion.id === action.criterionId);
      if (!original) {
        return state;
      }
      const copy = {
        ...original,
        id: `${original.id}-copy`,
        label: `${original.label} copy`,
        status: 'Draft' as const,
      };
      return {
        ...state,
        selectedCriterionId: copy.id,
        project: { ...state.project, criteria: [...state.project.criteria, copy] },
      };
    }
    case 'deleteCriterion': {
      const criteria = state.project.criteria.filter((criterion) => criterion.id !== action.criterionId);
      return {
        ...state,
        selectedCriterionId: criteria[0]?.id ?? '',
        project: { ...state.project, criteria },
      };
    }
    case 'toggleTheme':
      return {
        ...state,
        project: {
          ...state.project,
          themes: state.project.themes.map((theme) =>
            theme.id === action.themeId ? { ...theme, collapsed: !theme.collapsed } : theme,
          ),
        },
      };
    case 'moveCriterion': {
      const index = state.project.criteria.findIndex((criterion) => criterion.id === action.criterionId);
      const nextIndex = index + action.direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= state.project.criteria.length) {
        return state;
      }
      const criteria = [...state.project.criteria];
      [criteria[index], criteria[nextIndex]] = [criteria[nextIndex], criteria[index]];
      return { ...state, project: { ...state.project, criteria } };
    }
    case 'toggleJudge':
      return {
        ...state,
        project: {
          ...state.project,
          judges: state.project.judges.map((judge) =>
            judge.id === action.judgeId ? { ...judge, enabled: !judge.enabled } : judge,
          ),
        },
      };
    case 'setKeyConfigured':
      return {
        ...state,
        project: {
          ...state.project,
          judges: state.project.judges.map((judge) =>
            judge.id === action.judgeId ? { ...judge, keyConfigured: action.configured } : judge,
          ),
        },
      };
    case 'toggleComments':
      return {
        ...state,
        project: { ...state.project, commentsVisible: !state.project.commentsVisible },
      };
    default:
      return state;
  }
}

export function App() {
  const initialSurface = new URLSearchParams(window.location.search).get('surface') === 'browser' ? 'browser' : 'desktop';
  const [state, dispatch] = useReducer(reducer, {
    project: readSavedProject(),
    selectedCriterionId: sampleProject.criteria[0].id,
    selectedSampleId: sampleProject.samples[0].id,
  });
  const [activeTab, setActiveTab] = useState<Tab>('authoring');
  const [surface, setSurface] = useState<SurfaceMode>(initialSurface);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [wizardOpen, setWizardOpen] = useState(() => localStorage.getItem('rso:onboarded') !== 'yes');
  const [searchQuery, setSearchQuery] = useState('safety');
  const [regex, setRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [scoreRunning, setScoreRunning] = useState(false);
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [telemetryLog, setTelemetryLog] = useState<TelemetryEvent[]>([]);
  const [toast, setToast] = useState('Saved');
  const selectedCriterion = state.project.criteria.find((criterion) => criterion.id === state.selectedCriterionId);
  const selectedSample = state.project.samples.find((sample) => sample.id === state.selectedSampleId) ?? state.project.samples[0];
  const issues = useMemo(() => validateProject(state.project), [state.project]);
  const scoreResults = useMemo(() => scoreSamples(state.project, state.project.samples, state.project.judges), [state.project]);
  const calibration = useMemo(() => calculateCalibration(state.project, scoreResults), [state.project, scoreResults]);
  const diff = useMemo(() => semanticDiff(state.project), [state.project]);
  const exports = useMemo(() => generateExports(state.project, issues, calibration), [state.project, issues, calibration]);
  const health = useMemo(() => projectHealth(state.project), [state.project]);
  const searchResults = useMemo(
    () => searchProject(state.project, { query: searchQuery, regex, caseSensitive, wholeWord }),
    [state.project, searchQuery, regex, caseSensitive, wholeWord],
  );
  const catchView = useMemo(() => summarizeCatchView(scoreResults), [scoreResults]);
  const saveTimer = useRef<number>();

  useEffect(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      localStorage.setItem('rso:project', JSON.stringify(state.project));
      setToast('Autosaved to local project cache');
    }, 250);
    return () => window.clearTimeout(saveTimer.current);
  }, [state.project]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) {
        return;
      }
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key >= '1' && event.key <= '5') {
        event.preventDefault();
        setActiveTab(tabs[Number(event.key) - 1].id);
      }
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        dispatch({ type: 'addCriterion', themeId: state.project.themes[0].id });
      }
      if (event.key.toLowerCase() === 'd' && selectedCriterion) {
        event.preventDefault();
        dispatch({ type: 'duplicateCriterion', criterionId: selectedCriterion.id });
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        runPreview();
      }
      if (event.key === '/') {
        event.preventDefault();
        dispatch({ type: 'toggleComments' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedCriterion, state.project.themes]);

  function emit(event: string, payload: TelemetryEvent['payload'] = {}) {
    const telemetryEvent = createTelemetryEvent(event, payload);
    setTelemetryLog((current) => [telemetryEvent, ...current].slice(0, 25));
  }

  function executeCommand(command: string) {
    setPaletteOpen(false);
    setPaletteQuery('');
    emit('command.executed', { command });
    if (command === 'New criterion') dispatch({ type: 'addCriterion', themeId: state.project.themes[0].id });
    if (command === 'Duplicate criterion' && selectedCriterion) {
      dispatch({ type: 'duplicateCriterion', criterionId: selectedCriterion.id });
    }
    if (command === 'Delete criterion' && selectedCriterion) {
      dispatch({ type: 'deleteCriterion', criterionId: selectedCriterion.id });
    }
    if (command.includes('preview') || command.includes('Score')) runPreview();
    if (command === 'Open calibration') setActiveTab('calibration');
    if (command === 'Open semantic diff') setActiveTab('diff');
    if (command.startsWith('Export')) setActiveTab('export');
    if (command === 'Toggle comments') dispatch({ type: 'toggleComments' });
    setToast(command);
  }

  function runPreview() {
    setActiveTab('preview');
    setScoreRunning(true);
    emit('preview.score.started', { surface, sample_count: state.project.samples.length });
    window.setTimeout(() => {
      setScoreRunning(false);
      setToast('Score run completed');
    }, 650);
  }

  function acceptWizard() {
    localStorage.setItem('rso:onboarded', 'yes');
    setWizardOpen(false);
    setActiveTab('preview');
    runPreview();
  }

  return (
    <main className="app-shell" data-surface={surface}>
      <a className="skip-link" href="#main-panel">
        Skip to editor
      </a>
      <header className="topbar" role="banner">
        <div className="brand">
          <span className="app-icon" aria-hidden="true">
            RS
          </span>
          <div>
            <h1>Rubric Studio Open</h1>
            <p>{surface === 'browser' ? 'Browser edition' : 'Desktop edition'} · local-first rubric IDE</p>
          </div>
        </div>
        <nav className="menu" aria-label="Application menu">
          {['File', 'Edit', 'View', 'Rubric', 'Run', 'Tools', 'Help'].map((item) => (
            <button key={item} className="ghost-button" type="button">
              {item}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <button className="glass-button" type="button" onClick={() => setPaletteOpen(true)}>
            Cmd/Ctrl-K
          </button>
          <label className="switch">
            <span>Browser constraints</span>
            <input
              type="checkbox"
              checked={surface === 'browser'}
              onChange={(event) => setSurface(event.target.checked ? 'browser' : 'desktop')}
            />
          </label>
        </div>
      </header>

      <div className="workspace">
        <ProjectSidebar project={state.project} issues={issues.length} selectedCriterionId={state.selectedCriterionId} onSelect={(criterionId) => dispatch({ type: 'select', criterionId })} />
        <section id="main-panel" className="main-panel" aria-label={`${activeTab} panel`}>
          {activeTab === 'authoring' && selectedCriterion ? (
            <AuthoringPanel
              project={state.project}
              criterion={selectedCriterion}
              issues={issues.filter((issue) => issue.criterionId === selectedCriterion.id)}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              searchResults={searchResults}
              regex={regex}
              setRegex={setRegex}
              wholeWord={wholeWord}
              setWholeWord={setWholeWord}
              caseSensitive={caseSensitive}
              setCaseSensitive={setCaseSensitive}
              onSelect={(criterionId) => dispatch({ type: 'select', criterionId })}
              onUpdate={(patch) => dispatch({ type: 'updateCriterion', criterionId: selectedCriterion.id, patch })}
              onAdd={(themeId) => dispatch({ type: 'addCriterion', themeId })}
              onMove={(direction) => dispatch({ type: 'moveCriterion', criterionId: selectedCriterion.id, direction })}
              onToggleTheme={(themeId) => dispatch({ type: 'toggleTheme', themeId })}
            />
          ) : null}
          {activeTab === 'preview' ? (
            <PreviewPanel
              project={state.project}
              selectedSampleId={state.selectedSampleId}
              selectedSample={selectedSample}
              results={scoreResults}
              running={scoreRunning}
              surface={surface}
              catchView={catchView}
              onRun={runPreview}
            />
          ) : null}
          {activeTab === 'calibration' ? (
            <CalibrationPanel project={state.project} calibration={calibration} surface={surface} />
          ) : null}
          {activeTab === 'diff' ? <DiffPanel project={state.project} diff={diff} surface={surface} /> : null}
          {activeTab === 'export' ? (
            <ExportPanel
              project={state.project}
              exports={exports}
              intakeManifest={buildIntakePackageManifest(state.project)}
              surface={surface}
            />
          ) : null}
          {activeTab === 'settings' ? (
            <SettingsPanel
              project={state.project}
              surface={surface}
              telemetryEnabled={telemetryEnabled}
              setTelemetryEnabled={setTelemetryEnabled}
              telemetryLog={telemetryLog}
              onToggleJudge={(judgeId) => dispatch({ type: 'toggleJudge', judgeId })}
              onSetKey={(judgeId, configured) => dispatch({ type: 'setKeyConfigured', judgeId, configured })}
            />
          ) : null}
        </section>
      </div>

      <footer className="statusbar" role="contentinfo">
        <div>
          <strong>{issues.length}</strong> issues · {health.issueCounts.error} errors · {health.issueCounts.warning} warnings · readiness {health.readiness}%
        </div>
        <div>Git: {state.project.branch} · sync local · {toast}</div>
      </footer>

      <nav className="tabbar" aria-label="Rubric Studio Open tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={tab.id === activeTab ? 'tab active' : 'tab'}
            type="button"
            onClick={() => {
              setActiveTab(tab.id);
              emit('tab.opened', { tab: tab.id });
            }}
          >
            {tab.label}
            <span>{tab.shortcut}</span>
          </button>
        ))}
      </nav>

      {paletteOpen ? (
        <CommandPalette
          query={paletteQuery}
          setQuery={setPaletteQuery}
          commands={commandList}
          onClose={() => setPaletteOpen(false)}
          onExecute={executeCommand}
        />
      ) : null}

      {wizardOpen ? <FirstRunWizard onSkip={() => setWizardOpen(false)} onStart={acceptWizard} /> : null}
    </main>
  );
}

function AuthoringPanel(props: {
  project: RubricProject;
  criterion: Criterion;
  issues: ReturnType<typeof validateProject>;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchResults: ReturnType<typeof searchProject>;
  regex: boolean;
  setRegex: (value: boolean) => void;
  wholeWord: boolean;
  setWholeWord: (value: boolean) => void;
  caseSensitive: boolean;
  setCaseSensitive: (value: boolean) => void;
  onSelect: (criterionId: string) => void;
  onUpdate: (patch: Partial<Criterion>) => void;
  onAdd: (themeId: string) => void;
  onMove: (direction: -1 | 1) => void;
  onToggleTheme: (themeId: string) => void;
}) {
  const { project, criterion, issues } = props;
  return (
    <div className="panel-grid authoring-grid">
      <section className="glass-panel" aria-label="Criterion tree">
        <div className="panel-title">
          <div>
            <p>Rubric</p>
            <h2>Criterion tree</h2>
          </div>
          <button className="glass-button" type="button" onClick={() => props.onAdd(project.themes[0].id)}>
            + Criterion
          </button>
        </div>
        {project.criteria.length === 0 ? (
          <EmptyState title="No criteria yet" body="Create a criterion to start validating the rubric-spec project." />
        ) : (
          project.themes.map((theme) => (
            <div className="theme-block" key={theme.id}>
              <button className="theme-title" type="button" onClick={() => props.onToggleTheme(theme.id)}>
                {theme.collapsed ? '▸' : '▾'} {theme.label}
              </button>
              {!theme.collapsed
                ? project.criteria
                    .filter((item) => item.themeId === theme.id)
                    .map((item) => (
                      <button
                        draggable
                        key={item.id}
                        className={item.id === criterion.id ? 'criterion-row active' : 'criterion-row'}
                        type="button"
                        onClick={() => props.onSelect(item.id)}
                      >
                        <span>{item.label}</span>
                        <small>{item.scale}</small>
                        <b>{item.weight.toFixed(2)}</b>
                        <em>{item.status}</em>
                        <span className="tags">{item.tags.join(' ')}</span>
                      </button>
                    ))
                : null}
            </div>
          ))
        )}
      </section>
      <section className="glass-panel editor-panel" aria-label="Criterion editor">
        <div className="panel-title">
          <div>
            <p>Editor</p>
            <h2>{criterion.label}</h2>
          </div>
          <div className="inline-actions">
            <button className="ghost-button" type="button" onClick={() => props.onMove(-1)}>
              ↑
            </button>
            <button className="ghost-button" type="button" onClick={() => props.onMove(1)}>
              ↓
            </button>
          </div>
        </div>
        <div className="form-grid">
          <Field label="Label" issueCount={issues.filter((issue) => issue.field === 'label').length}>
            <input value={criterion.label} onChange={(event) => props.onUpdate({ label: event.target.value })} />
          </Field>
          <Field label="ID" issueCount={issues.filter((issue) => issue.field === 'id').length}>
            <div className="with-button">
              <input value={criterion.id} onChange={(event) => props.onUpdate({ id: slugify(event.target.value) })} />
              <button className="ghost-button" type="button" onClick={() => props.onUpdate({ id: slugify(criterion.label) })}>
                Fix
              </button>
            </div>
          </Field>
          <Field label="Weight">
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={criterion.weight}
              onChange={(event) => props.onUpdate({ weight: Number(event.target.value) })}
            />
          </Field>
          <Field label="Scale">
            <select value={criterion.scale} onChange={(event) => props.onUpdate({ scale: event.target.value as Criterion['scale'] })}>
              {scaleOptions.map((scale) => (
                <option key={scale}>{scale}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={criterion.status} onChange={(event) => props.onUpdate({ status: event.target.value as Criterion['status'] })}>
              {statusOptions.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </Field>
          <Field label="Evidence">
            <select
              value={criterion.evidenceRequirement}
              onChange={(event) => props.onUpdate({ evidenceRequirement: event.target.value as Criterion['evidenceRequirement'] })}
            >
              {evidenceOptions.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Description" issueCount={issues.filter((issue) => issue.field === 'description').length}>
          <textarea value={criterion.description} onChange={(event) => props.onUpdate({ description: event.target.value })} />
        </Field>
        <Field label="Positive examples" issueCount={issues.filter((issue) => issue.field === 'positiveExamples').length}>
          <textarea
            value={criterion.positiveExamples.join('\n')}
            onChange={(event) => props.onUpdate({ positiveExamples: event.target.value.split('\n').filter(Boolean) })}
          />
        </Field>
        <Field label="Negative examples" issueCount={issues.filter((issue) => issue.field === 'negativeExamples').length}>
          <textarea
            value={criterion.negativeExamples.join('\n')}
            onChange={(event) => props.onUpdate({ negativeExamples: event.target.value.split('\n').filter(Boolean) })}
          />
        </Field>
        <details className="details-grid">
          <summary>Advanced rubric-spec fields</summary>
          <Field label="Anti-patterns">
            <textarea value={criterion.antiPatterns.join('\n')} onChange={(event) => props.onUpdate({ antiPatterns: event.target.value.split('\n').filter(Boolean) })} />
          </Field>
          <Field label="Boundaries">
            <textarea value={criterion.boundaries} onChange={(event) => props.onUpdate({ boundaries: event.target.value })} />
          </Field>
          <Field label="Edge cases">
            <textarea value={criterion.edgeCases.join('\n')} onChange={(event) => props.onUpdate({ edgeCases: event.target.value.split('\n').filter(Boolean) })} />
          </Field>
          <Field label="Tags">
            <input value={criterion.tags.join(', ')} onChange={(event) => props.onUpdate({ tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} />
          </Field>
          <Field label="References">
            <textarea value={criterion.references.join('\n')} onChange={(event) => props.onUpdate({ references: event.target.value.split('\n').filter(Boolean) })} />
          </Field>
          <Field label="Sibling links">
            <input value={criterion.siblingLinks.join(', ')} onChange={(event) => props.onUpdate({ siblingLinks: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} />
          </Field>
        </details>
      </section>
      <aside className="glass-panel inspector" aria-label="Validation and search">
        <div className="panel-title">
          <div>
            <p>Inline validation</p>
            <h2>{issues.length} signals</h2>
          </div>
        </div>
        <div className="issue-list">
          {issues.length === 0 ? <SuccessState title="No criterion issues" body="rubric-spec and style checks pass for this criterion." /> : null}
          {issues.map((issue) => (
            <div key={issue.id} className={`issue ${issue.severity}`}>
              <strong>{issue.field}</strong>
              <span>{issue.message}</span>
              {issue.quickFix ? <button className="ghost-button" type="button">{issue.quickFix}</button> : null}
            </div>
          ))}
        </div>
        <div className="search-box">
          <label>
            Across-project search
            <input value={props.searchQuery} onChange={(event) => props.setSearchQuery(event.target.value)} />
          </label>
          <div className="toggle-row">
            <label><input type="checkbox" checked={props.regex} onChange={(event) => props.setRegex(event.target.checked)} />Regex</label>
            <label><input type="checkbox" checked={props.caseSensitive} onChange={(event) => props.setCaseSensitive(event.target.checked)} />Case</label>
            <label><input type="checkbox" checked={props.wholeWord} onChange={(event) => props.setWholeWord(event.target.checked)} />Word</label>
          </div>
          <div className="search-results">
            {props.searchResults.length === 0 ? <EmptyState title="No matches" body="Try a broader term or disable regex." /> : null}
            {props.searchResults.slice(0, 8).map((result) => (
              <button key={`${result.criterionId}-${result.field}-${result.excerpt}`} type="button" onClick={() => props.onSelect(result.criterionId)}>
                <strong>{result.criterionId}</strong>
                <span>{result.field}</span>
                <small>{result.excerpt}</small>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function PreviewPanel(props: {
  project: RubricProject;
  selectedSampleId: string;
  selectedSample: RubricProject['samples'][number];
  results: ReturnType<typeof scoreSamples>;
  running: boolean;
  surface: SurfaceMode;
  catchView: ReturnType<typeof summarizeCatchView>;
  onRun: () => void;
}) {
  const activeResults = props.results.filter((result) => result.sampleId === props.selectedSampleId);
  return (
    <div className="panel-grid preview-grid">
      <section className="glass-panel">
        <div className="panel-title">
          <div>
            <p>Preview</p>
            <h2>Live testing</h2>
          </div>
          <div className="inline-actions">
            <button className="glass-button" type="button" onClick={props.onRun}>Score current</button>
            <button className="glass-button primary" type="button" onClick={props.onRun}>Score all</button>
          </div>
        </div>
        {props.running ? <LoadingState label="Scoring all criteria with cancellable progress" /> : null}
        <article className="sample-card">
          <p>Response 1 of {props.project.samples.length}</p>
          <blockquote>{props.selectedSample.response}</blockquote>
        </article>
        <div className="judge-grid">
          {props.project.judges.filter((judge) => judge.enabled).map((judge) => (
            <div key={judge.id} className="judge-column">
              <h3>{judge.label}</h3>
              {activeResults
                .filter((result) => result.judgeId === judge.id)
                .map((result) => (
                  <details key={`${result.judgeId}-${result.criterionId}`} className={`score-card ${result.verdict}`}>
                    <summary>
                      <span>{props.project.criteria.find((criterion) => criterion.id === result.criterionId)?.label}</span>
                      <strong>{result.verdict}</strong>
                      <small>{result.confidence}</small>
                    </summary>
                    <p>{result.reasoning}</p>
                  </details>
                ))}
            </div>
          ))}
        </div>
      </section>
      <aside className="glass-panel">
        <div className="panel-title">
          <div>
            <p>Analysis</p>
            <h2>What did this catch?</h2>
          </div>
        </div>
        {props.project.criteria.map((criterion) => {
          const distribution = distributionForCriterion(props.results, criterion.id);
          return (
            <div className="distribution" key={criterion.id}>
              <button type="button">{criterion.label}</button>
              <div className="bars" aria-label={`Distribution for ${criterion.label}`}>
                <span style={{ width: `${distribution.pass * 18 + 8}%` }} className="pass" />
                <span style={{ width: `${distribution.partial * 18 + 8}%` }} className="partial" />
                <span style={{ width: `${distribution.fail * 18 + 8}%` }} className="fail" />
              </div>
              <small>
                {distribution.pass} pass · {distribution.partial} partial · {distribution.fail} fail
              </small>
            </div>
          );
        })}
        <div className="callout">
          <strong>{props.surface === 'browser' ? 'Browser scoring' : 'Desktop scoring'}</strong>
          <p>
            {props.surface === 'browser'
              ? 'Provider calls use BYO keys directly from the browser; Python sidecars remain disabled.'
              : 'Desktop can run local mock, Ollama, provider judges, and Python sidecars through the Rust core.'}
          </p>
        </div>
      </aside>
    </div>
  );
}

function CalibrationPanel({
  project,
  calibration,
  surface,
}: {
  project: RubricProject;
  calibration: ReturnType<typeof calculateCalibration>;
  surface: SurfaceMode;
}) {
  if (surface === 'browser') {
    return <DisabledFeature title="Calibration requires desktop" body="iaa-kit, judge-bench, and contamination-audit run as local Python sidecars and are intentionally unavailable in the browser edition." />;
  }
  const probes = runBiasProbes(project);
  const contamination = runContaminationAudit(project);
  return (
    <div className="panel-grid calibration-grid">
      <section className="glass-panel">
        <div className="panel-title"><div><p>Calibration</p><h2>IAA metrics</h2></div><button className="glass-button primary" type="button">Load gold JSONL</button></div>
        {calibration.map((item) => (
          <div key={item.criterionId} className="metric-row">
            <strong>{project.criteria.find((criterion) => criterion.id === item.criterionId)?.label}</strong>
            <span>Cohen κ {item.kappa}</span>
            <span>Weighted κ {item.weightedKappa}</span>
            <span>Krippendorff α {item.krippendorffAlpha}</span>
            <span>CI {item.ci95[0]}..{item.ci95[1]}</span>
          </div>
        ))}
      </section>
      <section className="glass-panel">
        <div className="panel-title"><div><p>Needs work</p><h2>Lowest agreement</h2></div><button className="glass-button" type="button">Suggest rewrite</button></div>
        {calibration.slice().sort((a, b) => a.kappa - b.kappa).map((item) => (
          <div key={item.criterionId} className="rewrite-card">
            <strong>{project.criteria.find((criterion) => criterion.id === item.criterionId)?.label}</strong>
            <p>Candidate rewrite: Make the evidence threshold observable and add an explicit boundary.</p>
            <small>Most disagreed samples: {item.mostDisagreedSampleIds.join(', ') || 'none'}</small>
          </div>
        ))}
      </section>
      <aside className="glass-panel">
        <div className="panel-title"><div><p>Sidecars</p><h2>Bias and leakage</h2></div></div>
        {probes.map((probe) => (
          <div key={probe.id} className={`probe ${probe.status}`}><strong>{probe.label}</strong><span>{probe.status}</span><p>{probe.reasoning}</p></div>
        ))}
        <h3>Contamination audit</h3>
        {contamination.map((row) => (
          <div key={row.sampleId} className="metric-row compact"><strong>{row.sampleId}</strong><span>{row.ngramOverlap} overlap</span><span>{row.exactMatch ? 'exact match' : 'no exact match'}</span></div>
        ))}
      </aside>
    </div>
  );
}

function DiffPanel({ project, diff, surface }: { project: RubricProject; diff: ReturnType<typeof semanticDiff>; surface: SurfaceMode }) {
  return (
    <div className="panel-grid diff-grid">
      <section className="glass-panel">
        <div className="panel-title"><div><p>Versioning</p><h2>Semantic diff</h2></div><button className="glass-button primary" type="button">Git commit</button></div>
        {diff.map((item) => (
          <div key={item.criterionId} className={`diff-row ${item.severity}`}>
            <strong>{item.label}</strong>
            <span>{item.severity}</span>
            <p>{item.summary}</p>
          </div>
        ))}
      </section>
      <section className="glass-panel">
        <div className="panel-title"><div><p>Impact</p><h2>Score overlay</h2></div><button className="glass-button" type="button">Try variant branch</button></div>
        {surface === 'browser' ? <p className="subtle">Browser edition shows semantic diff only; git operations and held-out re-scoring need desktop file access.</p> : null}
        <table>
          <thead><tr><th>Criterion</th><th>Pass → fail</th><th>Fail → pass</th></tr></thead>
          <tbody>
            {diff.map((item) => (
              <tr key={item.criterionId}><td>{item.label}</td><td>{item.passToFail}</td><td>{item.failToPass}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="callout"><strong>What changed and what broke</strong><p>{project.name} has {diff.filter((item) => item.severity !== 'cosmetic').length} substantive changes affecting held-out samples.</p></div>
      </section>
    </div>
  );
}

function ExportPanel({
  project,
  exports,
  intakeManifest,
  surface,
}: {
  project: RubricProject;
  exports: Record<string, string>;
  intakeManifest: string;
  surface: SurfaceMode;
}) {
  const exportEntries = Object.entries(exports);
  return (
    <div className="panel-grid export-grid">
      <section className="glass-panel">
        <div className="panel-title"><div><p>Export</p><h2>Always-on artifacts</h2></div><button className="intake-button" type="button">Send to AuraOne for expert review</button></div>
        <div className="intake-flow">
          <div><strong>1. Confirm scope</strong><span>{project.samples.length} samples · {project.criteria.length} criteria · reviewer count selectable</span></div>
          <div><strong>2. Package</strong><span>rubric + calibration set + judge card + manifest</span></div>
          <div><strong>3. Destination</strong><span>Cloud signup · existing org upload · local .rubricpkg</span></div>
        </div>
        <pre className="export-preview">{intakeManifest}</pre>
      </section>
      <aside className="glass-panel">
        <div className="panel-title"><div><p>Adapters</p><h2>{exportEntries.length} outputs</h2></div></div>
        {exportEntries.map(([name, content]) => (
          <details key={name} className="export-item">
            <summary>{name}</summary>
            <pre>{content}</pre>
          </details>
        ))}
        <div className="callout"><strong>CLI parity</strong><p>Every artifact shown here maps to rubric export, rubric badge, rubric judge-card, or rubric manifest commands.</p></div>
        {surface === 'browser' ? <p className="subtle">Browser export uses local download only and never proxies content through AuraOne.</p> : null}
      </aside>
    </div>
  );
}

function SettingsPanel(props: {
  project: RubricProject;
  surface: SurfaceMode;
  telemetryEnabled: boolean;
  setTelemetryEnabled: (value: boolean) => void;
  telemetryLog: TelemetryEvent[];
  onToggleJudge: (judgeId: string) => void;
  onSetKey: (judgeId: string, configured: boolean) => void;
}) {
  return (
    <div className="panel-grid settings-grid">
      <section className="glass-panel">
        <div className="panel-title"><div><p>Keys</p><h2>BYO provider settings</h2></div></div>
        {props.project.judges.map((judge) => (
          <div key={judge.id} className="setting-row">
            <div><strong>{judge.label}</strong><small>{judge.provider}/{judge.model}</small></div>
            <label><input type="checkbox" checked={judge.enabled} onChange={() => props.onToggleJudge(judge.id)} />Enabled</label>
            <button className="glass-button" type="button" onClick={() => props.onSetKey(judge.id, !judge.keyConfigured)}>
              {judge.keyConfigured ? 'Rotate key' : 'Configure key'}
            </button>
          </div>
        ))}
        <div className="callout"><strong>Key storage</strong><p>{props.surface === 'browser' ? 'Browser edition stores BYO keys in session memory for direct provider calls only.' : 'Desktop routes keys through the OS keychain bridge; never plaintext project files.'}</p></div>
      </section>
      <section className="glass-panel">
        <div className="panel-title"><div><p>Telemetry</p><h2>Transparent event log</h2></div><label className="switch"><span>Opt in</span><input type="checkbox" checked={props.telemetryEnabled} onChange={(event) => props.setTelemetryEnabled(event.target.checked)} /></label></div>
        <p className="subtle">Collected only when opted in: anonymous install hash, feature usage counts, and error rates. Never rubric content, samples, judge prompts, or API keys.</p>
        <pre className="export-preview">{JSON.stringify(props.telemetryLog, null, 2)}</pre>
      </section>
      <section className="glass-panel">
        <div className="panel-title"><div><p>Shortcuts</p><h2>Remappable controls</h2></div></div>
        {shortcutRows.map(([shortcut, action]) => (
          <div className="setting-row" key={shortcut}><kbd>{shortcut}</kbd><span>{action}</span><button className="ghost-button" type="button">Remap</button></div>
        ))}
      </section>
    </div>
  );
}

function CommandPalette(props: {
  query: string;
  setQuery: (value: string) => void;
  commands: string[];
  onClose: () => void;
  onExecute: (command: string) => void;
}) {
  const filtered = props.commands.filter((command) => command.toLowerCase().includes(props.query.toLowerCase()));
  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onClose}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(event) => event.stopPropagation()}>
        <input autoFocus placeholder="Run a command..." value={props.query} onChange={(event) => props.setQuery(event.target.value)} />
        <div>
          {filtered.map((command) => (
            <button key={command} type="button" onClick={() => props.onExecute(command)}>
              <span>{command}</span>
              <small>{command.includes('Export') ? 'Export' : command.includes('Git') ? 'Git' : 'Rubric'}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function FirstRunWizard({ onSkip, onStart }: { onSkip: () => void; onStart: () => void }) {
  return (
    <div className="modal-backdrop">
      <section className="wizard" role="dialog" aria-modal="true" aria-label="First-run wizard">
        <div className="app-icon large">RS</div>
        <h2>Sixty seconds to first value</h2>
        <div className="wizard-steps">
          <div><strong>1. Look at the rubric</strong><span>A 12-criterion helpful-response project is preloaded with themes, criteria, samples, and judges.</span></div>
          <div><strong>2. Score this sample</strong><span>The local mock judge runs offline and shows criterion-level reasoning.</span></div>
          <div><strong>3. Read the diff</strong><span>See which criteria changed and how held-out samples would flip.</span></div>
        </div>
        <div className="inline-actions">
          <button className="ghost-button" type="button" onClick={onSkip}>Skip</button>
          <button className="glass-button primary" type="button" onClick={onStart}>Start tour</button>
        </div>
      </section>
    </div>
  );
}

function Field({ label, issueCount = 0, children }: { label: string; issueCount?: number; children: React.ReactNode }) {
  return (
    <label className={issueCount > 0 ? 'field has-issue' : 'field'}>
      <span>{label}{issueCount > 0 ? <em>{issueCount}</em> : null}</span>
      {children}
    </label>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><strong>{title}</strong><p>{body}</p></div>;
}

function SuccessState({ title, body }: { title: string; body: string }) {
  return <div className="success-state"><strong>{title}</strong><p>{body}</p></div>;
}

function LoadingState({ label }: { label: string }) {
  return <div className="loading-state"><span /><div><strong>{label}</strong><progress value={66} max={100}>66%</progress></div><button className="ghost-button" type="button">Cancel</button></div>;
}

function DisabledFeature({ title, body }: { title: string; body: string }) {
  return <section className="glass-panel centered"><h2>{title}</h2><p>{body}</p><a className="glass-button primary" href="auraone://rubric-studio/open">Open desktop app</a></section>;
}

function readSavedProject(): RubricProject {
  try {
    const saved = localStorage.getItem('rso:project');
    return saved ? (JSON.parse(saved) as RubricProject) : sampleProject;
  } catch {
    return sampleProject;
  }
}
