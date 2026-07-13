import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ChevronDown, FileText, Plus, X } from 'lucide-react';
import type { RubricProject } from '../domain/rubric';
import { useOverlayFocus } from './useOverlayFocus';

type ContextTarget =
  | { kind: 'root'; label: string; path: string | null; canCreateCriterion: boolean }
  | { kind: 'theme'; label: string; themeId: string; path: string | null }
  | { kind: 'criterion'; label: string; criterionId: string; path: string | null }
  | { kind: 'sample'; label: string; path: string | null }
  | { kind: 'judge'; label: string; path: string | null }
  | { kind: 'checkpoint'; label: string; path: string | null };

export function ProjectSidebar({
  open,
  onClose,
  project,
  issues,
  projectPath,
  selectedCriterionId,
  onSelect,
  onRenameCriterion,
  onDuplicateCriterion,
  onDeleteCriterion,
  onNewCriterion,
  onOpenContainingFolder,
  onRevealInFileManager,
}: {
  open: boolean;
  onClose: () => void;
  project: RubricProject;
  issues: number;
  projectPath: string | null;
  selectedCriterionId: string;
  onSelect: (criterionId: string) => void;
  onRenameCriterion: (criterionId: string, label: string) => void;
  onDuplicateCriterion: (criterionId: string) => void;
  onDeleteCriterion: (criterionId: string) => void;
  onNewCriterion: (themeId: string) => void;
  onOpenContainingFolder: (path: string | null, label: string) => void;
  onRevealInFileManager: (path: string | null, label: string) => void;
}) {
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const compactDrawer = window.matchMedia('(max-width: 820px)').matches;
  const sidebarRef = useOverlayFocus<HTMLElement>({
    open: open && compactDrawer,
    onClose,
    initialFocus: '.sidebar-close',
  });

  useEffect(() => {
    if (!contextTarget) {
      return;
    }
    contextMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [contextTarget]);

  function openContextMenu(event: MouseEvent, target: ContextTarget) {
    event.preventDefault();
    event.stopPropagation();
    setContextTarget(target);
  }

  function openKeyboardContextMenu(event: KeyboardEvent, target: ContextTarget) {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setContextTarget(target);
  }

  function navigateContextMenu(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setContextTarget(null);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
      return;
    }
    const items = Array.from(contextMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) {
      return;
    }
    event.preventDefault();
    const currentIndex = Math.max(0, items.findIndex((item) => item === document.activeElement));
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (currentIndex + 1) % items.length
            : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex].focus();
  }

  function projectFilePath(...segments: string[]): string | null {
    if (!projectPath) {
      return null;
    }
    const separator = projectPath.includes('\\') ? '\\' : '/';
    return [projectPath.replace(/[\\/]+$/, ''), ...segments].join(separator);
  }

  return (
    <aside ref={sidebarRef} className={open ? 'sidebar is-open' : 'sidebar'} aria-label="Project sidebar" onClick={() => setContextTarget(null)}>
      <div className="sidebar-header">
        <div>
          <p>Project</p>
          <strong>{project.name}</strong>
          <small>v{project.version} · local project</small>
        </div>
        <button className="ghost-button icon-only sidebar-close" type="button" aria-label="Close project navigation" onClick={onClose}>
          <X className="button-icon" aria-hidden="true" />
        </button>
      </div>
      <div className="tree-group">
        <div className="tree-section-heading">
          <span>Criteria</span>
          <button className="ghost-button icon-only" type="button" aria-label="New criterion" onClick={() => onNewCriterion(project.themes[0].id)}>
            <Plus className="button-icon" aria-hidden="true" />
          </button>
        </div>
        <div className="criteria-tree" role="tree" aria-label="Rubric criteria files">
          {project.themes.map((theme) => (
            <Fragment key={theme.id}>
              <button
                className="tree-folder"
                type="button"
                role="treeitem"
                aria-expanded="true"
                aria-level={2}
                aria-haspopup="menu"
                onKeyDown={(event) =>
                  openKeyboardContextMenu(event, {
                    kind: 'theme',
                    label: theme.label,
                    themeId: theme.id,
                    path: projectFilePath('themes', `${theme.id}.md`),
                  })
                }
                onContextMenu={(event) =>
                  openContextMenu(event, {
                    kind: 'theme',
                    label: theme.label,
                    themeId: theme.id,
                    path: projectFilePath('themes', `${theme.id}.md`),
                  })
                }
              >
                <span><ChevronDown className="button-icon" aria-hidden="true" />{theme.label}</span>
                <em>{project.criteria.filter((criterion) => criterion.themeId === theme.id).length}</em>
              </button>
              {project.criteria
                .filter((criterion) => criterion.themeId === theme.id)
                .map((criterion) => (
                  <button
                    key={criterion.id}
                    className={criterion.id === selectedCriterionId ? 'tree-file active' : 'tree-file'}
                    type="button"
                    role="treeitem"
                    aria-level={3}
                    aria-label={`${criterion.id}.toml ${criterion.label}`}
                    aria-current={criterion.id === selectedCriterionId ? 'true' : undefined}
                    aria-haspopup="menu"
                    onClick={() => onSelect(criterion.id)}
                    onKeyDown={(event) =>
                      openKeyboardContextMenu(event, {
                        kind: 'criterion',
                        label: criterion.label,
                        criterionId: criterion.id,
                        path: projectFilePath('criteria', criterion.themeId, `${criterion.id}.toml`),
                      })
                    }
                    onContextMenu={(event) =>
                      openContextMenu(event, {
                        kind: 'criterion',
                        label: criterion.label,
                        criterionId: criterion.id,
                        path: projectFilePath('criteria', criterion.themeId, `${criterion.id}.toml`),
                      })
                    }
                  >
                    <span className={criterion.status === 'Live' ? 'tree-status live' : criterion.status === 'Draft' ? 'tree-status draft' : 'tree-status'} aria-hidden="true" />
                    <span className="tree-file-main">
                      <strong>{criterion.label}</strong>
                      <small>{criterion.scale} · weight {criterion.weight.toFixed(2)}</small>
                    </span>
                  </button>
                ))}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="project-resources" aria-label="Project resources">
        <div><FileText className="button-icon" aria-hidden="true" /><span>Samples</span><strong>{project.samples.length}</strong></div>
        <div><span className="resource-judge-icon" aria-hidden="true">J</span><span>Judges enabled</span><strong>{project.judges.filter((judge) => judge.enabled).length}/{project.judges.length}</strong></div>
        <div><span className={issues === 0 ? 'resource-status ok' : 'resource-status warn'} aria-hidden="true" /><span>Validation</span><strong>{issues === 0 ? 'Pass' : `${issues} issues`}</strong></div>
      </div>
      <div
        className="checkpoint-card"
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-label="Local comparison checkpoint"
        onKeyDown={(event) => openKeyboardContextMenu(event, { kind: 'checkpoint', label: '.rubric/', path: projectFilePath('.rubric') })}
        onContextMenu={(event) => openContextMenu(event, { kind: 'checkpoint', label: '.rubric/', path: projectFilePath('.rubric') })}
      >
        <span>.rubric/</span>
        <strong>Local checkpoint</strong>
        <small>{issues} current validation signals</small>
      </div>
      {contextTarget ? (
        <div
          ref={contextMenuRef}
          className="context-menu"
          role="menu"
          aria-label={`Actions for ${contextTarget.label}`}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={navigateContextMenu}
        >
          <strong>{contextTarget.label}</strong>
          {contextTarget.kind === 'criterion' ? (
            <button type="button" role="menuitem" onClick={() => { onSelect(contextTarget.criterionId); setContextTarget(null); }}>
            Open
            </button>
          ) : null}
          {contextTarget.kind === 'criterion' ? (
            <button type="button" role="menuitem" onClick={() => { onRenameCriterion(contextTarget.criterionId, `${contextTarget.label} renamed`); setContextTarget(null); }}>
              Rename
            </button>
          ) : null}
          {contextTarget.kind === 'criterion' || contextTarget.kind === 'theme' || (contextTarget.kind === 'root' && contextTarget.canCreateCriterion) ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                if (contextTarget.kind === 'criterion') onDuplicateCriterion(contextTarget.criterionId);
                else onNewCriterion(contextTarget.kind === 'theme' ? contextTarget.themeId : project.themes[0].id);
                setContextTarget(null);
              }}
            >
              New sibling
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={() => { onOpenContainingFolder(contextTarget.path, contextTarget.label); setContextTarget(null); }}>
            Open containing folder
          </button>
          <button type="button" role="menuitem" onClick={() => { onRevealInFileManager(contextTarget.path, contextTarget.label); setContextTarget(null); }}>
            Reveal in Finder/Explorer
          </button>
          {contextTarget.kind === 'criterion' ? (
            <button type="button" role="menuitem" onClick={() => { onDeleteCriterion(contextTarget.criterionId); setContextTarget(null); }}>
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
