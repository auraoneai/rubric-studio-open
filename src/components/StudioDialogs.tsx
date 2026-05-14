import { useRef } from 'react';
import type { Criterion } from '../domain/rubric';
import { useDialogFocusTrap } from './useDialogFocusTrap';

export function TemplateProjectDialog({
  initialName,
  onCancel,
  onCreate,
}: {
  initialName: string;
  onCancel: () => void;
  onCreate: (name: string) => void;
}) {
  const dialogRef = useRef<HTMLFormElement | null>(null);
  useDialogFocusTrap(dialogRef);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <form
        ref={dialogRef}
        className="studio-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-dialog-title"
        aria-describedby="template-dialog-body"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const name = String(form.get('projectName') ?? '').trim() || initialName;
          onCreate(name);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
      >
        <p className="eyebrow">Starter project</p>
        <h2 id="template-dialog-title">Create from template</h2>
        <p id="template-dialog-body">
          Create the neutral helpful-response rubric with themes, criteria, samples, a local mock judge, and export folders.
        </p>
        <label className="field-label">
          <span>Project name</span>
          <input name="projectName" autoFocus defaultValue={initialName} />
        </label>
        <div className="inline-actions">
          <button className="ghost-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="glass-button primary" type="submit">
            Create project
          </button>
        </div>
      </form>
    </div>
  );
}

export function DeleteCriterionDialog({
  criterion,
  onCancel,
  onDelete,
}: {
  criterion: Criterion;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocusTrap(dialogRef);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <section
        ref={dialogRef}
        className="studio-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-body"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
      >
        <p className="eyebrow">Confirm deletion</p>
        <h2 id="delete-dialog-title">Delete {criterion.label}?</h2>
        <p id="delete-dialog-body">
          This removes the criterion from the local project. Use version control before deleting live criteria that reviewers depend on.
        </p>
        <div className="inline-actions">
          <button className="ghost-button" type="button" autoFocus onClick={onCancel}>
            Cancel
          </button>
          <button className="danger-button" type="button" onClick={onDelete}>
            Delete criterion
          </button>
        </div>
      </section>
    </div>
  );
}
