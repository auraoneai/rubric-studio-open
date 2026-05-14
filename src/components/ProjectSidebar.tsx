import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { RubricProject } from '../domain/rubric';
import { RubricStudioMark } from './RubricStudioMark';

type ContextTarget =
  | { kind: 'root'; label: string; path: string | null; canCreateCriterion: boolean }
  | { kind: 'theme'; label: string; themeId: string; path: string | null }
  | { kind: 'criterion'; label: string; criterionId: string; path: string | null }
  | { kind: 'sample'; label: string; path: string | null }
  | { kind: 'judge'; label: string; path: string | null }
  | { kind: 'git'; label: string; path: string | null };

export function ProjectSidebar({
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
    <aside className="sidebar" aria-label="Project sidebar" onClick={() => setContextTarget(null)}>
      <div className="sidebar-brand">
        <RubricStudioMark size={34} className="sidebar-brand-mark" />
        <div>
          <strong>Rubric Studio</strong>
          <span>Desktop IDE</span>
        </div>
      </div>
      <nav className="sidebar-nav" aria-label="Project files and actions">
        <div className="sidebar-header">
          <p>Project</p>
          <strong>{project.name}</strong>
        </div>
        <div className="tree-group" role="tree" aria-label="Rubric criteria files">
          <button
            className="tree-root"
            type="button"
            role="treeitem"
            aria-expanded="true"
            aria-level={1}
            aria-haspopup="menu"
            onKeyDown={(event) =>
              openKeyboardContextMenu(event, { kind: 'root', label: 'rubric/', path: projectPath, canCreateCriterion: true })
            }
            onContextMenu={(event) => openContextMenu(event, { kind: 'root', label: 'rubric/', path: projectPath, canCreateCriterion: true })}
          >
            rubric/
          </button>
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
                ▾ {theme.label}
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
                    {criterion.status === 'Live' ? '●' : '○'} {criterion.id}.toml
                  </button>
                ))}
            </Fragment>
          ))}
        </div>
        <div className="tree-group">
            <button
              className="tree-root"
              type="button"
              aria-expanded="true"
              aria-haspopup="menu"
              onKeyDown={(event) => openKeyboardContextMenu(event, { kind: 'root', label: 'samples/', path: projectFilePath('samples'), canCreateCriterion: false })}
              onContextMenu={(event) => openContextMenu(event, { kind: 'root', label: 'samples/', path: projectFilePath('samples'), canCreateCriterion: false })}
            >
              samples/
            </button>
          {project.samples.map((sample) => (
            <button
              key={sample.id}
              className="tree-file"
              type="button"
              aria-label={`Sample file ${sample.id}`}
              aria-haspopup="menu"
              onKeyDown={(event) =>
                openKeyboardContextMenu(event, {
                  kind: 'sample',
                  label: `${sample.id}.jsonl`,
                  path: projectFilePath('samples', `${sample.id}.jsonl`),
                })
              }
              onContextMenu={(event) =>
                openContextMenu(event, {
                  kind: 'sample',
                  label: `${sample.id}.jsonl`,
                  path: projectFilePath('samples', `${sample.id}.jsonl`),
                })
              }
            >
              {sample.id}.jsonl
            </button>
          ))}
        </div>
        <div className="tree-group">
          <button
            className="tree-root"
            type="button"
            aria-expanded="true"
            aria-haspopup="menu"
            onKeyDown={(event) => openKeyboardContextMenu(event, { kind: 'root', label: 'judges/', path: projectFilePath('judges'), canCreateCriterion: false })}
            onContextMenu={(event) => openContextMenu(event, { kind: 'root', label: 'judges/', path: projectFilePath('judges'), canCreateCriterion: false })}
          >
            judges/
          </button>
          {project.judges.map((judge) => (
            <button
              key={judge.id}
              className="tree-file"
              type="button"
              aria-label={`${judge.enabled ? 'Enabled' : 'Disabled'} judge ${judge.label}`}
              aria-haspopup="menu"
              onKeyDown={(event) =>
                openKeyboardContextMenu(event, {
                  kind: 'judge',
                  label: `${judge.id}.toml`,
                  path: projectFilePath('judges', `${judge.id}.toml`),
                })
              }
              onContextMenu={(event) =>
                openContextMenu(event, {
                  kind: 'judge',
                  label: `${judge.id}.toml`,
                  path: projectFilePath('judges', `${judge.id}.toml`),
                })
              }
            >
              {judge.enabled ? '●' : '○'} {judge.id}.toml
            </button>
          ))}
        </div>
        <div
          className="git-card"
          role="button"
          tabIndex={0}
          aria-haspopup="menu"
          aria-label="Git status"
          onKeyDown={(event) => openKeyboardContextMenu(event, { kind: 'git', label: '.git/', path: projectFilePath('.git') })}
          onContextMenu={(event) => openContextMenu(event, { kind: 'git', label: '.git/', path: projectFilePath('.git') })}
        >
          <span>.git/</span>
          <strong>{project.branch}</strong>
          <small>{issues} changed validation signals</small>
        </div>
      </nav>
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
