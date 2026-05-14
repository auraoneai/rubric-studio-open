import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Trash2,
  Wrench,
} from 'lucide-react';
import {
  evidenceOptions,
  scaleOptions,
  slugify,
  statusOptions,
  type Criterion,
  type RubricProject,
  type ValidationIssue,
} from '../domain/rubric';
import { searchProject, validateProject } from '../domain/validation';
import { useDialogFocusTrap } from './useDialogFocusTrap';
import './AuthoringPanel.css';

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
  focusRequest: { target: 'in-file' | 'project'; nonce: number } | null;
  commentsVisible: boolean;
  onSelect: (criterionId: string) => void;
  onUpdate: (patch: Partial<Criterion>) => void;
  onBulkUpdate: (criterionIds: string[], patch: Partial<Criterion>) => void;
  onBulkDelete: (criterionIds: string[]) => void;
  onAdd: (themeId: string) => void;
  onMove: (direction: -1 | 1) => void;
  onReorder: (draggedId: string, targetId: string) => void;
  onToggleTheme: (themeId: string) => void;
  onToggleComments: () => void;
}) {
  const { project, criterion, issues } = props;
  const tagOptions = Array.from(new Set(project.criteria.flatMap((item) => item.tags))).sort();
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [inFileQuery, setInFileQuery] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [pendingBulkDeleteIds, setPendingBulkDeleteIds] = useState<string[] | null>(null);
  const inFileInputRef = useRef<HTMLInputElement>(null);
  const projectSearchInputRef = useRef<HTMLInputElement>(null);
  const bulkSelected = new Set(bulkIds);
  const inFileMatches = useMemo(() => findCriterionMatches(criterion, inFileQuery), [criterion, inFileQuery]);
  const visibleIssues = useMemo(
    () => issues.filter((issue) => !issue.criterionId || issue.criterionId === criterion.id),
    [criterion.id, issues],
  );
  const issuesForField = (field: string) => visibleIssues.filter((issue) => issue.field === field);

  useEffect(() => {
    if (props.focusRequest?.target === 'in-file') {
      inFileInputRef.current?.focus();
      inFileInputRef.current?.select();
    }
    if (props.focusRequest?.target === 'project') {
      projectSearchInputRef.current?.focus();
      projectSearchInputRef.current?.select();
    }
  }, [props.focusRequest]);

  function toggleBulk(criterionId: string) {
    setBulkIds((current) =>
      current.includes(criterionId) ? current.filter((id) => id !== criterionId) : [...current, criterionId],
    );
  }

  function bulkPatch(patch: Partial<Criterion>) {
    props.onBulkUpdate(bulkIds, patch);
    setBulkIds([]);
  }

  function bulkDelete() {
    const count = bulkIds.length;
    if (count === 0) return;
    setPendingBulkDeleteIds([...bulkIds]);
  }

  function confirmBulkDelete() {
    if (!pendingBulkDeleteIds?.length) {
      return;
    }
    props.onBulkDelete(pendingBulkDeleteIds);
    setBulkIds([]);
    setPendingBulkDeleteIds(null);
  }

  function addComment() {
    const body = commentDraft.trim();
    if (!body) {
      return;
    }
    props.onUpdate({ comments: [...criterion.comments, body] });
    setCommentDraft('');
  }

  function applyQuickFix(issue: (typeof issues)[number]) {
    if (issue.quickFix === 'Use draft label') {
      props.onUpdate({ label: 'Draft criterion' });
    }
    if (issue.quickFix === 'Shorten label') {
      props.onUpdate({ label: criterion.label.slice(0, 80).trim() });
    }
    if (issue.quickFix === 'Derive slug from label') {
      props.onUpdate({ id: slugify(criterion.label) });
    }
    if (issue.quickFix === 'Add description starter') {
      props.onUpdate({ description: 'Describe the observable reviewer-visible behavior this criterion measures.' });
    }
    if (issue.quickFix === 'Trim description') {
      props.onUpdate({ description: criterion.description.slice(0, 2000).trim() });
    }
    if (issue.quickFix === 'Clamp weight') {
      props.onUpdate({ weight: Math.min(1, Math.max(0, criterion.weight)) });
    }
    if (issue.quickFix === 'Normalize theme weights') {
      const themeCriteria = project.criteria.filter((item) => item.themeId === criterion.themeId);
      if (themeCriteria.length > 0) {
        props.onBulkUpdate(
          themeCriteria.map((item) => item.id),
          { weight: Number((1 / themeCriteria.length).toFixed(2)) },
        );
      }
    }
    if (issue.quickFix === 'Add positive example') {
      props.onUpdate({
        positiveExamples: [
          ...criterion.positiveExamples,
          `Positive calibration example ${criterion.positiveExamples.length + 1}`,
        ],
      });
    }
    if (issue.quickFix === 'Add negative example') {
      props.onUpdate({
        negativeExamples: [
          ...criterion.negativeExamples,
          `Negative calibration example ${criterion.negativeExamples.length + 1}`,
        ],
      });
    }
    if (issue.quickFix === 'Add observable wording') {
      props.onUpdate({
        description: `${criterion.description.trim()} Reviewers should score only observable behavior supported by evidence in the response.`,
      });
    }
    if (issue.quickFix === 'Remove invalid references') {
      props.onUpdate({ references: criterion.references.filter(isUrlOrDoi) });
    }
    if (issue.quickFix === 'Remove missing sibling links') {
      const validIds = new Set(project.criteria.map((item) => item.id));
      props.onUpdate({ siblingLinks: criterion.siblingLinks.filter((link) => validIds.has(link)) });
    }
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
            <label className="compact-select">
              <span>Move to theme</span>
              <select
                aria-label="Move selected criteria to theme"
                value=""
                onChange={(event) => {
                  if (event.target.value) bulkPatch({ themeId: event.target.value });
                }}
              >
                <option value="">Choose theme</option>
                {project.themes.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="compact-select">
              <span>Set scale</span>
              <select
                aria-label="Set selected criteria scale"
                value=""
                onChange={(event) => {
                  if (event.target.value) bulkPatch({ scale: event.target.value as Criterion['scale'] });
                }}
              >
                <option value="">Choose scale</option>
                {scaleOptions.map((scale) => (
                  <option key={scale} value={scale}>
                    {scale}
                  </option>
                ))}
              </select>
            </label>
            <button className="ghost-button danger" type="button" onClick={bulkDelete}>
              <Trash2 className="button-icon" aria-hidden="true" />
              Delete selected
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
                          className={[
                            'criterion-row',
                            item.id === criterion.id ? 'active' : '',
                            item.id === dragOverId ? 'drag-over' : '',
                          ].filter(Boolean).join(' ')}
                          type="button"
                          data-criterion-id={item.id}
                          data-theme-id={item.themeId}
                          aria-current={item.id === criterion.id ? 'true' : undefined}
                          onClick={() => props.onSelect(item.id)}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/rubric-criterion-id', item.id);
                            event.dataTransfer.setData('text/plain', item.id);
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                            setDragOverId(item.id);
                          }}
                          onDragLeave={() => setDragOverId((current) => (current === item.id ? null : current))}
                          onDrop={(event) => {
                            event.preventDefault();
                            const draggedId =
                              event.dataTransfer.getData('text/rubric-criterion-id') ||
                              event.dataTransfer.getData('text/plain');
                            setDragOverId(null);
                            if (draggedId) {
                              props.onReorder(draggedId, item.id);
                            }
                          }}
                          onDragEnd={() => setDragOverId(null)}
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
            <button
              className={props.commentsVisible ? 'glass-button primary' : 'ghost-button'}
              type="button"
              aria-pressed={props.commentsVisible}
              onClick={props.onToggleComments}
            >
              Comments
            </button>
            <button className="ghost-button" type="button" aria-label="Move criterion up" onClick={() => props.onMove(-1)}>
              <ArrowUp className="button-icon" aria-hidden="true" />
            </button>
            <button className="ghost-button" type="button" aria-label="Move criterion down" onClick={() => props.onMove(1)}>
              <ArrowDown className="button-icon" aria-hidden="true" />
            </button>
          </div>
        </div>
        {props.commentsVisible ? (
          <section className="comments-panel" aria-label="Criterion comments">
            <div className="panel-title compact">
              <div>
                <p>Comments</p>
                <h3>{criterion.comments.length} notes</h3>
              </div>
            </div>
            {criterion.comments.length === 0 ? (
              <EmptyState title="No comments yet" body="Use comments for local reviewer notes without moving into Cloud approval workflows." />
            ) : null}
            {criterion.comments.map((comment, index) => (
              <article className="comment-card" key={`${criterion.id}-comment-${index}`}>
                <strong>Local note {index + 1}</strong>
                <p>{comment}</p>
              </article>
            ))}
            <label className="comment-composer">
              <span>Add local comment</span>
              <textarea
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                placeholder="Reviewer note, rewrite concern, or follow-up to check before commit."
              />
            </label>
            <button className="glass-button" type="button" disabled={!commentDraft.trim()} onClick={addComment}>
              Add comment
            </button>
          </section>
        ) : null}
        <div className="form-grid">
          <Field label="Label" issues={issuesForField('label')}>
            <input value={criterion.label} onChange={(event) => props.onUpdate({ label: event.target.value })} />
          </Field>
          <Field label="ID" issues={issuesForField('id')}>
            <div className="with-button">
              <input value={criterion.id} onChange={(event) => props.onUpdate({ id: slugify(event.target.value) })} />
              <button className="ghost-button" type="button" onClick={() => props.onUpdate({ id: slugify(criterion.label) })}>
                <Wrench className="button-icon" aria-hidden="true" />
                Fix
              </button>
            </div>
          </Field>
          <Field label="Weight" issues={issuesForField('weight')}>
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
        <Field label="Description" issues={issuesForField('description')}>
          <textarea value={criterion.description} onChange={(event) => props.onUpdate({ description: event.target.value })} />
        </Field>
        <Field label="Positive examples" issues={issuesForField('positiveExamples')}>
          <textarea
            value={criterion.positiveExamples.join('\n')}
            onChange={(event) => props.onUpdate({ positiveExamples: event.target.value.split('\n').filter(Boolean) })}
          />
        </Field>
        <Field label="Negative examples" issues={issuesForField('negativeExamples')}>
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
          <Field label="References" issues={issuesForField('references')}>
            <textarea value={criterion.references.join('\n')} onChange={(event) => props.onUpdate({ references: event.target.value.split('\n').filter(Boolean) })} />
          </Field>
          <Field label="Sibling links" issues={issuesForField('siblingLinks')}>
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
            <h2>{visibleIssues.length} signals</h2>
          </div>
        </div>
        <div className="search-box">
          <label>
            In-file find
            <input
              ref={inFileInputRef}
              aria-label="In-file find"
              value={inFileQuery}
              onChange={(event) => setInFileQuery(event.target.value)}
            />
          </label>
          <div className="search-results">
            {inFileQuery.trim() && inFileMatches.length === 0 ? <EmptyState title="No in-file matches" body="Try another term in the selected criterion." /> : null}
            {inFileQuery.trim() && inFileMatches.length > 0 ? (
              <div className="search-summary" role="status">
                {inFileMatches.length} match{inFileMatches.length === 1 ? '' : 'es'} in this criterion
              </div>
            ) : null}
            {inFileMatches.slice(0, 6).map((match) => (
              <button key={`${match.field}-${match.index}-${match.excerpt}`} type="button">
                <Search className="button-icon" aria-hidden="true" />
                <strong>{match.field}</strong>
                <small>{match.excerpt}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="issue-list">
          {visibleIssues.length === 0 ? <SuccessState title="No criterion issues" body="rubric-spec and style checks pass for this criterion." /> : null}
          {visibleIssues.map((issue) => (
            <div key={issue.id} className={`issue ${issue.severity}`}>
              <strong>{issue.field}</strong>
              <span>{issue.message}</span>
              {issue.quickFix ? (
                <button className="ghost-button" type="button" onClick={() => applyQuickFix(issue)}>
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
            <input
              ref={projectSearchInputRef}
              value={props.searchQuery}
              onChange={(event) => props.setSearchQuery(event.target.value)}
            />
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
      {pendingBulkDeleteIds ? (
        <BulkDeleteDialog
          count={pendingBulkDeleteIds.length}
          onCancel={() => setPendingBulkDeleteIds(null)}
          onDelete={confirmBulkDelete}
        />
      ) : null}
    </div>
  );
}

function BulkDeleteDialog({
  count,
  onCancel,
  onDelete,
}: {
  count: number;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const criterionNoun = count === 1 ? 'criterion' : 'criteria';
  useDialogFocusTrap(dialogRef);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <section
        ref={dialogRef}
        className="studio-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-delete-dialog-title"
        aria-describedby="bulk-delete-dialog-body"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <p className="eyebrow">Confirm bulk deletion</p>
        <h2 id="bulk-delete-dialog-title">
          Delete {count} selected {criterionNoun}?
        </h2>
        <p id="bulk-delete-dialog-body">
          This removes the selected criteria from the local project. Commit or export a project bundle first if reviewers depend on these criteria.
        </p>
        <div className="inline-actions">
          <button className="ghost-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger-button" type="button" onClick={onDelete}>
            Delete selected criteria
          </button>
        </div>
      </section>
    </div>
  );
}

function Field({ label, issues = [], children }: { label: string; issues?: ValidationIssue[]; children: ReactNode }) {
  const issueCount = issues.length;
  const explanation = issues.map((issue) => issue.message).join(' ');
  return (
    <label className={issueCount > 0 ? 'field has-issue' : 'field'} title={explanation || undefined}>
      <span>
        {label}
        {issueCount > 0 ? <em aria-label={`${issueCount} validation issue${issueCount === 1 ? '' : 's'}`}>{issueCount}</em> : null}
      </span>
      {children}
      {issueCount > 0 ? (
        <small className="field-explanation" role="note">
          {issues[0].message}
        </small>
      ) : null}
    </label>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state" role="status"><strong>{title}</strong><p>{body}</p></div>;
}

function SuccessState({ title, body }: { title: string; body: string }) {
  return <div className="success-state" role="status"><strong>{title}</strong><p>{body}</p></div>;
}

function findCriterionMatches(criterion: Criterion, query: string): Array<{ field: string; index: number; excerpt: string }> {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  return [
    ['Label', criterion.label],
    ['ID', criterion.id],
    ['Description', criterion.description],
    ['Positive examples', criterion.positiveExamples.join('\n')],
    ['Negative examples', criterion.negativeExamples.join('\n')],
    ['Anti-patterns', criterion.antiPatterns.join('\n')],
    ['Boundaries', criterion.boundaries],
    ['Edge cases', criterion.edgeCases.join('\n')],
    ['Tags', criterion.tags.join(', ')],
    ['References', criterion.references.join('\n')],
    ['Sibling links', criterion.siblingLinks.join(', ')],
    ['Comments', criterion.comments.join('\n')],
  ].flatMap(([field, value]) => {
    const haystack = value.toLowerCase();
    const matches: Array<{ field: string; index: number; excerpt: string }> = [];
    let index = haystack.indexOf(needle);
    while (index >= 0 && matches.length < 12) {
      matches.push({ field, index, excerpt: excerptAround(value, index, query.trim().length) });
      index = haystack.indexOf(needle, index + needle.length);
    }
    return matches;
  });
}

function excerptAround(value: string, index: number, length: number): string {
  const start = Math.max(0, index - 24);
  const end = Math.min(value.length, index + length + 48);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < value.length ? '...' : '';
  return `${prefix}${value.slice(start, end)}${suffix}`;
}

function isUrlOrDoi(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value) || /^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i.test(value);
}
