export interface RubricDiagnostic {
  file: string;
  line: number;
  field: string;
  severity: 'error' | 'warning' | 'hint';
  message: string;
}

export interface CriterionDocument {
  file: string;
  content: string;
}

export function validateCriterionToml(document: CriterionDocument): RubricDiagnostic[] {
  const diagnostics: RubricDiagnostic[] = [];
  const content = document.content;

  requireField(document, 'id', diagnostics);
  requireField(document, 'label', diagnostics);
  requireField(document, 'description', diagnostics);
  requireField(document, 'weight', diagnostics);
  requireField(document, 'scale', diagnostics);

  const weight = /weight\s*=\s*([0-9.]+)/.exec(content);
  if (weight) {
    const value = Number(weight[1]);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      diagnostics.push({
        file: document.file,
        line: lineFor(content, 'weight'),
        field: 'weight',
        severity: 'error',
        message: 'Weight must be between 0 and 1.',
      });
    }
  }

  if (!/positive_examples\s*=/.test(content)) {
    diagnostics.push({
      file: document.file,
      line: 0,
      field: 'positive_examples',
      severity: 'hint',
      message: 'Add at least two positive examples for reviewer calibration.',
    });
  }

  if (!/negative_examples\s*=/.test(content)) {
    diagnostics.push({
      file: document.file,
      line: 0,
      field: 'negative_examples',
      severity: 'hint',
      message: 'Add at least two negative examples to constrain the criterion.',
    });
  }

  return diagnostics;
}

function requireField(document: CriterionDocument, field: string, diagnostics: RubricDiagnostic[]): void {
  if (!new RegExp(`^${field}\\s*=`, 'm').test(document.content)) {
    diagnostics.push({
      file: document.file,
      line: 0,
      field,
      severity: 'error',
      message: `${field} is required by rubric-spec v1.`,
    });
  }
}

function lineFor(content: string, field: string): number {
  const lines = content.split('\n');
  const fieldPattern = new RegExp(`^${field}\\s*=`);
  const index = lines.findIndex((line) => fieldPattern.test(line.trim()));
  return index >= 0 ? index : 0;
}
