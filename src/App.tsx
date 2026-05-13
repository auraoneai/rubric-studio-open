import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Command,
  Eye,
  FileText,
  GitCompare,
  HelpCircle,
  Play,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import {
  buildIntakePackageManifest,
  calculateCalibration,
  createTelemetryEvent,
  generateExports,
  projectHealth,
  scoreSamples,
  semanticDiff,
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
  type RubricSample,
  type SurfaceMode,
  type TelemetryEvent,
} from './domain/rubric';
import { searchProject, validateProject } from './domain/validation';
import { auditStudioActions, defaultShortcutRows, studioActionCategory, studioActionLabels } from './domain/actions';
import { actionForShortcut, shortcutForAction, type ShortcutRow } from './domain/shortcuts';
import { ProjectSidebar } from './components/ProjectSidebar';
import { BrowserProjectControls } from './components/BrowserProjectControls';
import { PreviewPanel } from './components/PreviewPanel';
import { SettingsPanel, type VisualMode } from './components/SettingsPanel';
import { DiffPanel } from './components/DiffPanel';
import { CalibrationPanel } from './components/CalibrationPanel';
import { ExportPanel } from './components/ExportPanel';
import { FirstRunWizard } from './components/FirstRunWizard';

type Tab = 'authoring' | 'preview' | 'calibration' | 'diff' | 'export' | 'settings';
type Action =
  | { type: 'select'; criterionId: string }
  | { type: 'updateCriterion'; criterionId: string; patch: Partial<Criterion> }
  | { type: 'addCriterion'; themeId: string }
  | { type: 'addTheme' }
  | { type: 'duplicateCriterion'; criterionId: string }
  | { type: 'deleteCriterion'; criterionId: string }
  | { type: 'bulkUpdateCriteria'; criterionIds: string[]; patch: Partial<Criterion> }
  | { type: 'toggleTheme'; themeId: string }
  | { type: 'moveCriterion'; criterionId: string; direction: -1 | 1 }
  | { type: 'toggleJudge'; judgeId: string }
  | { type: 'setKeyConfigured'; judgeId: string; configured: boolean }
  | { type: 'toggleComments' }
  | { type: 'setSelectedSample'; sampleId: string }
  | { type: 'addSample'; sample: RubricSample }
  | { type: 'replaceProject'; project: RubricProject };

interface StudioState {
  project: RubricProject;
  selectedCriterionId: string;
  selectedSampleId: string;
}

const tabs: Array<{ id: Tab; label: string; action: string }> = [
  { id: 'authoring', label: 'Authoring', action: 'Switch to Authoring' },
  { id: 'preview', label: 'Preview', action: 'Switch to Preview' },
  { id: 'calibration', label: 'Calibration', action: 'Switch to Calibration' },
  { id: 'diff', label: 'Diff', action: 'Switch to Diff' },
  { id: 'export', label: 'Export', action: 'Switch to Export' },
  { id: 'settings', label: 'Settings', action: 'Switch to Settings' },
];

const menuIcons: Record<string, LucideIcon> = {
  File: FileText,
  Edit: SquarePen,
  View: Eye,
  Rubric: BookOpen,
  Run: Play,
  Tools: Wrench,
  Help: HelpCircle,
};

const tabIcons: Record<Tab, LucideIcon> = {
  authoring: SquarePen,
  preview: Play,
  calibration: SlidersHorizontal,
  diff: GitCompare,
  export: FileText,
  settings: Settings,
};

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
    case 'addTheme': {
      const id = `theme-${state.project.themes.length + 1}`;
      return {
        ...state,
        project: {
          ...state.project,
          themes: [
            ...state.project.themes,
            {
              id,
              label: `Theme ${state.project.themes.length + 1}`,
              description: 'New rubric theme.',
              collapsed: false,
            },
          ],
        },
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
    case 'bulkUpdateCriteria': {
      const selected = new Set(action.criterionIds);
      const criteria = state.project.criteria.map((criterion) =>
        selected.has(criterion.id) ? { ...criterion, ...action.patch } : criterion,
      );
      return { ...state, project: { ...state.project, criteria } };
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
    case 'setSelectedSample':
      return { ...state, selectedSampleId: action.sampleId };
    case 'addSample':
      return {
        ...state,
        selectedSampleId: action.sample.id,
        project: { ...state.project, samples: [...state.project.samples, action.sample] },
      };
    case 'replaceProject':
      return {
        ...state,
        project: action.project,
        selectedCriterionId: action.project.criteria[0]?.id ?? '',
        selectedSampleId: action.project.samples[0]?.id ?? '',
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
  const [crashReportingEnabled, setCrashReportingEnabled] = useState(false);
  const [updateChannel, setUpdateChannel] = useState<'stable' | 'beta'>('stable');
  const [telemetryLog, setTelemetryLog] = useState<TelemetryEvent[]>([]);
  const [visualMode, setVisualMode] = useState<VisualMode>('dark');
  const [shortcuts, setShortcuts] = useState<ShortcutRow[]>(readSavedShortcuts);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
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
    const audit = auditStudioActions(shortcuts);
    if (audit.missingShortcutLabels.length > 0 || audit.unknownShortcutLabels.length > 0) {
      setShortcuts(mergeSavedShortcuts(shortcuts));
      return;
    }
    localStorage.setItem('rso:shortcuts', JSON.stringify(shortcuts));
  }, [shortcuts]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editingText =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;
      if (editingText && !event.metaKey && !event.ctrlKey) {
        return;
      }
      const action = actionForShortcut(event, shortcuts);
      if (action) {
        event.preventDefault();
        runStudioAction(action);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcuts, selectedCriterion, state.project, surface]);

  function emit(event: string, payload: TelemetryEvent['payload'] = {}) {
    const telemetryEvent = createTelemetryEvent(event, payload);
    setTelemetryLog((current) => [telemetryEvent, ...current].slice(0, 25));
  }

  function executeCommand(command: string) {
    setPaletteOpen(false);
    setPaletteQuery('');
    setRecentCommands((current) => [command, ...current.filter((item) => item !== command)].slice(0, 6));
    emit('command.executed', { command });
    runStudioAction(command);
  }

  function runStudioAction(action: string) {
    if (action === 'Command palette') setPaletteOpen(true);
    if (action === 'New criterion') dispatch({ type: 'addCriterion', themeId: state.project.themes[0].id });
    if (action === 'New theme') dispatch({ type: 'addTheme' });
    if (action === 'Duplicate criterion' && selectedCriterion) {
      dispatch({ type: 'duplicateCriterion', criterionId: selectedCriterion.id });
    }
    if (action === 'Delete criterion' && selectedCriterion) {
      if (window.confirm(`Delete ${selectedCriterion.label}?`)) {
        dispatch({ type: 'deleteCriterion', criterionId: selectedCriterion.id });
      }
    }
    if (action === 'Save current project') {
      localStorage.setItem('rso:project', JSON.stringify(state.project));
      setToast('Saved current project');
    }
    if (action === 'Quick open' || action === 'Switch to Authoring') setActiveTab('authoring');
    if (action === 'Switch to Preview') setActiveTab('preview');
    if (action === 'Switch to Calibration' || action === 'Open calibration' || action === 'Run bias probes' || action === 'Run contamination audit') setActiveTab('calibration');
    if (action === 'Switch to Diff' || action === 'Open semantic diff' || action === 'Try criterion variant') setActiveTab('diff');
    if (action === 'Switch to Export' || action.startsWith('Export') || action === 'Generate CI helper') setActiveTab('export');
    if (action === 'Switch to Settings' || action === 'Open keyboard shortcuts') setActiveTab('settings');
    if (action === 'Run preview' || action === 'Score current sample' || action === 'Score all samples') runPreview();
    if (action === 'Toggle comments') dispatch({ type: 'toggleComments' });
    if (action === 'Toggle browser constraints') setSurface(surface === 'browser' ? 'desktop' : 'browser');
    if (action === 'Git init') setToast('Initialized local git metadata');
    if (action === 'Git commit') setToast('Committed current rubric snapshot');
    setToast(action);
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
    <main className="app-shell" data-surface={surface} data-theme={visualMode}>
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
          {['File', 'Edit', 'View', 'Rubric', 'Run', 'Tools', 'Help'].map((item) => {
            const MenuIcon = menuIcons[item];
            return (
              <button key={item} className="ghost-button" type="button">
                <MenuIcon className="button-icon" aria-hidden="true" />
                {item}
              </button>
            );
          })}
        </nav>
        <div className="top-actions">
          <BrowserProjectControls
            project={state.project}
            surface={surface}
            onImport={(project) => {
              dispatch({ type: 'replaceProject', project });
              setToast('Imported local project bundle');
            }}
          />
          <button className="glass-button" type="button" onClick={() => setPaletteOpen(true)}>
            <Command className="button-icon" aria-hidden="true" />
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
        <ProjectSidebar
          project={state.project}
          issues={issues.length}
          selectedCriterionId={state.selectedCriterionId}
          onSelect={(criterionId) => dispatch({ type: 'select', criterionId })}
          onRenameCriterion={(criterionId, label) => dispatch({ type: 'updateCriterion', criterionId, patch: { label, id: slugify(label) } })}
          onDuplicateCriterion={(criterionId) => dispatch({ type: 'duplicateCriterion', criterionId })}
          onDeleteCriterion={(criterionId) => dispatch({ type: 'deleteCriterion', criterionId })}
        />
        <section id="main-panel" className="main-panel" role="tabpanel" tabIndex={-1} aria-label={`${activeTab} panel`}>
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
              onBulkUpdate={(criterionIds, patch) => dispatch({ type: 'bulkUpdateCriteria', criterionIds, patch })}
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
              onRun={runPreview}
              onSelectSample={(sampleId) => dispatch({ type: 'setSelectedSample', sampleId })}
              onAddSample={(sample) => {
                dispatch({ type: 'addSample', sample });
                setToast(`Loaded sample ${sample.id}`);
              }}
            />
          ) : null}
          {activeTab === 'calibration' ? (
            <CalibrationPanel project={state.project} calibration={calibration} surface={surface} />
          ) : null}
          {activeTab === 'diff' ? (
            <DiffPanel
              project={state.project}
              diff={diff}
              surface={surface}
              onApplyVariant={(criterionId, patch) => dispatch({ type: 'updateCriterion', criterionId, patch })}
            />
          ) : null}
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
              crashReportingEnabled={crashReportingEnabled}
              setCrashReportingEnabled={setCrashReportingEnabled}
              updateChannel={updateChannel}
              setUpdateChannel={setUpdateChannel}
              telemetryLog={telemetryLog}
              shortcuts={shortcuts}
              visualMode={visualMode}
              setVisualMode={setVisualMode}
              onSetShortcut={(action, shortcut) =>
                setShortcuts((current) =>
                  current.map((row) => (row[1] === action ? [shortcut, action] : row)),
                )
              }
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

      <nav className="tabbar" role="tablist" aria-label="Rubric Studio Open tabs">
        {tabs.map((tab) => {
          const TabIcon = tabIcons[tab.id];
          return (
            <button
              key={tab.id}
              className={tab.id === activeTab ? 'tab active' : 'tab'}
              type="button"
              role="tab"
              aria-selected={tab.id === activeTab}
              aria-controls="main-panel"
              onClick={() => {
                setActiveTab(tab.id);
                emit('tab.opened', { tab: tab.id });
              }}
            >
              <TabIcon className="button-icon" aria-hidden="true" />
              {tab.label}
              <span>{shortcutForAction(shortcuts, tab.action).replace('Cmd/Ctrl-', '')}</span>
            </button>
          );
        })}
      </nav>

      {paletteOpen ? (
        <CommandPalette
          query={paletteQuery}
          setQuery={setPaletteQuery}
          commands={studioActionLabels()}
          recentCommands={recentCommands}
          onClose={() => setPaletteOpen(false)}
          onExecute={executeCommand}
        />
      ) : null}

      {wizardOpen ? (
        <FirstRunWizard
          judges={state.project.judges}
          surface={surface}
          telemetryEnabled={telemetryEnabled}
          crashReportingEnabled={crashReportingEnabled}
          onTelemetryChange={setTelemetryEnabled}
          onCrashReportingChange={setCrashReportingEnabled}
          onSetKey={(judgeId, configured) => dispatch({ type: 'setKeyConfigured', judgeId, configured })}
          onSkip={() => setWizardOpen(false)}
          onStart={acceptWizard}
        />
      ) : null}
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
  onBulkUpdate: (criterionIds: string[], patch: Partial<Criterion>) => void;
  onAdd: (themeId: string) => void;
  onMove: (direction: -1 | 1) => void;
  onToggleTheme: (themeId: string) => void;
}) {
  const { project, criterion, issues } = props;
  const tagOptions = Array.from(new Set(project.criteria.flatMap((item) => item.tags))).sort();
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const bulkSelected = new Set(bulkIds);
  function toggleBulk(criterionId: string) {
    setBulkIds((current) =>
      current.includes(criterionId)
        ? current.filter((id) => id !== criterionId)
        : [...current, criterionId],
    );
  }
  function bulkPatch(patch: Partial<Criterion>) {
    props.onBulkUpdate(bulkIds, patch);
    setBulkIds([]);
  }
  return (
    <div className="panel-grid authoring-grid">
      <section className="glass-panel" aria-label="Criterion tree">
        <div className="panel-title">
          <div>
            <p>Rubric</p>
            <h2>Criterion tree</h2>
          </div>
          <button className="glass-button" type="button" onClick={() => props.onAdd(project.themes[0].id)}>
            <Plus className="button-icon" aria-hidden="true" />
            + Criterion
          </button>
        </div>
        {bulkIds.length > 0 ? (
          <div className="bulk-toolbar" aria-label="Bulk criterion operations">
            <strong>{bulkIds.length} selected</strong>
            <button className="ghost-button" type="button" onClick={() => bulkPatch({ status: 'Live' })}>
              <Sparkles className="button-icon" aria-hidden="true" />
              Mark live
            </button>
            <button className="ghost-button" type="button" onClick={() => bulkPatch({ status: 'Draft' })}>
              <SquarePen className="button-icon" aria-hidden="true" />
              Move to draft
            </button>
            <button className="ghost-button" type="button" onClick={() => bulkPatch({ weight: Number((1 / bulkIds.length).toFixed(2)) })}>
              <SlidersHorizontal className="button-icon" aria-hidden="true" />
              Equal weights
            </button>
          </div>
        ) : null}
        {project.criteria.length === 0 ? (
          <EmptyState title="No criteria yet" body="Create a criterion to start validating the rubric-spec project." />
        ) : (
          project.themes.map((theme) => (
            <div className="theme-block" key={theme.id}>
              <button className="theme-title" type="button" aria-expanded={!theme.collapsed} onClick={() => props.onToggleTheme(theme.id)}>
                {theme.collapsed ? '▸' : '▾'} {theme.label}
              </button>
              {!theme.collapsed
                ? project.criteria
                    .filter((item) => item.themeId === theme.id)
                    .map((item) => (
                      <div className="criterion-row-wrap" key={item.id}>
                        <label className="bulk-check" aria-label={`Select ${item.label} for bulk operations`}>
                          <input
                            type="checkbox"
                            checked={bulkSelected.has(item.id)}
                            onChange={() => toggleBulk(item.id)}
                          />
                        </label>
                        <button
                          draggable
                          className={item.id === criterion.id ? 'criterion-row active' : 'criterion-row'}
                          type="button"
                          aria-current={item.id === criterion.id ? 'true' : undefined}
                          onClick={() => props.onSelect(item.id)}
                        >
                          <span>{item.label}</span>
                          <small>{item.scale}</small>
                          <b>{item.weight.toFixed(2)}</b>
                          <em>{item.status}</em>
                          <span className="tags">{item.tags.join(' ')}</span>
                        </button>
                      </div>
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
            <button className="ghost-button" type="button" aria-label="Move criterion up" onClick={() => props.onMove(-1)}>
              <ArrowUp className="button-icon" aria-hidden="true" />
            </button>
            <button className="ghost-button" type="button" aria-label="Move criterion down" onClick={() => props.onMove(1)}>
              <ArrowDown className="button-icon" aria-hidden="true" />
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
                <Wrench className="button-icon" aria-hidden="true" />
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
            <input list="tag-options" value={criterion.tags.join(', ')} onChange={(event) => props.onUpdate({ tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} />
            <datalist id="tag-options">
              {tagOptions.map((tag) => <option key={tag} value={tag} />)}
            </datalist>
          </Field>
          <Field label="References">
            <textarea value={criterion.references.join('\n')} onChange={(event) => props.onUpdate({ references: event.target.value.split('\n').filter(Boolean) })} />
          </Field>
          <Field label="Sibling links">
            <input list="criterion-ref-options" value={criterion.siblingLinks.join(', ')} onChange={(event) => props.onUpdate({ siblingLinks: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} />
            <datalist id="criterion-ref-options">
              {project.criteria.filter((item) => item.id !== criterion.id).map((item) => <option key={item.id} value={item.id} />)}
            </datalist>
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
              {issue.quickFix ? (
                <button className="ghost-button" type="button">
                  <Wrench className="button-icon" aria-hidden="true" />
                  {issue.quickFix}
                </button>
              ) : null}
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
                <Search className="button-icon" aria-hidden="true" />
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

function CommandPalette(props: {
  query: string;
  setQuery: (value: string) => void;
  commands: string[];
  recentCommands: string[];
  onClose: () => void;
  onExecute: (command: string) => void;
}) {
  const sortedCommands = [
    ...props.recentCommands.filter((command) => props.commands.includes(command)),
    ...props.commands.filter((command) => !props.recentCommands.includes(command)),
  ];
  const filtered = sortedCommands.filter((command) => command.toLowerCase().includes(props.query.toLowerCase()));
  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onClose}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(event) => event.stopPropagation()}>
        <input
          autoFocus
          aria-label="Command search"
          placeholder="Run a command..."
          value={props.query}
          onChange={(event) => props.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              props.onClose();
            }
          }}
        />
        <div>
          {filtered.map((command) => (
            <button key={command} type="button" onClick={() => props.onExecute(command)}>
              <Command className="button-icon" aria-hidden="true" />
              <span>{command}</span>
              <small>{props.recentCommands.includes(command) ? 'Recent' : studioActionCategory(command)}</small>
            </button>
          ))}
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
  return <div className="empty-state" role="status"><strong>{title}</strong><p>{body}</p></div>;
}

function SuccessState({ title, body }: { title: string; body: string }) {
  return <div className="success-state" role="status"><strong>{title}</strong><p>{body}</p></div>;
}

function LoadingState({ label }: { label: string }) {
  return <div className="loading-state" role="status" aria-live="polite"><span /><div><strong>{label}</strong><progress value={66} max={100}>66%</progress></div><button className="ghost-button" type="button">Cancel</button></div>;
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

function readSavedShortcuts(): ShortcutRow[] {
  try {
    const saved = localStorage.getItem('rso:shortcuts');
    if (!saved) {
      return defaultShortcutRows();
    }
    return mergeSavedShortcuts(JSON.parse(saved) as ShortcutRow[]);
  } catch {
    return defaultShortcutRows();
  }
}

function mergeSavedShortcuts(saved: ShortcutRow[]): ShortcutRow[] {
  const savedByAction = new Map(saved.map(([shortcut, action]) => [action, shortcut]));
  return defaultShortcutRows().map(([defaultShortcut, action]) => [
    savedByAction.get(action) ?? defaultShortcut,
    action,
  ]);
}
