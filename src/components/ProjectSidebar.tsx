import { useState } from 'react';
import type { RubricProject } from '../domain/rubric';

export function ProjectSidebar({
  project,
  issues,
  selectedCriterionId,
  onSelect,
  onRenameCriterion,
  onDuplicateCriterion,
  onDeleteCriterion,
}: {
  project: RubricProject;
  issues: number;
  selectedCriterionId: string;
  onSelect: (criterionId: string) => void;
  onRenameCriterion: (criterionId: string, label: string) => void;
  onDuplicateCriterion: (criterionId: string) => void;
  onDeleteCriterion: (criterionId: string) => void;
}) {
  const [menuCriterionId, setMenuCriterionId] = useState<string | null>(null);
  const menuCriterion = project.criteria.find((criterion) => criterion.id === menuCriterionId);

  return (
    <aside className="sidebar" aria-label="Project sidebar" onClick={() => setMenuCriterionId(null)}>
      <div className="sidebar-header">
        <p>Project</p>
        <strong>{project.name}</strong>
      </div>
      <div className="tree-group" role="tree" aria-label="Rubric criteria files">
        <button className="tree-root" type="button" aria-expanded="true">
          rubric/
        </button>
        {project.themes.map((theme) => (
          <div key={theme.id}>
            <button className="tree-folder" type="button" aria-expanded="true">
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
                  aria-current={criterion.id === selectedCriterionId ? 'true' : undefined}
                  onClick={() => onSelect(criterion.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenuCriterionId(criterion.id);
                  }}
                >
                  {criterion.status === 'Live' ? '●' : '○'} {criterion.id}.toml
                </button>
              ))}
          </div>
        ))}
      </div>
      <div className="tree-group">
        <button className="tree-root" type="button" aria-expanded="true">
          samples/
        </button>
        {project.samples.map((sample) => (
          <button key={sample.id} className="tree-file" type="button" aria-label={`Sample file ${sample.id}`}>
            {sample.id}.jsonl
          </button>
        ))}
      </div>
      <div className="tree-group">
        <button className="tree-root" type="button" aria-expanded="true">
          judges/
        </button>
        {project.judges.map((judge) => (
          <button key={judge.id} className="tree-file" type="button" aria-label={`${judge.enabled ? 'Enabled' : 'Disabled'} judge ${judge.label}`}>
            {judge.enabled ? '●' : '○'} {judge.id}.toml
          </button>
        ))}
      </div>
      <div className="git-card" aria-label="Git status">
        <span>.git/</span>
        <strong>{project.branch}</strong>
        <small>{issues} changed validation signals</small>
      </div>
      {menuCriterion ? (
        <div className="context-menu" role="menu" aria-label={`Actions for ${menuCriterion.label}`} onClick={(event) => event.stopPropagation()}>
          <strong>{menuCriterion.label}</strong>
          <button type="button" role="menuitem" onClick={() => { onSelect(menuCriterion.id); setMenuCriterionId(null); }}>
            Open
          </button>
          <button type="button" role="menuitem" onClick={() => { onRenameCriterion(menuCriterion.id, `${menuCriterion.label} renamed`); setMenuCriterionId(null); }}>
            Rename
          </button>
          <button type="button" role="menuitem" onClick={() => { onDuplicateCriterion(menuCriterion.id); setMenuCriterionId(null); }}>
            New sibling
          </button>
          <button type="button" role="menuitem" onClick={() => { onSelect(menuCriterion.id); setMenuCriterionId(null); }}>
            Reveal in editor
          </button>
          <button type="button" role="menuitem" onClick={() => { onDeleteCriterion(menuCriterion.id); setMenuCriterionId(null); }}>
            Delete
          </button>
        </div>
      ) : null}
    </aside>
  );
}
