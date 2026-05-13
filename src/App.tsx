import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Command,
  FilePlus2,
  FileText,
  FolderOpen,
  GitCompare,
  Play,
  Settings,
  SlidersHorizontal,
  SquarePen,
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
  reorderCriteria,
  sampleProject,
  slugify,
  type Criterion,
  type RubricProject,
  type RubricSample,
  type SurfaceMode,
  type TelemetryEvent,
} from './domain/rubric';
import { searchProject, validateProject } from './domain/validation';
import { auditStudioActions, defaultShortcutRows, studioActionCategory, studioActionLabels } from './domain/actions';
import { actionForShortcut, shortcutForAction, type ShortcutRow } from './domain/shortcuts';
import { classifyDeepLink, connectDesktopDeepLinks } from './domain/deepLink';
import { tabs, tourSteps, type Tab, type TourStep } from './domain/navigation';
import {
  connectProjectDrop,
  createRubricProjectFromTemplate,
  defaultTemplateProjectName,
  openRubricProjectPath,
  pickRubricProjectFolder,
  readRecentProjects,
  revealProjectPath,
  type RecentProject,
} from './domain/projectOpen';
import { ProjectSidebar } from './components/ProjectSidebar';
import { BrowserProjectControls } from './components/BrowserProjectControls';
import { PreviewPanel } from './components/PreviewPanel';
import { SettingsPanel, type VisualMode } from './components/SettingsPanel';
import { DiffPanel } from './components/DiffPanel';
import { CalibrationPanel } from './components/CalibrationPanel';
import { ExportPanel } from './components/ExportPanel';
import { FirstRunWizard } from './components/FirstRunWizard';
import { AuthoringPanel } from './components/AuthoringPanel';
import { DeleteCriterionDialog, TemplateProjectDialog } from './components/StudioDialogs';
import { ApplicationMenu } from './components/ApplicationMenu';

type Action =
  | { type: 'select'; criterionId: string }
  | { type: 'updateCriterion'; criterionId: string; patch: Partial<Criterion> }
  | { type: 'addCriterion'; themeId: string }
  | { type: 'addTheme' }
  | { type: 'duplicateCriterion'; criterionId: string }
  | { type: 'deleteCriterion'; criterionId: string }
  | { type: 'bulkUpdateCriteria'; criterionIds: string[]; patch: Partial<Criterion> }
  | { type: 'bulkDeleteCriteria'; criterionIds: string[] }
  | { type: 'reorderCriterion'; draggedId: string; targetId: string }
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
    case 'bulkDeleteCriteria': {
      const selected = new Set(action.criterionIds);
      const criteria = state.project.criteria.filter((criterion) => !selected.has(criterion.id));
      return {
        ...state,
        selectedCriterionId: selected.has(state.selectedCriterionId)
          ? criteria[0]?.id ?? ''
          : state.selectedCriterionId,
        project: { ...state.project, criteria },
      };
    }
    case 'reorderCriterion': {
      const criteria = reorderCriteria(state.project.criteria, action.draggedId, action.targetId);
      if (criteria === state.project.criteria) {
        return state;
      }
      return {
        ...state,
        selectedCriterionId: action.draggedId,
        project: {
          ...state.project,
          criteria,
        },
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
  const [initialProject] = useState(readSavedProject);
  const [state, dispatch] = useReducer(reducer, {
    project: initialProject,
    selectedCriterionId: initialProject.criteria[0]?.id ?? '',
    selectedSampleId: initialProject.samples[0]?.id ?? '',
  });
  const [activeTab, setActiveTab] = useState<Tab>('authoring');
  const [surface, setSurface] = useState<SurfaceMode>(initialSurface);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [wizardOpen, setWizardOpen] = useState(() => localStorage.getItem('rso:onboarded') !== 'yes');
  const [tourStep, setTourStep] = useState<number | null>(null);
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
  const [openedProjectPath, setOpenedProjectPath] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(readRecentProjects);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [deleteCriterionId, setDeleteCriterionId] = useState<string | null>(null);
  const selectedCriterion = state.project.criteria.find((criterion) => criterion.id === state.selectedCriterionId);
  const deleteCriterion = state.project.criteria.find((criterion) => criterion.id === deleteCriterionId);
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

  useEffect(() => {
    if (tourStep !== null) {
      setActiveTab(tourSteps[tourStep].tab);
    }
  }, [tourStep]);

  useEffect(() => {
    if (surface !== 'desktop') {
      return undefined;
    }

    let active = true;
    let unlisten: (() => void) | undefined;

    void connectDesktopDeepLinks(
      async (payload) => {
        const target = classifyDeepLink(payload);
        if (target.kind === 'install') {
          window.open(target.installUrl, '_blank', 'noopener,noreferrer');
          setToast(`Opening install page for ${target.flagship}`);
          return;
        }
        if (target.kind === 'ignored-flagship') {
          setToast(`Ignored deep link for ${target.flagship}`);
          return;
        }
        if (target.kind === 'unsupported-action') {
          setToast(`Unsupported deep-link action: ${target.action}`);
          return;
        }

        try {
          const opened = await openRubricProjectPath(target.path);
          if (!active) {
            return;
          }
          dispatch({ type: 'replaceProject', project: opened.project });
          setOpenedProjectPath(opened.path);
          setRecentProjects(readRecentProjects());
          setActiveTab('authoring');
          setToast(`Opened ${opened.project.name} from deep link`);
        } catch (error) {
          if (active) {
            setToast(error instanceof Error ? error.message : 'Deep-link project open failed');
          }
        }
      },
      (message) => setToast(message),
    ).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, [surface]);

  useEffect(() => {
    if (surface !== 'desktop') {
      return undefined;
    }

    let active = true;
    let unlisten: (() => void) | undefined;
    void connectProjectDrop(
      async (path) => {
        await openProjectPath(path, 'drop');
      },
      (message) => setToast(message),
    ).then((cleanup) => {
      if (active) {
        unlisten = cleanup;
      } else {
        cleanup();
      }
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, [surface]);

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
      setDeleteCriterionId(selectedCriterion.id);
    }
    if (action === 'Save current project') {
      localStorage.setItem('rso:project', JSON.stringify(state.project));
      setToast('Saved current project');
    }
    if (action === 'New project from template') setTemplateDialogOpen(true);
    if (action === 'Quick open') void openProjectPicker();
    if (action === 'Switch to Authoring') setActiveTab('authoring');
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

  async function openProjectPicker() {
    if (surface === 'browser') {
      setToast('Browser edition imports project JSON only; desktop opens folders.');
      return;
    }
    try {
      const path = await pickRubricProjectFolder();
      if (path) {
        await openProjectPath(path, 'picker');
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Project folder picker failed');
    }
  }

  async function createProjectFromTemplate(name: string) {
    setTemplateDialogOpen(false);
    if (surface === 'browser') {
      dispatch({ type: 'replaceProject', project: { ...sampleProject, id: slugify(name), name } });
      setOpenedProjectPath(null);
      setActiveTab('authoring');
      setToast('Created browser starter project in local storage');
      return;
    }
    try {
      const opened = await createRubricProjectFromTemplate(name);
      if (!opened) {
        return;
      }
      dispatch({ type: 'replaceProject', project: opened.project });
      setOpenedProjectPath(opened.path);
      setRecentProjects(readRecentProjects());
      setActiveTab('authoring');
      setToast(`Created ${opened.project.name} from starter template`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Starter project could not be created');
    }
  }

  async function openProjectPath(path: string, source: 'picker' | 'recent' | 'drop') {
    try {
      const opened = await openRubricProjectPath(path);
      dispatch({ type: 'replaceProject', project: opened.project });
      setOpenedProjectPath(opened.path);
      setRecentProjects(readRecentProjects());
      setActiveTab('authoring');
      const sourceLabel = source === 'drop' ? 'drop' : source === 'recent' ? 'recent project' : 'folder picker';
      setToast(`Opened ${opened.project.name} from ${sourceLabel}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : `Could not open ${path}`);
    }
  }

  async function openSidebarPath(path: string | null, label: string, mode: 'containing' | 'reveal') {
    if (!path || surface === 'browser') {
      setToast('Browser edition does not expose system file-manager actions.');
      return;
    }
    try {
      await revealProjectPath(path, mode);
      setToast(mode === 'reveal' ? `Revealed ${label}` : `Opened containing folder for ${label}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : `Could not open ${label}`);
    }
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
    setTourStep(0);
    setToast('Guided tour started');
  }

  function finishTour() {
    setTourStep(null);
    setActiveTab('authoring');
    setToast('Tour completed');
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
        <ApplicationMenu shortcuts={shortcuts} onExecute={executeCommand} />
        <div className="top-actions">
          <button className="glass-button" type="button" onClick={() => setTemplateDialogOpen(true)}>
            <FilePlus2 className="button-icon" aria-hidden="true" />
            New from Template
          </button>
          {surface === 'desktop' ? (
            <>
              <button className="glass-button" type="button" onClick={() => void openProjectPicker()}>
                <FolderOpen className="button-icon" aria-hidden="true" />
                Open Folder
              </button>
              <label className="recent-picker">
                <span>Recent</span>
                <select
                  aria-label="Open recent project"
                  value=""
                  onChange={(event) => {
                    if (event.target.value) {
                      void openProjectPath(event.target.value, 'recent');
                    }
                  }}
                >
                  <option value="">Open recent project</option>
                  {recentProjects.map((project) => (
                    <option key={project.path} value={project.path}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          <BrowserProjectControls
            project={state.project}
            surface={surface}
            onImport={(project) => {
              dispatch({ type: 'replaceProject', project });
              setOpenedProjectPath(null);
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
          projectPath={openedProjectPath}
          selectedCriterionId={state.selectedCriterionId}
          onSelect={(criterionId) => dispatch({ type: 'select', criterionId })}
          onRenameCriterion={(criterionId, label) => dispatch({ type: 'updateCriterion', criterionId, patch: { label, id: slugify(label) } })}
          onDuplicateCriterion={(criterionId) => dispatch({ type: 'duplicateCriterion', criterionId })}
          onDeleteCriterion={(criterionId) => setDeleteCriterionId(criterionId)}
          onNewCriterion={(themeId) => dispatch({ type: 'addCriterion', themeId })}
          onOpenContainingFolder={(path, label) => void openSidebarPath(path, label, 'containing')}
          onRevealInFileManager={(path, label) => void openSidebarPath(path, label, 'reveal')}
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
              onBulkDelete={(criterionIds) => dispatch({ type: 'bulkDeleteCriteria', criterionIds })}
              onAdd={(themeId) => dispatch({ type: 'addCriterion', themeId })}
              onMove={(direction) => dispatch({ type: 'moveCriterion', criterionId: selectedCriterion.id, direction })}
              onReorder={(draggedId, targetId) => dispatch({ type: 'reorderCriterion', draggedId, targetId })}
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
        <div>Git: {state.project.branch} · {openedProjectPath ? `folder ${openedProjectPath}` : 'sync local'} · {toast}</div>
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

      {tourStep !== null ? (
        <OnboardingTour
          step={tourStep}
          total={tourSteps.length}
          tourStep={tourSteps[tourStep]}
          onPrevious={() => setTourStep((current) => (current === null ? null : Math.max(0, current - 1)))}
          onNext={() => setTourStep((current) => (current === null ? null : Math.min(tourSteps.length - 1, current + 1)))}
          onClose={finishTour}
        />
      ) : null}

      {templateDialogOpen ? (
        <TemplateProjectDialog
          initialName={defaultTemplateProjectName()}
          onCancel={() => setTemplateDialogOpen(false)}
          onCreate={(name) => void createProjectFromTemplate(name)}
        />
      ) : null}

      {deleteCriterion ? (
        <DeleteCriterionDialog
          criterion={deleteCriterion}
          onCancel={() => setDeleteCriterionId(null)}
          onDelete={() => {
            dispatch({ type: 'deleteCriterion', criterionId: deleteCriterion.id });
            setDeleteCriterionId(null);
            setToast(`Deleted ${deleteCriterion.label}`);
          }}
        />
      ) : null}
    </main>
  );
}

function OnboardingTour(props: {
  step: number;
  total: number;
  tourStep: TourStep;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const isLast = props.step === props.total - 1;
  return (
    <div className="modal-backdrop tour-backdrop" role="presentation">
      <section
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        onKeyDown={(event) => {
          if (event.key === 'Escape') props.onClose();
          if (event.key === 'ArrowLeft') props.onPrevious();
          if (event.key === 'ArrowRight') {
            if (isLast) props.onClose();
            else props.onNext();
          }
        }}
      >
        <div
          className="tour-progress"
          role="progressbar"
          aria-label="Guided tour progress"
          aria-valuemin={1}
          aria-valuemax={props.total}
          aria-valuenow={props.step + 1}
        >
          {Array.from({ length: props.total }, (_, index) => (
            <span key={index} className={index === props.step ? 'active' : ''} />
          ))}
        </div>
        <p className="eyebrow">Guided tour</p>
        <h2 id="tour-title">{props.tourStep.title}</h2>
        <p id="tour-body">{props.tourStep.body}</p>
        <div className="callout">
          <strong>Outcome</strong>
          <p>{props.tourStep.outcome}</p>
        </div>
        <div className="inline-actions">
          <button className="ghost-button" type="button" onClick={props.onClose}>
            Skip tour
          </button>
          <button className="ghost-button" type="button" disabled={props.step === 0} onClick={props.onPrevious}>
            Back
          </button>
          <button className="glass-button primary" type="button" onClick={isLast ? props.onClose : props.onNext}>
            {isLast ? 'Finish tour' : 'Next'}
          </button>
        </div>
      </section>
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
