import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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
import type { GitOperation } from './domain/git';
import { htmlLangForLocale, normalizeLocale, studioMessages, type LocaleCode, type StudioMessages } from './domain/i18n';
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
  saveRubricProjectPath,
  type RecentProject,
} from './domain/projectOpen';
import { runNativeScoreRun, type NativeScoreRunReceipt } from './domain/nativeScoring';
import { buildQuickOpenItems, filterQuickOpenItems, type QuickOpenItem } from './domain/quickOpen';
import { stageCriterionRewrite, type CriterionRewriteSuggestion } from './domain/advancedCalibration';
import { ProjectSidebar } from './components/ProjectSidebar';
import { BrowserProjectControls } from './components/BrowserProjectControls';
import { PreviewPanel } from './components/PreviewPanel';
import { SettingsPanel, type VisualMode } from './components/SettingsPanel';
import { DiffPanel } from './components/DiffPanel';
import { CalibrationPanel, type CalibrationOperation } from './components/CalibrationPanel';
import { ExportPanel } from './components/ExportPanel';
import { FirstRunWizard } from './components/FirstRunWizard';
import { AuthoringPanel } from './components/AuthoringPanel';
import { DeleteCriterionDialog, TemplateProjectDialog } from './components/StudioDialogs';
import { ApplicationMenu } from './components/ApplicationMenu';
import { RubricStudioMark } from './components/RubricStudioMark';
import type { SampleActionRequest } from './components/SampleControls';
import { useDialogFocusTrap } from './components/useDialogFocusTrap';

type Action =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'select'; criterionId: string }
  | { type: 'updateCriterion'; criterionId: string; patch: Partial<Criterion> }
  | { type: 'addCriterion'; themeId: string }
  | { type: 'addTheme' }
  | { type: 'duplicateCriterion'; criterionId: string }
  | { type: 'deleteCriterion'; criterionId: string }
  | { type: 'bulkUpdateCriteria'; criterionIds: string[]; patch: Partial<Criterion> }
  | { type: 'bulkDeleteCriteria'; criterionIds: string[] }
  | { type: 'stageCriterionRewrite'; suggestion: CriterionRewriteSuggestion }
  | { type: 'reorderCriterion'; draggedId: string; targetId: string }
  | { type: 'toggleTheme'; themeId: string }
  | { type: 'moveCriterion'; criterionId: string; direction: -1 | 1 }
  | { type: 'toggleJudge'; judgeId: string }
  | { type: 'setKeyConfigured'; judgeId: string; configured: boolean }
  | { type: 'toggleComments' }
  | { type: 'setSelectedSample'; sampleId: string }
  | { type: 'addSample'; sample: RubricSample }
  | { type: 'loadGoldSamples'; samples: RubricSample[] }
  | { type: 'replaceProject'; project: RubricProject };

interface ProjectSnapshot {
  project: RubricProject;
  selectedCriterionId: string;
  selectedSampleId: string;
}

interface StudioState extends ProjectSnapshot {
  undoStack: ProjectSnapshot[];
  redoStack: ProjectSnapshot[];
}

type AuthoringFocusRequest = { target: 'in-file' | 'project'; nonce: number };
type GitOperationRequest = { operation: GitOperation; nonce: number };
type CalibrationOperationRequest = { operation: CalibrationOperation; nonce: number };
type VariantOperationRequest = { nonce: number };
type DiffOverlayOperationRequest = { nonce: number };
type ScoreRunScope = 'current' | 'all';
type UpdateChannel = 'stable' | 'beta';
type StudioPreferences = {
  telemetryEnabled: boolean;
  crashReportingEnabled: boolean;
  updateChannel: UpdateChannel;
  visualMode: VisualMode;
  noNetworkMode: boolean;
  locale: LocaleCode;
};

const tabIcons: Record<Tab, LucideIcon> = {
  authoring: SquarePen,
  preview: Play,
  calibration: SlidersHorizontal,
  diff: GitCompare,
  export: FileText,
  settings: Settings,
};

const HISTORY_LIMIT = 40;

function snapshotState(state: ProjectSnapshot): ProjectSnapshot {
  return {
    project: state.project,
    selectedCriterionId: state.selectedCriterionId,
    selectedSampleId: state.selectedSampleId,
  };
}

function withUndo(state: StudioState, next: StudioState): StudioState {
  if (
    next.project === state.project &&
    next.selectedCriterionId === state.selectedCriterionId &&
    next.selectedSampleId === state.selectedSampleId
  ) {
    return state;
  }

  return {
    ...next,
    undoStack: [...state.undoStack.slice(-(HISTORY_LIMIT - 1)), snapshotState(state)],
    redoStack: [],
  };
}

function restoreSnapshot(
  state: StudioState,
  snapshot: ProjectSnapshot,
  history: Pick<StudioState, 'undoStack' | 'redoStack'>,
): StudioState {
  return {
    ...state,
    ...snapshot,
    ...history,
  };
}

function reducer(state: StudioState, action: Action): StudioState {
  switch (action.type) {
    case 'undo': {
      const previous = state.undoStack[state.undoStack.length - 1];
      if (!previous) {
        return state;
      }
      return restoreSnapshot(state, previous, {
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [snapshotState(state), ...state.redoStack].slice(0, HISTORY_LIMIT),
      });
    }
    case 'redo': {
      const next = state.redoStack[0];
      if (!next) {
        return state;
      }
      return restoreSnapshot(state, next, {
        undoStack: [...state.undoStack.slice(-(HISTORY_LIMIT - 1)), snapshotState(state)],
        redoStack: state.redoStack.slice(1),
      });
    }
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
      return withUndo(state, { ...state, selectedCriterionId, project: { ...state.project, criteria } });
    }
    case 'addCriterion': {
      const criterion = createCriterion(action.themeId, state.project.criteria.length + 1);
      return withUndo(state, {
        ...state,
        selectedCriterionId: criterion.id,
        project: { ...state.project, criteria: [...state.project.criteria, criterion] },
      });
    }
    case 'addTheme': {
      const id = `theme-${state.project.themes.length + 1}`;
      return withUndo(state, {
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
      });
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
      return withUndo(state, {
        ...state,
        selectedCriterionId: copy.id,
        project: { ...state.project, criteria: [...state.project.criteria, copy] },
      });
    }
    case 'deleteCriterion': {
      const criteria = state.project.criteria.filter((criterion) => criterion.id !== action.criterionId);
      return withUndo(state, {
        ...state,
        selectedCriterionId: criteria[0]?.id ?? '',
        project: { ...state.project, criteria },
      });
    }
    case 'bulkUpdateCriteria': {
      const selected = new Set(action.criterionIds);
      const criteria = state.project.criteria.map((criterion) =>
        selected.has(criterion.id) ? { ...criterion, ...action.patch } : criterion,
      );
      return withUndo(state, { ...state, project: { ...state.project, criteria } });
    }
    case 'bulkDeleteCriteria': {
      const selected = new Set(action.criterionIds);
      const criteria = state.project.criteria.filter((criterion) => !selected.has(criterion.id));
      return withUndo(state, {
        ...state,
        selectedCriterionId: selected.has(state.selectedCriterionId)
          ? criteria[0]?.id ?? ''
          : state.selectedCriterionId,
        project: { ...state.project, criteria },
      });
    }
    case 'stageCriterionRewrite': {
      const project = stageCriterionRewrite(state.project, action.suggestion);
      if (project === state.project) {
        return state;
      }
      return withUndo(state, {
        ...state,
        selectedCriterionId: action.suggestion.criterionId,
        project,
      });
    }
    case 'reorderCriterion': {
      const criteria = reorderCriteria(state.project.criteria, action.draggedId, action.targetId);
      if (criteria === state.project.criteria) {
        return state;
      }
      return withUndo(state, {
        ...state,
        selectedCriterionId: action.draggedId,
        project: {
          ...state.project,
          criteria,
        },
      });
    }
    case 'toggleTheme':
      return withUndo(state, {
        ...state,
        project: {
          ...state.project,
          themes: state.project.themes.map((theme) =>
            theme.id === action.themeId ? { ...theme, collapsed: !theme.collapsed } : theme,
          ),
        },
      });
    case 'moveCriterion': {
      const index = state.project.criteria.findIndex((criterion) => criterion.id === action.criterionId);
      const nextIndex = index + action.direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= state.project.criteria.length) {
        return state;
      }
      const criteria = [...state.project.criteria];
      [criteria[index], criteria[nextIndex]] = [criteria[nextIndex], criteria[index]];
      return withUndo(state, { ...state, project: { ...state.project, criteria } });
    }
    case 'toggleJudge':
      return withUndo(state, {
        ...state,
        project: {
          ...state.project,
          judges: state.project.judges.map((judge) =>
            judge.id === action.judgeId ? { ...judge, enabled: !judge.enabled } : judge,
          ),
        },
      });
    case 'setKeyConfigured':
      return withUndo(state, {
        ...state,
        project: {
          ...state.project,
          judges: state.project.judges.map((judge) =>
            judge.id === action.judgeId ? { ...judge, keyConfigured: action.configured } : judge,
          ),
        },
      });
    case 'toggleComments':
      return withUndo(state, {
        ...state,
        project: { ...state.project, commentsVisible: !state.project.commentsVisible },
      });
    case 'setSelectedSample':
      return { ...state, selectedSampleId: action.sampleId };
    case 'addSample':
      return withUndo(state, {
        ...state,
        selectedSampleId: action.sample.id,
        project: { ...state.project, samples: [...state.project.samples, action.sample] },
      });
    case 'loadGoldSamples': {
      if (action.samples.length === 0) {
        return state;
      }
      const importedIds = new Set(action.samples.map((sample) => sample.id));
      const samples = [
        ...state.project.samples.filter((sample) => !importedIds.has(sample.id)),
        ...action.samples,
      ];
      return withUndo(state, {
        ...state,
        selectedSampleId: action.samples[0].id,
        project: { ...state.project, samples },
      });
    }
    case 'replaceProject':
      return {
        ...state,
        project: action.project,
        selectedCriterionId: action.project.criteria[0]?.id ?? '',
        selectedSampleId: action.project.samples[0]?.id ?? '',
        undoStack: [],
        redoStack: [],
      };
    default:
      return state;
  }
}

export function App() {
  const initialSurface = new URLSearchParams(window.location.search).get('surface') === 'browser' ? 'browser' : 'desktop';
  const browserSurfaceLocked = initialSurface === 'browser';
  const [initialProject] = useState(readSavedProject);
  const [initialPreferences] = useState(readSavedPreferences);
  const [baselineProject, setBaselineProject] = useState(initialProject);
  const [state, dispatch] = useReducer(reducer, {
    project: initialProject,
    selectedCriterionId: initialProject.criteria[0]?.id ?? '',
    selectedSampleId: initialProject.samples[0]?.id ?? '',
    undoStack: [],
    redoStack: [],
  });
  const [activeTab, setActiveTab] = useState<Tab>('authoring');
  const [surface, setSurface] = useState<SurfaceMode>(initialSurface);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState('');
  const [wizardOpen, setWizardOpen] = useState(() => localStorage.getItem('rso:onboarded') !== 'yes');
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('safety');
  const [regex, setRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [scoreRunning, setScoreRunning] = useState(false);
  const [scoreRunScope, setScoreRunScope] = useState<ScoreRunScope>('all');
  const [nativeScoreRun, setNativeScoreRun] = useState<NativeScoreRunReceipt | null>(null);
  const [telemetryEnabled, setTelemetryEnabled] = useState(initialPreferences.telemetryEnabled);
  const [crashReportingEnabled, setCrashReportingEnabled] = useState(initialPreferences.crashReportingEnabled);
  const [updateChannel, setUpdateChannel] = useState<UpdateChannel>(initialPreferences.updateChannel);
  const [telemetryLog, setTelemetryLog] = useState<TelemetryEvent[]>([]);
  const [visualMode, setVisualMode] = useState<VisualMode>(initialPreferences.visualMode);
  const [noNetworkMode, setNoNetworkMode] = useState(initialPreferences.noNetworkMode);
  const [locale, setLocale] = useState<LocaleCode>(initialPreferences.locale);
  const [shortcuts, setShortcuts] = useState<ShortcutRow[]>(readSavedShortcuts);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const [toast, setToast] = useState('Saved');
  const [openedProjectPath, setOpenedProjectPath] = useState<string | null>(null);
  const [authoringFocusRequest, setAuthoringFocusRequest] = useState<AuthoringFocusRequest | null>(null);
  const [sampleActionRequest, setSampleActionRequest] = useState<SampleActionRequest | null>(null);
  const [gitOperationRequest, setGitOperationRequest] = useState<GitOperationRequest | null>(null);
  const [calibrationOperationRequest, setCalibrationOperationRequest] = useState<CalibrationOperationRequest | null>(null);
  const [variantOperationRequest, setVariantOperationRequest] = useState<VariantOperationRequest | null>(null);
  const [diffOverlayOperationRequest, setDiffOverlayOperationRequest] = useState<DiffOverlayOperationRequest | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(readRecentProjects);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [deleteCriterionId, setDeleteCriterionId] = useState<string | null>(null);
  const [activeExportArtifact, setActiveExportArtifact] = useState<string | null>(null);
  const selectedCriterion = state.project.criteria.find((criterion) => criterion.id === state.selectedCriterionId);
  const deleteCriterion = state.project.criteria.find((criterion) => criterion.id === deleteCriterionId);
  const selectedSample = state.project.samples.find((sample) => sample.id === state.selectedSampleId) ?? state.project.samples[0];
  const issues = useMemo(() => validateProject(state.project), [state.project]);
  const scoreResults = useMemo(() => scoreSamples(state.project, state.project.samples, state.project.judges), [state.project]);
  const calibration = useMemo(() => calculateCalibration(state.project, scoreResults), [state.project, scoreResults]);
  const diff = useMemo(() => semanticDiff(state.project), [state.project]);
  const exports = useMemo(() => generateExports(state.project, issues, calibration), [state.project, issues, calibration]);
  const quickOpenItems = useMemo(
    () => buildQuickOpenItems({
      project: state.project,
      exports,
      recentProjects,
      surface,
      openedProjectPath,
    }),
    [state.project, exports, recentProjects, surface, openedProjectPath],
  );
  const health = useMemo(() => projectHealth(state.project), [state.project]);
  const searchResults = useMemo(
    () => searchProject(state.project, { query: searchQuery, regex, caseSensitive, wholeWord }),
    [state.project, searchQuery, regex, caseSensitive, wholeWord],
  );
  const saveTimer = useRef<number>();
  const scoreTimer = useRef<number>();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const messages = studioMessages[locale];

  useEffect(() => {
    let cancelled = false;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      localStorage.setItem('rso:project', JSON.stringify(state.project));
      if (surface === 'desktop' && openedProjectPath) {
        void saveRubricProjectPath(openedProjectPath, state.project)
          .then((opened) => {
            if (!cancelled && opened) {
              setRecentProjects(readRecentProjects());
              setToast(`Autosaved to ${opened.path}`);
            }
          })
          .catch((error) => {
            if (!cancelled) {
              setToast(error instanceof Error ? `Autosave failed: ${error.message}` : 'Autosave failed');
            }
        });
        return;
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(saveTimer.current);
    };
  }, [openedProjectPath, state.project, surface]);

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
      locale,
    }));
  }, [telemetryEnabled, crashReportingEnabled, updateChannel, visualMode, noNetworkMode, locale]);

  useEffect(() => {
    document.documentElement.lang = htmlLangForLocale(locale);
  }, [locale]);

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
  }, [shortcuts, selectedCriterion, state.project, state.undoStack.length, state.redoStack.length, surface]);

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
          setBaselineProject(opened.project);
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

  function recordTelemetryEvent(event: string, payload: TelemetryEvent['payload'] = {}) {
    const telemetryEvent = createTelemetryEvent(event, payload);
    setTelemetryLog((current) => [telemetryEvent, ...current].slice(0, 25));
  }

  function emit(event: string, payload: TelemetryEvent['payload'] = {}) {
    if (!telemetryEnabled) {
      return;
    }
    recordTelemetryEvent(event, payload);
  }

  function setTelemetryPreference(enabled: boolean) {
    setTelemetryEnabled(enabled);
    if (enabled && !telemetryEnabled) {
      recordTelemetryEvent('telemetry.opted_in', { surface });
    }
    if (!enabled && telemetryEnabled) {
      recordTelemetryEvent('telemetry.opted_out', { surface });
    }
  }

  function executeCommand(command: string) {
    setPaletteOpen(false);
    setPaletteQuery('');
    setRecentCommands((current) => [command, ...current.filter((item) => item !== command)].slice(0, 6));
    emit('command.executed', { command });
    runStudioAction(command);
  }

  function runStudioAction(action: string) {
    let useDefaultToast = true;
    if (action === 'Command palette') setPaletteOpen(true);
    if (action === 'Undo') {
      if (state.undoStack.length === 0) {
        setToast('Nothing to undo');
      } else {
        dispatch({ type: 'undo' });
        setToast('Undid last project edit');
      }
      useDefaultToast = false;
    }
    if (action === 'Redo') {
      if (state.redoStack.length === 0) {
        setToast('Nothing to redo');
      } else {
        dispatch({ type: 'redo' });
        setToast('Redid last project edit');
      }
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
      localStorage.setItem('rso:project', JSON.stringify(state.project));
      setToast('Saved current project');
      useDefaultToast = false;
    }
    if (action === 'New project from template') setTemplateDialogOpen(true);
    if (action === 'Quick open') {
      setQuickOpen(true);
      setQuickOpenQuery('');
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
    if (action === 'Switch to Calibration' || action === 'Open calibration') setActiveTab('calibration');
    const calibrationOperation = calibrationOperationForAction(action);
    if (calibrationOperation) {
      setActiveTab('calibration');
      if (surface === 'browser') {
        setToast('Browser edition disables Python sidecars; open desktop to run calibration checks.');
      } else {
        setCalibrationOperationRequest({ operation: calibrationOperation, nonce: Date.now() });
        setToast(action);
      }
      useDefaultToast = false;
    }
    if (action === 'Switch to Diff' || action === 'Open semantic diff') setActiveTab('diff');
    if (action === 'Run diff overlay') {
      setActiveTab('diff');
      setDiffOverlayOperationRequest({ nonce: Date.now() });
      setToast('Ran held-out diff overlay');
      useDefaultToast = false;
    }
    if (action === 'Try criterion variant') {
      setActiveTab('diff');
      setVariantOperationRequest({ nonce: Date.now() });
      setToast('Started criterion variant branch');
      useDefaultToast = false;
    }
    if (action === 'Switch to Export' || action.startsWith('Export') || action.startsWith('Generate ')) {
      setActiveTab('export');
      setActiveExportArtifact(exportArtifactForAction(action));
    }
    if (action === 'Switch to Settings' || action === 'Open keyboard shortcuts') setActiveTab('settings');
    if (action === 'Load JSONL samples') {
      setActiveTab('preview');
      setSampleActionRequest({ action: 'load-jsonl', nonce: Date.now() });
      setToast('Focused JSONL sample loader');
      useDefaultToast = false;
    }
    if (action === 'Paste scratch sample') {
      setActiveTab('preview');
      setSampleActionRequest({ action: 'paste-sample', nonce: Date.now() });
      setToast('Focused scratch sample editor');
      useDefaultToast = false;
    }
    if (action === 'Generate test sample') {
      setActiveTab('preview');
      setSampleActionRequest({ action: 'generate-synthetic', nonce: Date.now() });
      setToast('Generated synthetic test sample');
      useDefaultToast = false;
    }
    if (action === 'Run preview' || action === 'Score current sample') void runPreview('current');
    if (action === 'Score all samples') void runPreview('all');
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
    const gitOperation = gitOperationForAction(action);
    if (gitOperation) {
      setActiveTab('diff');
      setGitOperationRequest({ operation: gitOperation, nonce: Date.now() });
      setToast(
        surface === 'browser'
          ? gitOperation === 'commit'
            ? 'Browser edition previews git actions; open desktop to commit.'
            : gitOperation === 'init'
              ? 'Browser edition previews git actions; open desktop to initialize git.'
            : 'Browser edition previews git actions; open desktop for local git operations.'
          : action,
      );
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

  function selectQuickOpenItem(item: QuickOpenItem) {
    setQuickOpen(false);
    setQuickOpenQuery('');
    if (item.kind === 'project-folder') {
      if (surface === 'browser') {
        setToast('Browser edition imports project JSON from the browser project controls.');
        return;
      }
      void openProjectPicker();
      return;
    }
    if (item.kind === 'recent-project' && item.path) {
      if (surface === 'browser') {
        setToast('Browser edition cannot open recent desktop folders.');
        return;
      }
      void openProjectPath(item.path, 'recent');
      return;
    }
    if (item.kind === 'criterion' && item.targetId) {
      dispatch({ type: 'select', criterionId: item.targetId });
      setActiveTab('authoring');
      setToast(`Opened ${item.path}`);
      return;
    }
    if (item.kind === 'theme') {
      setActiveTab('authoring');
      setToast(`Opened ${item.path}`);
      return;
    }
    if (item.kind === 'sample' && item.targetId) {
      dispatch({ type: 'setSelectedSample', sampleId: item.targetId });
      setActiveTab('preview');
      setToast(`Opened ${item.path}`);
      return;
    }
    if (item.kind === 'judge') {
      setActiveTab('settings');
      setToast(`Opened ${item.path}`);
      return;
    }
    if (item.kind === 'export') {
      setActiveTab('export');
      setActiveExportArtifact(item.artifactName ?? null);
      setToast(`Opened ${item.path}`);
      return;
    }
    if (item.kind === 'git') {
      setActiveTab('diff');
      setToast(`Opened ${item.path}`);
    }
  }

  async function createProjectFromTemplate(name: string) {
    setTemplateDialogOpen(false);
    if (surface === 'browser') {
      const project = { ...sampleProject, id: slugify(name), name };
      dispatch({ type: 'replaceProject', project });
      setBaselineProject(project);
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
      setBaselineProject(opened.project);
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
      setBaselineProject(opened.project);
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

  async function runPreview(scope: ScoreRunScope = 'all') {
    window.clearTimeout(scoreTimer.current);
    setActiveTab('preview');
    setScoreRunScope(scope);
    setScoreRunning(true);
    const runSamples =
      scope === 'current'
        ? selectedSample
          ? [selectedSample]
          : []
        : state.project.samples;
    emit('preview.score.started', { surface, scope, sample_count: runSamples.length });
    try {
      const receipt = await runNativeScoreRun(surface, state.project, runSamples);
      setNativeScoreRun(receipt);
      if (receipt) {
        emit('preview.score.native_core', {
          mode: receipt.mode,
          scope,
          result_count: receipt.results.length,
          score_update_events: receipt.scoreUpdateEvents,
        });
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Native score run failed');
    }
    scoreTimer.current = window.setTimeout(() => {
      setScoreRunning(false);
      setToast(scope === 'current' ? 'Current sample score run completed' : 'All samples score run completed');
    }, 650);
  }

  function cancelPreviewRun() {
    window.clearTimeout(scoreTimer.current);
    setScoreRunning(false);
    setToast('Score run canceled');
  }

  function stageCalibrationRewrite(suggestion: CriterionRewriteSuggestion) {
    dispatch({ type: 'stageCriterionRewrite', suggestion });
    setActiveTab('authoring');
    setToast('Staged rewrite in the criterion editor');
  }

  function focusAndOpenTab(tabId: Tab) {
    setActiveTab(tabId);
    emit('tab.opened', { tab: tabId, source: 'keyboard' });
    window.requestAnimationFrame(() => tabRefs.current[tabId]?.focus());
  }

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, currentTabId: Tab) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const currentIndex = tabs.findIndex((tab) => tab.id === currentTabId);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : event.key === 'ArrowRight'
            ? (currentIndex + 1) % tabs.length
            : (currentIndex - 1 + tabs.length) % tabs.length;
    focusAndOpenTab(tabs[nextIndex].id);
  }

  function acceptWizard() {
    localStorage.setItem('rso:onboarded', 'yes');
    setWizardOpen(false);
    setTourStep(0);
    setToast('Guided tour started');
  }

  function scoreFirstRunSample() {
    localStorage.setItem('rso:onboarded', 'yes');
    setWizardOpen(false);
    setTourStep(null);
    void runPreview('current');
    setToast('Scoring first-run sample');
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
    <main className="app-shell studio-shell" data-surface={surface} data-theme={visualMode} data-locale={locale}>
      <a className="skip-link" href="#main-panel">
        {messages.skipToEditor}
      </a>
      <header className="topbar" role="banner">
        <div className="brand">
          <span className="app-icon" aria-hidden="true">
            <RubricStudioMark size={38} />
          </span>
          <div>
            <h1>Rubric Studio Open</h1>
            <p>{surface === 'browser' ? 'Browser preview' : 'Desktop IDE'}</p>
          </div>
        </div>
        <ApplicationMenu shortcuts={shortcuts} onExecute={executeCommand} />
        <div className="top-actions">
          <button className="glass-button" type="button" onClick={() => setTemplateDialogOpen(true)}>
            <FilePlus2 className="button-icon" aria-hidden="true" />
            {messages.newFromTemplate}
          </button>
          {surface === 'desktop' ? (
            <>
              <button className="glass-button" type="button" onClick={() => void openProjectPicker()}>
                <FolderOpen className="button-icon" aria-hidden="true" />
                {messages.openFolder}
              </button>
              <label className="recent-picker">
                <span>{messages.recent}</span>
                <select
                  aria-label={messages.openRecentProject}
                  value=""
                  onChange={(event) => {
                    if (event.target.value) {
                      void openProjectPath(event.target.value, 'recent');
                    }
                  }}
                >
                  <option value="">{messages.openRecentProject}</option>
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
              setBaselineProject(project);
              setOpenedProjectPath(null);
              setToast('Imported local project bundle');
            }}
          />
          <button className="glass-button" type="button" onClick={() => setPaletteOpen(true)}>
            <Command className="button-icon" aria-hidden="true" />
            {messages.commandShortcut}
          </button>
          <label className="switch">
            <span>{messages.browserConstraints}</span>
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
        <section
          id="main-panel"
          className="main-panel workbench"
          role="tabpanel"
          tabIndex={-1}
          aria-label={messages.panelLabel(messages.tabs[activeTab])}
        >
          {activeTab === 'authoring' && selectedCriterion ? (
            <AuthoringPanel
              project={state.project}
              criterion={selectedCriterion}
              issues={issues.filter((issue) => !issue.criterionId || issue.criterionId === selectedCriterion.id)}
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
              onMove={(direction) => dispatch({ type: 'moveCriterion', criterionId: selectedCriterion.id, direction })}
              onReorder={(draggedId, targetId) => dispatch({ type: 'reorderCriterion', draggedId, targetId })}
              onToggleTheme={(themeId) => dispatch({ type: 'toggleTheme', themeId })}
              onToggleComments={() => dispatch({ type: 'toggleComments' })}
            />
          ) : null}
          {activeTab === 'preview' ? (
            <PreviewPanel
              project={state.project}
              selectedSampleId={state.selectedSampleId}
              selectedSample={selectedSample}
              results={scoreResults}
              nativeScoreRun={nativeScoreRun}
              running={scoreRunning}
              runningScope={scoreRunScope}
              surface={surface}
              noNetworkMode={noNetworkMode}
              sampleActionRequest={sampleActionRequest}
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
              surface={surface}
              operationRequest={calibrationOperationRequest}
              onStageCriterionRewrite={stageCalibrationRewrite}
              onLoadGoldSamples={(samples) => {
                dispatch({ type: 'loadGoldSamples', samples });
                setToast(`Loaded ${samples.length} expert-scored gold rows`);
              }}
            />
          ) : null}
          {activeTab === 'diff' ? (
            <DiffPanel
              project={state.project}
              projectPath={openedProjectPath}
              baselineProject={baselineProject}
              diff={diff}
              surface={surface}
              gitOperationRequest={gitOperationRequest}
              variantOperationRequest={variantOperationRequest}
              diffOverlayOperationRequest={diffOverlayOperationRequest}
              onApplyVariant={(criterionId, patch) => dispatch({ type: 'updateCriterion', criterionId, patch })}
            />
          ) : null}
          {activeTab === 'export' ? (
            <ExportPanel
              project={state.project}
              exports={exports}
              intakeManifest={buildIntakePackageManifest(state.project)}
              surface={surface}
              activeArtifact={activeExportArtifact}
            />
          ) : null}
          {activeTab === 'settings' ? (
            <SettingsPanel
              project={state.project}
              surface={surface}
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
              locale={locale}
              setLocale={setLocale}
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
          <strong>{issues.length}</strong> {messages.status.issues} · {health.issueCounts.error} {messages.status.errors} · {health.issueCounts.warning} {messages.status.warnings} · {messages.status.readiness} {health.readiness}%
        </div>
        <div>{messages.status.git}: {state.project.branch} · {openedProjectPath ? `folder ${openedProjectPath}` : messages.status.syncLocal} · {toast}</div>
      </footer>

      <nav className="tabbar" role="tablist" aria-label={messages.tabsLabel}>
        {tabs.map((tab) => {
          const TabIcon = tabIcons[tab.id];
          return (
            <button
              ref={(button) => {
                tabRefs.current[tab.id] = button;
              }}
              key={tab.id}
              className={tab.id === activeTab ? 'tab active' : 'tab'}
              type="button"
              role="tab"
              aria-selected={tab.id === activeTab}
              aria-controls="main-panel"
              tabIndex={tab.id === activeTab ? 0 : -1}
              onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
              onClick={() => {
                setActiveTab(tab.id);
                emit('tab.opened', { tab: tab.id });
              }}
            >
              <TabIcon className="button-icon" aria-hidden="true" />
              {messages.tabs[tab.id]}
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
          messages={messages.commandPalette}
          onClose={() => setPaletteOpen(false)}
          onExecute={executeCommand}
        />
      ) : null}

      {quickOpen ? (
        <QuickOpenDialog
          query={quickOpenQuery}
          setQuery={setQuickOpenQuery}
          items={quickOpenItems}
          onClose={() => setQuickOpen(false)}
          onOpen={selectQuickOpenItem}
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
          onSkip={skipWizard}
          onStart={acceptWizard}
          onScoreSample={scoreFirstRunSample}
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
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocusTrap(dialogRef);

  return (
    <div className="modal-backdrop tour-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
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
  messages: StudioMessages['commandPalette'];
  onClose: () => void;
  onExecute: (command: string) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLElement | null>(null);
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
  useDialogFocusTrap(dialogRef);

  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onClose}>
      <section ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(event) => event.stopPropagation()}>
        <input
          autoFocus
          aria-label={props.messages.searchLabel}
          aria-controls="command-palette-options"
          placeholder={props.messages.placeholder}
          value={props.query}
          onChange={(event) => props.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              props.onClose();
            }
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
              <small>{props.recentCommands.includes(command) ? props.messages.recent : studioActionCategory(command)}</small>
            </button>
          ))}
          {filtered.length === 0 ? <p className="subtle">{props.messages.noMatches}</p> : null}
        </div>
      </section>
    </div>
  );
}

function QuickOpenDialog(props: {
  query: string;
  setQuery: (value: string) => void;
  items: QuickOpenItem[];
  onClose: () => void;
  onOpen: (item: QuickOpenItem) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLElement | null>(null);
  const filtered = filterQuickOpenItems(props.items, props.query);
  const boundedActiveIndex = filtered.length === 0 ? -1 : Math.min(activeIndex, filtered.length - 1);

  useEffect(() => {
    setActiveIndex(0);
  }, [props.query]);

  useEffect(() => {
    if (activeIndex !== boundedActiveIndex && boundedActiveIndex >= 0) {
      setActiveIndex(boundedActiveIndex);
    }
  }, [activeIndex, boundedActiveIndex]);
  useDialogFocusTrap(dialogRef);

  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onClose}>
      <section
        ref={dialogRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Quick open"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          aria-label="Quick open search"
          aria-controls="quick-open-options"
          placeholder="Open criteria, samples, judges, exports, or project files..."
          value={props.query}
          onChange={(event) => props.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              props.onClose();
            }
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
              props.onOpen(filtered[boundedActiveIndex]);
            }
          }}
        />
        <div id="quick-open-options" aria-label="Quick open results">
          {filtered.map((item, index) => (
            <button
              id={`quick-open-option-${index}`}
              key={item.id}
              className={index === boundedActiveIndex ? 'active' : ''}
              type="button"
              aria-current={index === boundedActiveIndex ? 'true' : undefined}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => props.onOpen(item)}
            >
              {item.kind === 'project-folder' || item.kind === 'recent-project' ? (
                <FolderOpen className="button-icon" aria-hidden="true" />
              ) : (
                <FileText className="button-icon" aria-hidden="true" />
              )}
              <span>{item.label}</span>
              <small>{item.path} · {item.detail}</small>
            </button>
          ))}
          {filtered.length === 0 ? <p className="subtle">No project file matches.</p> : null}
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

function readSavedPreferences(): StudioPreferences {
  const defaults: StudioPreferences = {
    telemetryEnabled: false,
    crashReportingEnabled: false,
    updateChannel: 'stable',
    visualMode: 'dark',
    noNetworkMode: false,
    locale: 'en',
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
      visualMode: parsed.visualMode === 'light' || parsed.visualMode === 'high-contrast' ? parsed.visualMode : 'dark',
      noNetworkMode: parsed.noNetworkMode === true,
      locale: normalizeLocale(parsed.locale),
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
    'Export: Rubric file': 'rubric.json',
    'Export: Judge card': 'judge-card.md',
    'Export: eval-run-manifest': 'eval-run-manifest.json',
    'Export: Conformance badge': 'conformance-badge.svg',
    'Export: lm-eval-harness': 'lm-eval-harness.yaml',
    'Export: Inspect': 'inspect-task.py',
    'Export: OpenAI Evals': 'openai-evals.yaml',
    'Export: Promptfoo': 'promptfoo.yaml',
    'Export: Hugging Face Hub': 'huggingface-dataset-card.md',
    'Export: Surge SOW': 'surge-sow.txt',
    'Export: Scale task spec': 'scale-task-spec.json',
    'Export: AuraOne intake package': 'auraonepkg',
    'Generate GitHub Actions helper': '.github/workflows/rubric.yml',
    'Generate GitLab CI helper': '.gitlab-ci.yml',
    'Generate CircleCI helper': '.circleci/config.yml',
    'Generate Make helper': 'Makefile',
  };
  return artifacts[action] ?? null;
}

function gitOperationForAction(action: string): GitOperation | null {
  const operations: Record<string, GitOperation> = {
    'Git init': 'init',
    'Git status': 'status',
    'Git branch': 'branch',
    'Git switch branch': 'switch',
    'Git remote add': 'remote-add',
    'Git fetch': 'fetch',
    'Git pull': 'pull',
    'Git push': 'push',
    'Git fast-forward merge': 'fast-forward-merge',
    'Git commit': 'commit',
  };
  return operations[action] ?? null;
}

function calibrationOperationForAction(action: string): CalibrationOperation | null {
  const operations: Record<string, CalibrationOperation> = {
    'Run bias probes': 'bias',
    'Run contamination audit': 'contamination',
  };
  return operations[action] ?? null;
}
