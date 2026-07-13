import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  MessageSquare,
  PanelRight,
  Search,
  Upload,
  X,
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
import { useOverlayFocus } from './useOverlayFocus';

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
  saveStatus: string;
  onSelect: (criterionId: string) => void;
  onUpdate: (patch: Partial<Criterion>) => void;
  onBulkUpdate: (criterionIds: string[], patch: Partial<Criterion>) => void;
  onBulkDelete: (criterionIds: string[]) => void;
  onAdd: (themeId: string) => void;
  onDuplicate: (criterionId: string) => void;
  onCompare: () => void;
  onMove: (direction: -1 | 1) => void;
  onReorder: (draggedId: string, targetId: string) => void;
  onToggleTheme: (themeId: string) => void;
  onToggleComments: () => void;
}) {
  const { project, criterion, issues } = props;
  const [inFileQuery, setInFileQuery] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const inFileInputRef = useRef<HTMLInputElement>(null);
  const projectSearchInputRef = useRef<HTMLInputElement>(null);
  const inFileMatches = useMemo(() => findCriterionMatches(criterion, inFileQuery), [criterion, inFileQuery]);
  const validationState = issues.length === 0 ? 'Ready for review' : `${issues.length} validation issue${issues.length === 1 ? '' : 's'}`;
  const theme = project.themes.find((item) => item.id === criterion.themeId);
  const compactInspector = window.matchMedia('(max-width: 1020px)').matches;
  const inspectorRef = useOverlayFocus<HTMLElement>({
    open: inspectorOpen && compactInspector,
    onClose: () => setInspectorOpen(false),
    initialFocus: '.inspector-close',
  });

  useEffect(() => {
    if (props.focusRequest?.target === 'in-file') {
      setInspectorOpen(true);
      window.requestAnimationFrame(() => {
        inFileInputRef.current?.focus();
        inFileInputRef.current?.select();
      });
    }
    if (props.focusRequest?.target === 'project') {
      setInspectorOpen(true);
      window.requestAnimationFrame(() => {
        projectSearchInputRef.current?.focus();
        projectSearchInputRef.current?.select();
      });
    }
  }, [props.focusRequest]);

  function addComment() {
    const body = commentDraft.trim();
    if (!body) return;
    props.onUpdate({ comments: [...criterion.comments, body] });
    setCommentDraft('');
  }

  return (
    <div className="rs-surface rs-authoring-surface">
      <header className="rs-surface-header">
        <div className="rs-view-identity">
          <div className="rs-breadcrumb">
            <span>{theme?.label ?? 'Rubric'}</span>
            <b aria-hidden="true">/</b>
            <code>{criterion.id}.toml</code>
          </div>
          <span className={issues.length === 0 ? 'rs-view-state success' : 'rs-view-state warning'}>
            <CheckCircle2 className="button-icon" aria-hidden="true" />
            {validationState}
          </span>
        </div>
        <div className="rs-header-actions">
          <div className="rs-icon-group" aria-label="Criterion order">
            <button className="ghost-button icon-only" type="button" aria-label="Move criterion up" title="Move criterion up" onClick={() => props.onMove(-1)}>
              <ArrowUp className="button-icon" aria-hidden="true" />
            </button>
            <button className="ghost-button icon-only" type="button" aria-label="Move criterion down" title="Move criterion down" onClick={() => props.onMove(1)}>
              <ArrowDown className="button-icon" aria-hidden="true" />
            </button>
          </div>
          <button className="ghost-button rs-secondary-action" type="button" onClick={() => props.onDuplicate(criterion.id)}>
            <Copy className="button-icon" aria-hidden="true" />
            Duplicate
          </button>
          <button className="ghost-button rs-secondary-action" type="button" onClick={props.onCompare}>Compare</button>
          <button
            className="ghost-button inspector-trigger"
            type="button"
            aria-expanded={inspectorOpen}
            aria-controls="criterion-inspector"
            onClick={() => setInspectorOpen(true)}
          >
            <PanelRight className="button-icon" aria-hidden="true" />
            Checks
            {issues.length > 0 ? <span className="rs-count">{issues.length}</span> : null}
          </button>
          <button
            className="solid-button primary rs-publish-action"
            type="button"
            aria-label="Publish criterion"
            title="Publish criterion"
            onClick={() => props.onUpdate({ status: 'Live' })}
          >
            <Upload className="button-icon" aria-hidden="true" />
            <span>Publish criterion</span>
          </button>
        </div>
      </header>

      <div className="rs-author-body">
        <article className="rs-criterion-doc" aria-label="Criterion editor">
          <div className="rs-document-heading">
            <div className="rs-doc-status" tabIndex={0} role="region" aria-label="Criterion status and save state">
              <span className={`rs-status status-${criterion.status.toLowerCase()}`}>
                <span aria-hidden="true" />
                {criterion.status}
              </span>
              <span className="rs-code-chip">{criterion.scale}</span>
              <span className="rs-code-chip">weight {criterion.weight.toFixed(2)}</span>
              <span className="rs-code-chip">{criterion.evidenceRequirement}</span>
              <span
                className={`rs-doc-edited ${saveStatusClass(props.saveStatus)}`}
                aria-label={props.saveStatus}
                title={props.saveStatus}
              >
                {compactSaveStatus(props.saveStatus)}
              </span>
            </div>
            <h2 className="rs-visually-hidden">{criterion.label}</h2>
            <label className="rs-title-editor">
              <span>Criterion name</span>
              <input
                aria-label="Label"
                value={criterion.label}
                onChange={(event) => props.onUpdate({ label: event.target.value })}
              />
            </label>
            <label className="rs-lede-editor">
              <span>Reviewer-visible behavior</span>
              <textarea
                aria-label="Reviewer-visible behavior"
                value={criterion.description}
                onChange={(event) => props.onUpdate({ description: event.target.value })}
              />
              <FieldIssues issues={issuesForField(issues, 'description')} />
            </label>
          </div>

          <section className="rs-meta-strip" aria-label="Criterion settings">
            <Field label="Scale">
              <select value={criterion.scale} onChange={(event) => props.onUpdate({ scale: event.target.value as Criterion['scale'] })}>
                {scaleOptions.map((scale) => <option key={scale}>{scale}</option>)}
              </select>
            </Field>
            <Field label="Weight">
              <input type="number" min="0" max="1" step="0.05" value={criterion.weight} onChange={(event) => props.onUpdate({ weight: Number(event.target.value) })} />
            </Field>
            <Field label="Evidence">
              <select value={criterion.evidenceRequirement} onChange={(event) => props.onUpdate({ evidenceRequirement: event.target.value as Criterion['evidenceRequirement'] })}>
                {evidenceOptions.map((option) => <option key={option}>{option}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={criterion.status} onChange={(event) => props.onUpdate({ status: event.target.value as Criterion['status'] })}>
                {statusOptions.map((status) => <option key={status}>{status}</option>)}
              </select>
            </Field>
            <Field label="Criterion ID" issues={issuesForField(issues, 'id')}>
              <div className="with-button">
                <input value={criterion.id} onChange={(event) => props.onUpdate({ id: slugify(event.target.value) })} />
                <button className="ghost-button" type="button" onClick={() => props.onUpdate({ id: slugify(criterion.label) })}>Use name</button>
              </div>
            </Field>
          </section>

          <DocSection title="Scoring guidance" description="Define the observable behavior a reviewer should score.">
            <label className="rs-prose-field">
              <span>Guidance</span>
              <textarea
                aria-label="Criterion description"
                value={criterion.description}
                onChange={(event) => props.onUpdate({ description: event.target.value })}
              />
            </label>
          </DocSection>

          <DocSection title="Reviewer examples" description="Use concrete boundary cases instead of abstract policy language.">
            <div className="rs-example-pair">
              <ExampleEditor kind="positive" lines={criterion.positiveExamples} onChange={(lines) => props.onUpdate({ positiveExamples: lines })} />
              <ExampleEditor kind="negative" lines={criterion.negativeExamples} onChange={(lines) => props.onUpdate({ negativeExamples: lines })} />
            </div>
            <FieldIssues issues={[
              ...issuesForField(issues, 'positiveExamples'),
              ...issuesForField(issues, 'negativeExamples'),
            ]} />
          </DocSection>

          <DocSection title="Boundary conditions" description="Clarify when this criterion should not activate.">
            <label className="rs-prose-field">
              <span>Boundaries</span>
              <textarea value={criterion.boundaries} onChange={(event) => props.onUpdate({ boundaries: event.target.value })} />
            </label>
          </DocSection>

          {props.commentsVisible ? (
            <DocSection title="Local review notes" description="Notes stay in this project and are not exported by default." ariaLabel="Criterion comments">
              <div className="rs-notes">
                {criterion.comments.map((comment, index) => (
                  <article className="comment-card" key={`${criterion.id}-comment-${index}`}>
                    <MessageSquare className="button-icon" aria-hidden="true" />
                    <div><strong>Local note {index + 1}</strong><p>{comment}</p></div>
                  </article>
                ))}
                <label className="comment-composer">
                  <span>Add local comment</span>
                  <textarea
                    aria-label="Add local comment"
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    placeholder="Record a rewrite concern or calibration follow-up."
                  />
                </label>
                <button className="solid-button" type="button" disabled={!commentDraft.trim()} onClick={addComment}>Add comment</button>
              </div>
            </DocSection>
          ) : null}

          <details className="rs-advanced">
            <summary>Advanced rubric specification</summary>
            <div className="rs-advanced-grid">
              <Field label="Tags"><input value={criterion.tags.join(', ')} onChange={(event) => props.onUpdate({ tags: splitLines(event.target.value, ',') })} /></Field>
              <Field label="References"><textarea value={criterion.references.join('\n')} onChange={(event) => props.onUpdate({ references: splitLines(event.target.value) })} /></Field>
              <Field label="Anti-patterns"><textarea value={criterion.antiPatterns.join('\n')} onChange={(event) => props.onUpdate({ antiPatterns: splitLines(event.target.value) })} /></Field>
              <Field label="Edge cases"><textarea value={criterion.edgeCases.join('\n')} onChange={(event) => props.onUpdate({ edgeCases: splitLines(event.target.value) })} /></Field>
            </div>
          </details>
        </article>

        <aside
          ref={inspectorRef}
          id="criterion-inspector"
          className={inspectorOpen ? 'rs-copilot-rail is-open' : 'rs-copilot-rail'}
          aria-label="Validation and search"
        >
          <div className="rs-inspector-header">
            <div><strong>Checks and search</strong><span>{criterion.id}.toml</span></div>
            <button className="ghost-button icon-only inspector-close" type="button" aria-label="Close checks and search" onClick={() => setInspectorOpen(false)}>
              <X className="button-icon" aria-hidden="true" />
            </button>
          </div>

          <section className="rs-inspector-section">
            <div className="rs-inspector-title">
              <span>Validation</span>
              <strong>{issues.length === 0 ? 'Pass' : issues.length}</strong>
            </div>
            {issues.length === 0 ? (
              <div className="rs-validation-summary success" role="status">
                <CheckCircle2 className="button-icon" aria-hidden="true" />
                <div><strong>Specification checks pass</strong><p>Schema, weight, examples, and ID format are valid.</p></div>
              </div>
            ) : (
              <div className="issue-list">
                {issues.map((issue) => (
                  <div key={issue.id} className={`issue ${issue.severity}`}>
                    <strong>{issue.field}</strong>
                    <span>{issue.message}</span>
                  </div>
                ))}
              </div>
            )}
            {criterion.status !== 'Live' ? (
              <div className="rs-validation-summary warning">
                <span aria-hidden="true">!</span>
                <div><strong>Review before publishing</strong><p>Confirm examples and calibration evidence before moving this criterion to Live.</p></div>
              </div>
            ) : null}
          </section>

          <section className="rs-inspector-section">
            <label className="rs-search-field">
              <span>Find in this criterion</span>
              <div><Search className="button-icon" aria-hidden="true" /><input ref={inFileInputRef} aria-label="In-file find" value={inFileQuery} onChange={(event) => setInFileQuery(event.target.value)} /></div>
            </label>
            {inFileQuery ? <p className="rs-search-count">{inFileMatches.length} {inFileMatches.length === 1 ? 'match' : 'matches'} in this criterion</p> : null}
            <div className="search-results">
              {inFileMatches.slice(0, 5).map((match) => (
                <button key={`${match.field}-${match.index}-${match.excerpt}`} type="button">
                  <strong>{match.field}</strong>
                  <small>{match.excerpt}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="rs-inspector-section">
            <label className="rs-search-field">
              <span>Search project</span>
              <div><Search className="button-icon" aria-hidden="true" /><input ref={projectSearchInputRef} aria-label="Across-project search" value={props.searchQuery} onChange={(event) => props.setSearchQuery(event.target.value)} /></div>
            </label>
            <div className="rs-search-options">
              <label><input type="checkbox" checked={props.regex} onChange={(event) => props.setRegex(event.target.checked)} />Regex</label>
              <label><input type="checkbox" checked={props.caseSensitive} onChange={(event) => props.setCaseSensitive(event.target.checked)} />Match case</label>
              <label><input type="checkbox" checked={props.wholeWord} onChange={(event) => props.setWholeWord(event.target.checked)} />Whole word</label>
            </div>
            <div className="search-results">
              {props.searchResults.slice(0, 6).map((result) => (
                <button key={`${result.criterionId}-${result.field}-${result.excerpt}`} type="button" onClick={() => props.onSelect(result.criterionId)}>
                  <strong>{project.criteria.find((item) => item.id === result.criterionId)?.label ?? result.criterionId}</strong>
                  <span>{result.field}</span>
                  <small>{result.excerpt}</small>
                </button>
              ))}
            </div>
          </section>
        </aside>
        {inspectorOpen ? <button className="inspector-scrim" type="button" aria-label="Close checks and search" onClick={() => setInspectorOpen(false)} /> : null}
      </div>
    </div>
  );
}

function Field({ label, issues = [], children }: { label: string; issues?: ValidationIssue[]; children: ReactNode }) {
  return (
    <label className={issues.length > 0 ? 'field has-issue' : 'field'}>
      <span>{label}{issues.length > 0 ? <em>{issues.length}</em> : null}</span>
      {children}
      <FieldIssues issues={issues} />
    </label>
  );
}

function FieldIssues({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <span className="field-issues" role="status">
      {issues.map((issue) => <span key={issue.id}>{issue.message}</span>)}
    </span>
  );
}

function DocSection({
  title,
  description,
  ariaLabel,
  children,
}: {
  title: string;
  description: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="rs-doc-section" role={ariaLabel ? 'region' : undefined} aria-label={ariaLabel}>
      <header><div><h3>{title}</h3><p>{description}</p></div></header>
      {children}
    </section>
  );
}

function ExampleEditor({
  kind,
  lines,
  onChange,
}: {
  kind: 'positive' | 'negative';
  lines: string[];
  onChange: (lines: string[]) => void;
}) {
  const isPositive = kind === 'positive';
  return (
    <label className={isPositive ? 'rs-example-card positive' : 'rs-example-card negative'}>
      <span><i aria-hidden="true">{isPositive ? '+' : '−'}</i>{isPositive ? 'Strong response' : 'Misses the criterion'}</span>
      <textarea value={lines.join('\n')} onChange={(event) => onChange(splitLines(event.target.value))} />
    </label>
  );
}

function issuesForField(issues: ValidationIssue[], field: string) {
  return issues.filter((issue) => issue.field === field);
}

function compactSaveStatus(message: string): string {
  if (/fail|error/i.test(message)) return 'Save failed';
  if (/saving/i.test(message)) return 'Saving...';
  return 'Saved locally';
}

function saveStatusClass(message: string): string {
  if (/fail|error/i.test(message)) return 'save-error';
  if (/saving/i.test(message)) return 'save-saving';
  return 'save-saved';
}

function splitLines(value: string, separator = '\n') {
  return value.split(separator).map((item) => item.trim()).filter(Boolean);
}

function findCriterionMatches(criterion: Criterion, query: string): Array<{ field: string; index: number; excerpt: string }> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

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
  return `${start > 0 ? '...' : ''}${value.slice(start, end)}${end < value.length ? '...' : ''}`;
}
