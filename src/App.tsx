import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Command,
  Download,
  FileDiff,
  FilePlus2,
  FileText,
  FolderOpen,
  Menu,
  Play,
  Search,
  Settings,
  SlidersHorizontal,
  SquarePen,
  type LucideIcon,
} from 'lucide-react';
import {
  buildEvidencePackageManifest,
  calculateCalibration,
  generateExports,
  projectHealth,
  scoreSamples,
  semanticDiff,
} from './domain/engine';
import {
  createCriterion,
  type JudgeConfig,
  reorderCriteria,
  sampleProject,
  slugify,
  type Criterion,
  type RubricProject,
  type RubricSample,
  type SurfaceMode,
} from './domain/rubric';
import {
  TelemetryEventLog,
  createRubricPlatformTelemetryEvent,
  type TelemetryLogEntry,
} from './domain/platformTelemetry';
import { searchProject, validateProject } from './domain/validation';
import { auditStudioActions, defaultShortcutRows, studioActionCategory, studioActionLabels } from './domain/actions';
import { actionForShortcut, isEditableShortcutTarget, shortcutForAction, type ShortcutRow } from './domain/shortcuts';
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
import { persistProject, persistenceBackendLabel, type ProjectPersistenceReceipt } from './domain/persistence';
import { cloneProject, readLocalCheckpoint, saveLocalCheckpoint } from './domain/checkpoint';
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
import {
  loadRubricRelease,
  RUBRIC_RELEASES_URL,
  type ReleaseAvailability,
} from './domain/releaseManifest';
import { useOverlayFocus } from './components/useOverlayFocus';

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
  | { type: 'setJudgeModel'; judgeId: string; model: string }
  | { type: 'setKeyConfigured'; judgeId: string; configured: boolean }
  | { type: 'updateJudge'; judgeId: string; patch: Partial<Pick<JudgeConfig, 'model' | 'label'>> }
  | { type: 'toggleComments' }
  | { type: 'setSelectedSample'; sampleId: string }
  | { type: 'addSample'; sample: RubricSample }
  | { type: 'replaceSamples'; samples: RubricSample[] }
  | { type: 'replaceProject'; project: RubricProject };

function isHostedPreviewHost() {
  if (typeof window === 'undefined') return false;
  return /(^|\.)rubric-studio\.auraone\.ai$|\.vercel\.app$/.test(window.location.hostname);
}

interface StudioState {
  project: RubricProject;
  selectedCriterionId: string;
  selectedSampleId: string;
}

type AuthoringFocusRequest = { target: 'in-file' | 'project'; nonce: number };
type UpdateChannel = 'stable' | 'beta';
type StudioPreferences = {
  telemetryEnabled: boolean;
  crashReportingEnabled: boolean;
  updateChannel: UpdateChannel;
  visualMode: VisualMode;
  noNetworkMode: boolean;
};
type SaveState = {
  status: 'idle' | 'saving' | 'saved' | 'error';
  message: string;
  receipt: ProjectPersistenceReceipt | null;
};

const tabIcons: Record<Tab, LucideIcon> = {
  authoring: SquarePen,
  preview: Play,
  calibration: SlidersHorizontal,
  diff: FileDiff,
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
    case 'setJudgeModel':
      return {
        ...state,
        project: {
          ...state.project,
          judges: state.project.judges.map((judge) =>
            judge.id === action.judgeId ? { ...judge, model: action.model } : judge,
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
    case 'updateJudge':
      return {
        ...state,
        project: {
          ...state.project,
          judges: state.project.judges.map((judge) =>
            judge.id === action.judgeId ? { ...judge, ...action.patch } : judge,
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
    case 'replaceSamples':
      return {
        ...state,
        selectedSampleId: action.samples.some((sample) => sample.id === state.selectedSampleId)
          ? state.selectedSampleId
          : action.samples[0]?.id ?? '',
        project: { ...state.project, samples: action.samples },
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
  const surfaceParam = new URLSearchParams(window.location.search).get('surface');
  const initialSurface = surfaceParam === 'desktop' ? 'desktop' : surfaceParam === 'browser' || isHostedPreviewHost() ? 'browser' : 'desktop';
  const browserSurfaceLocked = initialSurface === 'browser' && surfaceParam !== 'desktop';
  const [initialProject] = useState(readSavedProject);
  const [initialPreferences] = useState(readSavedPreferences);
  const initialCriterionId =
    initialProject.criteria.find((criterion) => criterion.id === 'cites-uncertainty')?.id ??
    initialProject.criteria[0]?.id ??
    '';
  const [state, dispatch] = useReducer(reducer, {
    project: initialProject,
    selectedCriterionId: initialCriterionId,
    selectedSampleId: initialProject.samples[0]?.id ?? '',
  });
  const [activeTab, setActiveTab] = useState<Tab>('authoring');
  const [projectNavOpen, setProjectNavOpen] = useState(false);
  const [surface, setSurface] = useState<SurfaceMode>(initialSurface);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [wizardOpen, setWizardOpen] = useState(
    () =>
      new URLSearchParams(window.location.search).get('onboarding') === '1' ||
      localStorage.getItem('rso:onboarded') !== 'yes',
  );
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('safety');
  const [regex, setRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [scoreRunning, setScoreRunning] = useState(false);
  const [telemetryEnabled, setTelemetryEnabled] = useState(initialPreferences.telemetryEnabled);
  const [crashReportingEnabled, setCrashReportingEnabled] = useState(initialPreferences.crashReportingEnabled);
  const [updateChannel, setUpdateChannel] = useState<UpdateChannel>(initialPreferences.updateChannel);
  const [platformTelemetryLog] = useState(() => new TelemetryEventLog());
  const [telemetryLog, setTelemetryLog] = useState<TelemetryLogEntry[]>([]);
  const [visualMode, setVisualMode] = useState<VisualMode>(initialPreferences.visualMode);
  const [noNetworkMode, setNoNetworkMode] = useState(initialPreferences.noNetworkMode);
  const [shortcuts, setShortcuts] = useState<ShortcutRow[]>(readSavedShortcuts);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const [toast, setToast] = useState('Ready');
  const [openedProjectPath, setOpenedProjectPath] = useState<string | null>(null);
  const [baselineProject, setBaselineProject] = useState(() => readLocalCheckpoint(initialProject));
  const [scoreResults, setScoreResults] = useState(() =>
    scoreSamples(initialProject, initialProject.samples, initialProject.judges),
  );
  const [saveState, setSaveState] = useState<SaveState>({
    status: 'idle',
    message: `Ready to save in ${persistenceBackendLabel(initialSurface, null)}`,
    receipt: null,
  });
  const [authoringFocusRequest, setAuthoringFocusRequest] = useState<AuthoringFocusRequest | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(readRecentProjects);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [deleteCriterionId, setDeleteCriterionId] = useState<string | null>(null);
  const [activeExportArtifact, setActiveExportArtifact] = useState<string | null>(null);
  const [releaseAvailability, setReleaseAvailability] = useState<ReleaseAvailability>({
    status: 'loading',
    releaseUrl: RUBRIC_RELEASES_URL,
  });
  const selectedCriterion = state.project.criteria.find((criterion) => criterion.id === state.selectedCriterionId);
  const deleteCriterion = state.project.criteria.find((criterion) => criterion.id === deleteCriterionId);
  const selectedSample = state.project.samples.find((sample) => sample.id === state.selectedSampleId) ?? state.project.samples[0];
  const issues = useMemo(() => validateProject(state.project), [state.project]);
  const calibration = useMemo(() => calculateCalibration(state.project, scoreResults), [state.project, scoreResults]);
  const diff = useMemo(() => semanticDiff(state.project, baselineProject), [state.project, baselineProject]);
  const exports = useMemo(() => generateExports(state.project, issues, calibration), [state.project, issues, calibration]);
  const health = useMemo(() => projectHealth(state.project), [state.project]);
  const searchResults = useMemo(
    () => searchProject(state.project, { query: searchQuery, regex, caseSensitive, wholeWord }),
    [state.project, searchQuery, regex, caseSensitive, wholeWord],
  );
  const saveTimer = useRef<number>();
  const saveRequest = useRef(0);
  const scoreTimer = useRef<number>();

  useEffect(() => {
    window.clearTimeout(saveTimer.current);
    const requestId = saveRequest.current + 1;
    saveRequest.current = requestId;
    setSaveState((current) => ({
      ...current,
      status: 'saving',
      message: `Saving to ${persistenceBackendLabel(surface, openedProjectPath)}...`,
    }));
    saveTimer.current = window.setTimeout(() => {
      void persistProject(state.project, surface, openedProjectPath)
        .then((receipt) => {
          if (saveRequest.current !== requestId) return;
          setSaveState({ status: 'saved', message: receipt.message, receipt });
          setToast(receipt.message);
        })
        .catch((error) => {
          if (saveRequest.current !== requestId) return;
          const message = error instanceof Error ? error.message : 'Project autosave failed.';
          setSaveState({ status: 'error', message, receipt: null });
          setToast(message);
        });
    }, 450);
    return () => window.clearTimeout(saveTimer.current);
  }, [state.project, surface, openedProjectPath]);

  useEffect(() => {
    const audit = auditStudioActions(shortcuts);
    if (audit.missingShortcutLabels.length > 0 || audit.unknownShortcutLabels.length > 0) {
      setShortcuts(mergeSavedShortcuts(shortcuts));
      return;
    }
    localStorage.setItem('rso:shortcuts', JSON.stringify(shortcuts));
  }, [shortcuts]);

  useEffect(() => {
    localStorage.setItem('rso:preferences', JSON.stringify({
      telemetryEnabled,
      crashReportingEnabled,
      updateChannel,
      visualMode,
      noNetworkMode,
    }));
  }, [telemetryEnabled, crashReportingEnabled, updateChannel, visualMode, noNetworkMode]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target)) {
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
          installWorkingProject(opened.project, opened.path);
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

  function recordTelemetryEvent(
    event: string,
    payload: Record<string, string | number | boolean> = {},
    options: { recordWhenDisabled?: boolean; optedIn?: boolean } = {},
  ) {
    if (!telemetryEnabled && !options.recordWhenDisabled) {
      return;
    }
    platformTelemetryLog.record(createRubricPlatformTelemetryEvent(event, payload), options.optedIn ?? telemetryEnabled);
    setTelemetryLog([...platformTelemetryLog.list()].slice(-25).reverse());
  }

  function emit(event: string, payload: Record<string, string | number | boolean> = {}) {
    recordTelemetryEvent(event, payload);
  }

  function setTelemetryPreference(enabled: boolean) {
    setTelemetryEnabled(enabled);
    if (enabled && !telemetryEnabled) {
      recordTelemetryEvent('telemetry.opted_in', { surface }, { recordWhenDisabled: true, optedIn: true });
    }
    if (!enabled && telemetryEnabled) {
      recordTelemetryEvent('telemetry.opted_out', { surface }, { recordWhenDisabled: true, optedIn: false });
    }
  }

  function executeCommand(command: string) {
    setPaletteOpen(false);
    setPaletteQuery('');
    setRecentCommands((current) => [command, ...current.filter((item) => item !== command)].slice(0, 6));
    emit('command.executed', { command });
    runStudioAction(command);
  }

  function installWorkingProject(project: RubricProject, path: string | null, useStoredCheckpoint = true) {
    dispatch({ type: 'replaceProject', project });
    setOpenedProjectPath(path);
    setBaselineProject(useStoredCheckpoint ? readLocalCheckpoint(project) : cloneProject(project));
    setScoreResults(scoreSamples(project, project.samples, project.judges));
  }

  async function saveProjectNow(): Promise<ProjectPersistenceReceipt> {
    window.clearTimeout(saveTimer.current);
    const requestId = saveRequest.current + 1;
    saveRequest.current = requestId;
    setSaveState({
      status: 'saving',
      message: `Saving to ${persistenceBackendLabel(surface, openedProjectPath)}...`,
      receipt: null,
    });
    try {
      const receipt = await persistProject(state.project, surface, openedProjectPath);
      if (saveRequest.current === requestId) {
        setSaveState({ status: 'saved', message: receipt.message, receipt });
        setToast(receipt.message);
      }
      return receipt;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Project save failed.';
      if (saveRequest.current === requestId) {
        setSaveState({ status: 'error', message, receipt: null });
        setToast(message);
      }
      throw error;
    }
  }

  async function saveComparisonCheckpoint(): Promise<string> {
    const receipt = await saveProjectNow();
    const checkpoint = saveLocalCheckpoint(state.project);
    setBaselineProject(checkpoint.project);
    return `Saved local comparison checkpoint at ${formatShortTime(checkpoint.savedAt)} via ${receipt.backend}.`;
  }

  function restoreComparisonCheckpoint() {
    const checkpoint = readLocalCheckpoint(baselineProject);
    dispatch({ type: 'replaceProject', project: checkpoint });
    setBaselineProject(cloneProject(checkpoint));
    setScoreResults(scoreSamples(checkpoint, checkpoint.samples, checkpoint.judges));
  }

  function runStudioAction(action: string) {
    let useDefaultToast = true;
    if (action === 'Command palette') setPaletteOpen(true);
    if (action === 'Start guided tour') {
      setWizardOpen(true);
      setToast('Guided tour ready');
      useDefaultToast = false;
    }
    if (action === 'New criterion') dispatch({ type: 'addCriterion', themeId: state.project.themes[0].id });
    if (action === 'New theme') dispatch({ type: 'addTheme' });
    if (action === 'Duplicate criterion' && selectedCriterion) {
      dispatch({ type: 'duplicateCriterion', criterionId: selectedCriterion.id });
    }
    if (action === 'Delete criterion' && selectedCriterion) {
      setDeleteCriterionId(selectedCriterion.id);
    }
    if (action === 'Save current project') {
      void saveProjectNow();
      useDefaultToast = false;
    }
    if (action === 'New project from template') setTemplateDialogOpen(true);
    if (action === 'Quick open') {
      void openProjectPicker();
      useDefaultToast = false;
    }
    if (action === 'Find in current criterion') {
      setActiveTab('authoring');
      setAuthoringFocusRequest({ target: 'in-file', nonce: Date.now() });
    }
    if (action === 'Find across project') {
      setActiveTab('authoring');
      setAuthoringFocusRequest({ target: 'project', nonce: Date.now() });
    }
    if (action === 'Switch to Authoring') setActiveTab('authoring');
    if (action === 'Switch to Preview') setActiveTab('preview');
    if (action === 'Switch to Calibration' || action === 'Open calibration' || action === 'Run bias probes' || action === 'Run contamination audit') setActiveTab('calibration');
    if (action === 'Switch to Diff' || action === 'Open semantic diff' || action === 'Try criterion variant') setActiveTab('diff');
    if (action === 'Switch to Export' || action.startsWith('Export') || action === 'Generate CI helper') {
      setActiveTab('export');
      setActiveExportArtifact(exportArtifactForAction(action));
    }
    if (action === 'Switch to Settings' || action === 'Open keyboard shortcuts') setActiveTab('settings');
    if (action === 'Run preview' || action === 'Score current sample' || action === 'Score all samples') runPreview();
    if (action === 'Toggle comments') dispatch({ type: 'toggleComments' });
    if (action === 'Toggle browser constraints') {
      if (browserSurfaceLocked) {
        setSurface('browser');
        setToast('Browser edition keeps desktop-only features disabled.');
        return;
      }
      setSurface(surface === 'browser' ? 'desktop' : 'browser');
      setToast(surface === 'browser' ? 'Desktop capabilities enabled' : 'Browser constraints enabled');
      useDefaultToast = false;
    }
    if (action === 'Create local checkpoint') {
      void saveComparisonCheckpoint().then(setToast).catch(() => undefined);
      useDefaultToast = false;
    }
    if (action === 'Restore local checkpoint') {
      restoreComparisonCheckpoint();
      setToast('Restored the working draft from the local comparison checkpoint.');
      useDefaultToast = false;
    }
    if (useDefaultToast) {
      setToast(action);
    }
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
      const project = cloneProject({ ...sampleProject, id: slugify(name), name });
      installWorkingProject(project, null, false);
      setActiveTab('authoring');
      setToast('Created browser starter project in local storage');
      return;
    }
    try {
      const opened = await createRubricProjectFromTemplate(name);
      if (!opened) {
        return;
      }
      installWorkingProject(opened.project, opened.path, false);
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
      installWorkingProject(opened.project, opened.path);
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
    window.clearTimeout(scoreTimer.current);
    setActiveTab('preview');
    setScoreRunning(true);
    emit('preview.score.started', { surface, item_count: state.project.samples.length });
    const nextResults = scoreSamples(state.project, state.project.samples, state.project.judges);
    scoreTimer.current = window.setTimeout(() => {
      setScoreResults(nextResults);
      setScoreRunning(false);
      setToast(`Recomputed ${nextResults.length} deterministic local fixture scores`);
    }, 650);
  }

  async function checkDesktopRelease() {
    if (noNetworkMode) {
      setReleaseAvailability({
        status: 'unavailable',
        releaseUrl: RUBRIC_RELEASES_URL,
        reason: 'No-network mode is active.',
      });
      return;
    }
    setToast('Checking verified desktop release metadata');
    const availability = await loadRubricRelease();
    setReleaseAvailability(availability);
    setToast(
      availability.status === 'available'
        ? `Verified Rubric Studio Open ${availability.manifest.version}`
        : 'Verified desktop release metadata is unavailable',
    );
  }

  function cancelPreviewRun() {
    window.clearTimeout(scoreTimer.current);
    setScoreRunning(false);
    setToast('Score run canceled');
  }

  function acceptWizard() {
    localStorage.setItem('rso:onboarded', 'yes');
    setWizardOpen(false);
    setTourStep(0);
    setToast('Guided tour started');
  }

  function skipWizard() {
    localStorage.setItem('rso:onboarded', 'yes');
    setWizardOpen(false);
    setToast('First-run wizard dismissed');
  }

  function finishTour() {
    setTourStep(null);
    setActiveTab('authoring');
    setToast('Tour completed');
  }

  return (
    <main
      className="app-shell aura-ide-root pl-root"
      data-surface={surface}
      data-theme={visualMode}
      data-pl-theme={visualMode === 'high-contrast' ? 'high-contrast' : 'light'}
      data-tab={activeTab}
    >
      <a className="skip-link" href="#main-panel">
        Skip to editor
      </a>
      <header className="topbar" role="banner">
        <div className="brand">
          <button
            className="ghost-button icon-only project-nav-trigger"
            type="button"
            aria-label="Open project navigation"
            aria-expanded={projectNavOpen}
            onClick={() => setProjectNavOpen(true)}
          >
            <Menu className="button-icon" aria-hidden="true" />
          </button>
          <span className="app-icon" aria-hidden="true">
            <img className="app-logo" src="/favicon.svg" alt="" />
          </span>
          <div>
            <h1>Rubric Studio</h1>
            <p>AuraOne Open</p>
          </div>
        </div>
        <button
          className="project-crumb"
          type="button"
          aria-label="Current project"
          onClick={() => setProjectNavOpen(true)}
        >
          <span className="project-crumb-label">Project</span>
          <strong>{state.project.name}</strong>
          <em>v{state.project.version}</em>
        </button>
        <nav className="tabbar" role="tablist" aria-label="Rubric Studio Open tabs" tabIndex={0}>
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
                  setProjectNavOpen(false);
                  emit('tab.opened', { tab: tab.id });
                }}
              >
                <TabIcon className="button-icon" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="top-actions">
          <button
            className="ghost-button icon-only studio-search"
            type="button"
            aria-label="Search criteria, samples, and commands"
            title="Search criteria, samples, and commands (Command-K)"
            onClick={() => setPaletteOpen(true)}
          >
            <Search className="button-icon" aria-hidden="true" />
          </button>
          <div className="readiness-pill" aria-label={`Project readiness ${health.readiness}%`}>
            <progress aria-hidden="true" max={100} value={health.readiness} />
            <strong>{health.readiness}%</strong><small>ready</small>
          </div>
          <span className={`save-readout ${saveState.status}`} role="status" aria-live="polite" title={saveState.message}>
            <i aria-hidden="true" />
            {saveState.status === 'saving' ? 'Saving' : saveState.status === 'error' ? 'Save failed' : 'Saved'}
          </span>
          {surface === 'browser' && releaseAvailability.status === 'available' ? (
            <a
              className="preview-download-link"
              href={releaseAvailability.artifact.url}
              title={`Verified ${releaseAvailability.artifact.format} for Rubric Studio Open ${releaseAvailability.manifest.version}`}
              target="_blank"
              rel="noreferrer"
            >
              <Download className="button-icon" aria-hidden="true" />
              Download {releaseAvailability.manifest.version}
            </a>
          ) : surface === 'browser' && releaseAvailability.status === 'loading' ? (
            <button
              className="preview-download-link secondary"
              type="button"
              disabled={noNetworkMode}
              title={noNetworkMode ? 'No-network mode is active' : 'Fetch verified release metadata'}
              onClick={() => void checkDesktopRelease()}
            >
              <Download className="button-icon" aria-hidden="true" />
              {noNetworkMode ? 'Offline' : 'Check desktop release'}
            </button>
          ) : surface === 'browser' && releaseAvailability.status === 'unavailable' ? (
            <a
              className="preview-download-link secondary"
              href={releaseAvailability.releaseUrl}
              title={releaseAvailability.reason}
              target="_blank"
              rel="noreferrer"
            >
              <Download className="button-icon" aria-hidden="true" />
              View releases
            </a>
          ) : null}
          {surface === 'desktop' ? (
            <>
              <button className="solid-button" type="button" aria-label="Open project folder" onClick={() => void openProjectPicker()}>
                <FolderOpen className="button-icon" aria-hidden="true" />
                <span>Open</span>
              </button>
              <button className="solid-button" type="button" aria-label="New from Template" onClick={() => setTemplateDialogOpen(true)}>
                <FilePlus2 className="button-icon" aria-hidden="true" />
                <span>New</span>
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
          ) : (
            <button className="solid-button" type="button" aria-label="New from Template" onClick={() => setTemplateDialogOpen(true)}>
              <FilePlus2 className="button-icon" aria-hidden="true" />
              <span>New</span>
            </button>
          )}
          <span className="sync-readout">
            <i />
            {saveState.message}
          </span>
          <span className="user-token" aria-hidden="true">e</span>
          <BrowserProjectControls
            project={state.project}
            surface={surface}
            persistenceMessage={saveState.message}
            onStatus={(message, isError = false) => {
              setToast(message);
              if (isError) {
                setSaveState({ status: 'error', message, receipt: null });
              }
            }}
            onImport={(project) => {
              installWorkingProject(project, null, false);
              setToast('Imported local project bundle');
            }}
          />
          <label className="switch">
            <span>Browser constraints</span>
            <input
              type="checkbox"
              checked={surface === 'browser'}
              disabled={browserSurfaceLocked}
              onChange={(event) => {
                if (browserSurfaceLocked) {
                  setSurface('browser');
                  setToast('Browser edition keeps desktop-only features disabled.');
                  return;
                }
                setSurface(event.target.checked ? 'browser' : 'desktop');
              }}
            />
          </label>
        </div>
      </header>

      <div className="workspace">
        <ProjectSidebar
          open={projectNavOpen}
          onClose={() => setProjectNavOpen(false)}
          project={state.project}
          issues={issues.length}
          projectPath={openedProjectPath}
          selectedCriterionId={state.selectedCriterionId}
          onSelect={(criterionId) => {
            dispatch({ type: 'select', criterionId });
            setProjectNavOpen(false);
          }}
          onRenameCriterion={(criterionId, label) => dispatch({ type: 'updateCriterion', criterionId, patch: { label, id: slugify(label) } })}
          onDuplicateCriterion={(criterionId) => dispatch({ type: 'duplicateCriterion', criterionId })}
          onDeleteCriterion={(criterionId) => setDeleteCriterionId(criterionId)}
          onNewCriterion={(themeId) => dispatch({ type: 'addCriterion', themeId })}
          onOpenContainingFolder={(path, label) => void openSidebarPath(path, label, 'containing')}
          onRevealInFileManager={(path, label) => void openSidebarPath(path, label, 'reveal')}
        />
        {projectNavOpen ? (
          <button
            className="project-drawer-scrim"
            type="button"
            aria-label="Close project navigation"
            onClick={() => setProjectNavOpen(false)}
          />
        ) : null}
        <section id="main-panel" className="main-panel" data-tab={activeTab} role="tabpanel" tabIndex={-1} aria-label={`${activeTab} panel`}>
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
              focusRequest={authoringFocusRequest}
              commentsVisible={state.project.commentsVisible}
              onSelect={(criterionId) => dispatch({ type: 'select', criterionId })}
              onUpdate={(patch) => dispatch({ type: 'updateCriterion', criterionId: selectedCriterion.id, patch })}
              onBulkUpdate={(criterionIds, patch) => dispatch({ type: 'bulkUpdateCriteria', criterionIds, patch })}
              onBulkDelete={(criterionIds) => dispatch({ type: 'bulkDeleteCriteria', criterionIds })}
              onAdd={(themeId) => dispatch({ type: 'addCriterion', themeId })}
              onDuplicate={(criterionId) => dispatch({ type: 'duplicateCriterion', criterionId })}
              onCompare={() => setActiveTab('diff')}
              onMove={(direction) => dispatch({ type: 'moveCriterion', criterionId: selectedCriterion.id, direction })}
              onReorder={(draggedId, targetId) => dispatch({ type: 'reorderCriterion', draggedId, targetId })}
              onToggleTheme={(themeId) => dispatch({ type: 'toggleTheme', themeId })}
              onToggleComments={() => dispatch({ type: 'toggleComments' })}
              saveStatus={saveState.message}
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
              noNetworkMode={noNetworkMode}
              onRun={runPreview}
              onCancelRun={cancelPreviewRun}
              onOpenSettings={() => setActiveTab('settings')}
              onSelectSample={(sampleId) => dispatch({ type: 'setSelectedSample', sampleId })}
              onAddSample={(sample) => {
                dispatch({ type: 'addSample', sample });
                setToast(`Loaded sample ${sample.id}`);
              }}
            />
          ) : null}
          {activeTab === 'calibration' ? (
            <CalibrationPanel
              project={state.project}
              calibration={calibration}
              onReplaceSamples={(samples) => {
                const project = { ...state.project, samples };
                dispatch({ type: 'replaceSamples', samples });
                setScoreResults(scoreSamples(project, samples, project.judges));
              }}
            />
          ) : null}
          {activeTab === 'diff' ? (
            <DiffPanel
              project={state.project}
              diff={diff}
              onApplyVariant={(criterionId, patch) => dispatch({ type: 'updateCriterion', criterionId, patch })}
              onSaveCheckpoint={saveComparisonCheckpoint}
              onRestoreCheckpoint={restoreComparisonCheckpoint}
            />
          ) : null}
          {activeTab === 'export' ? (
            <ExportPanel
              project={state.project}
              exports={exports}
              evidenceManifest={buildEvidencePackageManifest(state.project)}
              surface={surface}
              activeArtifact={activeExportArtifact}
              validationIssueCount={issues.length}
              validationErrorCount={issues.filter((issue) => issue.severity === 'error').length}
            />
          ) : null}
          {activeTab === 'settings' ? (
            <SettingsPanel
              project={state.project}
              surface={surface}
              openedProjectPath={openedProjectPath}
              telemetryEnabled={telemetryEnabled}
              setTelemetryEnabled={setTelemetryPreference}
              crashReportingEnabled={crashReportingEnabled}
              setCrashReportingEnabled={setCrashReportingEnabled}
              updateChannel={updateChannel}
              setUpdateChannel={setUpdateChannel}
              noNetworkMode={noNetworkMode}
              setNoNetworkMode={setNoNetworkMode}
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
              onUpdateJudge={(judgeId, patch) => dispatch({ type: 'updateJudge', judgeId, patch })}
            />
          ) : null}
        </section>
      </div>

      <footer className="statusbar" role="contentinfo" aria-live="polite">
        <div>
          <strong>{issues.length}</strong> issues · {health.issueCounts.error} errors · {health.issueCounts.warning} warnings · readiness {health.readiness}%
        </div>
        <div>
          {openedProjectPath ? `Folder: ${openedProjectPath}` : `Persistence: ${persistenceBackendLabel(surface, openedProjectPath)}`} ·
          {' '}{noNetworkMode ? 'network blocked' : 'network available'} · updates {updateChannel} · {toast}
        </div>
      </footer>

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
          onTelemetryChange={setTelemetryPreference}
          onCrashReportingChange={setCrashReportingEnabled}
          onSetKey={(judgeId, configured) => dispatch({ type: 'setKeyConfigured', judgeId, configured })}
          onUpdateJudge={(judgeId, patch) => dispatch({ type: 'updateJudge', judgeId, patch })}
          onSkip={skipWizard}
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
  const dialogRef = useOverlayFocus<HTMLElement>({
    open: true,
    onClose: props.onClose,
    initialFocus: '.tour-card .primary',
  });
  return (
    <div className="modal-backdrop tour-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        onKeyDown={(event) => {
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
          <button className="solid-button primary" type="button" onClick={isLast ? props.onClose : props.onNext}>
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
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useOverlayFocus<HTMLElement>({
    open: true,
    onClose: props.onClose,
    initialFocus: '[aria-label="Command search"]',
  });
  const sortedCommands = [
    ...props.recentCommands.filter((command) => props.commands.includes(command)),
    ...props.commands.filter((command) => !props.recentCommands.includes(command)),
  ];
  const filtered = sortedCommands.filter((command) => command.toLowerCase().includes(props.query.toLowerCase()));
  const boundedActiveIndex = filtered.length === 0 ? -1 : Math.min(activeIndex, filtered.length - 1);

  useEffect(() => {
    setActiveIndex(0);
  }, [props.query]);

  useEffect(() => {
    if (activeIndex !== boundedActiveIndex && boundedActiveIndex >= 0) {
      setActiveIndex(boundedActiveIndex);
    }
  }, [activeIndex, boundedActiveIndex]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onClose}>
      <section ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(event) => event.stopPropagation()}>
        <input
          aria-label="Command search"
          aria-controls="command-palette-options"
          placeholder="Run a command..."
          value={props.query}
          onChange={(event) => props.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((current) => (filtered.length === 0 ? 0 : (current + 1) % filtered.length));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((current) => (filtered.length === 0 ? 0 : (current - 1 + filtered.length) % filtered.length));
            }
            if (event.key === 'Home') {
              event.preventDefault();
              setActiveIndex(0);
            }
            if (event.key === 'End') {
              event.preventDefault();
              setActiveIndex(Math.max(0, filtered.length - 1));
            }
            if (event.key === 'Enter' && boundedActiveIndex >= 0) {
              event.preventDefault();
              props.onExecute(filtered[boundedActiveIndex]);
            }
          }}
        />
        <div id="command-palette-options" aria-label="Command palette results">
          {filtered.map((command, index) => (
            <button
              id={`command-option-${index}`}
              key={command}
              className={index === boundedActiveIndex ? 'active' : ''}
              type="button"
              aria-current={index === boundedActiveIndex ? 'true' : undefined}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => props.onExecute(command)}
            >
              <Command className="button-icon" aria-hidden="true" />
              <span>{command}</span>
              <small>{props.recentCommands.includes(command) ? 'Recent' : studioActionCategory(command)}</small>
            </button>
          ))}
          {filtered.length === 0 ? <p className="subtle">No commands match this search.</p> : null}
        </div>
      </section>
    </div>
  );
}

function readSavedProject(): RubricProject {
  try {
    const saved = localStorage.getItem('rso:project');
    return saved ? migrateProjectDefaults(JSON.parse(saved) as RubricProject) : sampleProject;
  } catch {
    return sampleProject;
  }
}

function migrateProjectDefaults(project: RubricProject): RubricProject {
  const latestRemoteJudges = new Map(sampleProject.judges.filter((judge) => judge.provider !== 'mock' && judge.provider !== 'ollama').map((judge) => [judge.provider, judge]));
  const legacyDefaultModels = new Set([
    'gpt-5-mini',
    'gpt-5.2',
    'claude-sonnet-4.6',
    'claude-opus-4-1-20250805',
    'gemini-2.5-flash',
    'gemini-3-pro-preview',
  ]);
  const legacyDefaultIds = new Set(['gpt-5-mini', 'claude-sonnet', 'gemini-flash']);
  const projectJudges = project.judges.map((judge) => {
    const latest = latestRemoteJudges.get(judge.provider as 'openai' | 'anthropic' | 'google');
    if (!latest || judge.model === latest.model) {
      return judge;
    }
    if (!legacyDefaultModels.has(judge.model) && !legacyDefaultIds.has(judge.id)) {
      return judge;
    }
    return { ...judge, id: latest.id, label: latest.label, model: latest.model };
  });
  const seenProviders = new Set(projectJudges.map((judge) => judge.provider));
  const missingLatestJudges = sampleProject.judges.filter((judge) => !seenProviders.has(judge.provider));
  return { ...project, judges: [...projectJudges, ...missingLatestJudges] };
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

function readSavedPreferences(): StudioPreferences {
  const defaults: StudioPreferences = {
    telemetryEnabled: false,
    crashReportingEnabled: false,
    updateChannel: 'stable',
    visualMode: 'light',
    noNetworkMode: false,
  };
  try {
    const saved = localStorage.getItem('rso:preferences');
    if (!saved) {
      return defaults;
    }
    const parsed = JSON.parse(saved) as Partial<StudioPreferences>;
    return {
      telemetryEnabled: parsed.telemetryEnabled === true,
      crashReportingEnabled: parsed.crashReportingEnabled === true,
      updateChannel: parsed.updateChannel === 'beta' ? 'beta' : 'stable',
      visualMode: parsed.visualMode === 'high-contrast' ? 'high-contrast' : 'light',
      noNetworkMode: parsed.noNetworkMode === true,
    };
  } catch {
    return defaults;
  }
}

function mergeSavedShortcuts(saved: ShortcutRow[]): ShortcutRow[] {
  const savedByAction = new Map(saved.map(([shortcut, action]) => [action, shortcut]));
  return defaultShortcutRows().map(([defaultShortcut, action]) => [
    savedByAction.get(action) ?? defaultShortcut,
    action,
  ]);
}

function exportArtifactForAction(action: string): string | null {
  const artifacts: Record<string, string> = {
    'Export: lm-eval-harness': 'lm-eval-harness.yaml',
    'Export: Inspect': 'inspect-task.py',
    'Export: OpenAI Evals': 'openai-evals.yaml',
    'Export: Promptfoo': 'promptfoo.yaml',
    'Export: local evidence package': 'evidence-package',
    'Generate CI helper': '.github/workflows/rubric.yml',
  };
  return artifacts[action] ?? null;
}

function formatShortTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
