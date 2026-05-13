import { useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Wrench,
} from 'lucide-react';
import {
  evidenceOptions,
  scaleOptions,
  slugify,
  statusOptions,
  type Criterion,
  type RubricProject,
} from '../domain/rubric';
import { searchProject, validateProject } from '../domain/validation';

export function AuthoringPanel(props: {
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
      current.includes(criterionId) ? current.filter((id) => id !== criterionId) : [...current, criterionId],
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

function Field({ label, issueCount = 0, children }: { label: string; issueCount?: number; children: ReactNode }) {
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
