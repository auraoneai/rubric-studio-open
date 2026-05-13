import type { RubricProject } from '../domain/rubric';

export function ProjectSidebar({
  project,
  issues,
  selectedCriterionId,
  onSelect,
}: {
  project: RubricProject;
  issues: number;
  selectedCriterionId: string;
  onSelect: (criterionId: string) => void;
}) {
  return (
    <aside className="sidebar" aria-label="Project sidebar">
      <div className="sidebar-header">
        <p>Project</p>
        <strong>{project.name}</strong>
      </div>
      <div className="tree-group">
        <button className="tree-root" type="button">
          rubric/
        </button>
        {project.themes.map((theme) => (
          <div key={theme.id}>
            <button className="tree-folder" type="button">
              ▾ {theme.label}
            </button>
            {project.criteria
              .filter((criterion) => criterion.themeId === theme.id)
              .map((criterion) => (
                <button
                  key={criterion.id}
                  className={criterion.id === selectedCriterionId ? 'tree-file active' : 'tree-file'}
                  type="button"
                  onClick={() => onSelect(criterion.id)}
                >
                  {criterion.status === 'Live' ? '●' : '○'} {criterion.id}.toml
                </button>
              ))}
          </div>
        ))}
      </div>
      <div className="tree-group">
        <button className="tree-root" type="button">
          samples/
        </button>
        <button className="tree-file" type="button">
          expert-gold-v1.jsonl
        </button>
        <button className="tree-file" type="button">
          held-out.jsonl
        </button>
      </div>
      <div className="tree-group">
        <button className="tree-root" type="button">
          judges/
        </button>
        {project.judges.map((judge) => (
          <button key={judge.id} className="tree-file" type="button">
            {judge.enabled ? '●' : '○'} {judge.id}.toml
          </button>
        ))}
      </div>
      <div className="git-card" aria-label="Git status">
        <span>.git/</span>
        <strong>{project.branch}</strong>
        <small>{issues} changed validation signals</small>
      </div>
    </aside>
  );
}
