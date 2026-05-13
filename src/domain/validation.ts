import type { Criterion, RubricProject, ValidationIssue } from './rubric';
import { slugify } from './rubric';

const noisyWords = ['very', 'really', 'good', 'bad', 'appropriate', 'reasonable'];

export function validateProject(project: RubricProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const labels = new Map<string, string>();
  const ids = new Set<string>();

  project.criteria.forEach((criterion) => {
    issues.push(...validateCriterion(criterion, project));

    const normalizedLabel = criterion.label.trim().toLowerCase();
    if (labels.has(normalizedLabel)) {
      issues.push({
        id: `duplicate-label-${criterion.id}`,
        criterionId: criterion.id,
        field: 'label',
        severity: 'error',
        message: `Label duplicates ${labels.get(normalizedLabel)}.`,
      });
    }
    labels.set(normalizedLabel, criterion.id);

    if (ids.has(criterion.id)) {
      issues.push({
        id: `duplicate-id-${criterion.id}`,
        criterionId: criterion.id,
        field: 'id',
        severity: 'error',
        message: `Criterion id "${criterion.id}" is not unique.`,
      });
    }
    ids.add(criterion.id);
  });

  project.themes.forEach((theme) => {
    const themeCriteria = project.criteria.filter((criterion) => criterion.themeId === theme.id);
    const totalWeight = themeCriteria.reduce((sum, criterion) => sum + criterion.weight, 0);
    if (themeCriteria.length > 0 && Math.abs(totalWeight - 1) > 0.05) {
      issues.push({
        id: `theme-weight-${theme.id}`,
        field: 'weight',
        severity: 'warning',
        message: `${theme.label} weights sum to ${totalWeight.toFixed(2)}; target 1.00.`,
        quickFix: 'Normalize theme weights',
      });
    }
  });

  if (project.samples.length === 0) {
    issues.push({
      id: 'samples-empty',
      field: 'samples',
      severity: 'suggestion',
      message: 'Add a sample JSONL file to unlock preview and calibration.',
    });
  }

  return issues;
}

export function validateCriterion(
  criterion: Criterion,
  project?: RubricProject,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!criterion.label.trim()) {
    issues.push({
      id: `label-required-${criterion.id}`,
      criterionId: criterion.id,
      field: 'label',
      severity: 'error',
      message: 'Label is required.',
    });
  }

  if (criterion.label.length > 80) {
    issues.push({
      id: `label-length-${criterion.id}`,
      criterionId: criterion.id,
      field: 'label',
      severity: 'warning',
      message: 'Label should be 80 characters or fewer.',
    });
  }

  if (!criterion.id || slugify(criterion.id) !== criterion.id) {
    issues.push({
      id: `id-slug-${criterion.id}`,
      criterionId: criterion.id,
      field: 'id',
      severity: 'error',
      message: 'ID must be a stable slug using lowercase letters, numbers, and hyphens.',
      quickFix: 'Derive slug from label',
    });
  }

  if (!criterion.description.trim()) {
    issues.push({
      id: `description-required-${criterion.id}`,
      criterionId: criterion.id,
      field: 'description',
      severity: 'error',
      message: 'Description is required.',
    });
  } else if (criterion.description.length > 2000) {
    issues.push({
      id: `description-length-${criterion.id}`,
      criterionId: criterion.id,
      field: 'description',
      severity: 'warning',
      message: 'Description is over the 2,000 character guideline.',
    });
  }

  if (criterion.weight < 0 || criterion.weight > 1) {
    issues.push({
      id: `weight-range-${criterion.id}`,
      criterionId: criterion.id,
      field: 'weight',
      severity: 'error',
      message: 'Weight must be between 0 and 1 for this project.',
    });
  }

  if (criterion.positiveExamples.length < 2) {
    issues.push({
      id: `positive-examples-${criterion.id}`,
      criterionId: criterion.id,
      field: 'positiveExamples',
      severity: 'suggestion',
      message: 'Add at least two positive examples for reviewer calibration.',
      quickFix: 'Add positive example',
    });
  }

  if (criterion.negativeExamples.length < 2) {
    issues.push({
      id: `negative-examples-${criterion.id}`,
      criterionId: criterion.id,
      field: 'negativeExamples',
      severity: 'suggestion',
      message: 'Add at least two negative examples to avoid over-broad scoring.',
      quickFix: 'Add negative example',
    });
  }

  const lowerText = `${criterion.label} ${criterion.description}`.toLowerCase();
  const foundNoisyWord = noisyWords.find((word) => lowerText.includes(` ${word} `));
  if (foundNoisyWord) {
    issues.push({
      id: `style-noise-${criterion.id}-${foundNoisyWord}`,
      criterionId: criterion.id,
      field: 'description',
      severity: 'suggestion',
      message: `Consider replacing vague word "${foundNoisyWord}" with observable behavior.`,
    });
  }

  criterion.references.forEach((reference, index) => {
    if (!isUrl(reference) && !isDoi(reference)) {
      issues.push({
        id: `reference-${criterion.id}-${index}`,
        criterionId: criterion.id,
        field: 'references',
        severity: 'warning',
        message: `"${reference}" should be a URL or DOI.`,
      });
    }
  });

  criterion.siblingLinks.forEach((link) => {
    if (project && !project.criteria.some((candidate) => candidate.id === link)) {
      issues.push({
        id: `sibling-${criterion.id}-${link}`,
        criterionId: criterion.id,
        field: 'siblingLinks',
        severity: 'warning',
        message: `Sibling link "${link}" does not match a criterion id.`,
      });
    }
  });

  return issues;
}

export interface SearchOptions {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface SearchResult {
  criterionId: string;
  field: string;
  excerpt: string;
}

export function searchProject(project: RubricProject, options: SearchOptions): SearchResult[] {
  if (!options.query.trim()) {
    return [];
  }

  const matcher = createMatcher(options);
  const results: SearchResult[] = [];

  project.criteria.forEach((criterion) => {
    const fields: Array<[string, string]> = [
      ['label', criterion.label],
      ['description', criterion.description],
      ['tags', criterion.tags.join(', ')],
      ['positiveExamples', criterion.positiveExamples.join('\n')],
      ['negativeExamples', criterion.negativeExamples.join('\n')],
      ['antiPatterns', criterion.antiPatterns.join('\n')],
      ['boundaries', criterion.boundaries],
      ['edgeCases', criterion.edgeCases.join('\n')],
      ['references', criterion.references.join('\n')],
      ['comments', criterion.comments.join('\n')],
    ];

    fields.forEach(([field, value]) => {
      const match = matcher(value);
      if (match) {
        results.push({
          criterionId: criterion.id,
          field,
          excerpt: value.slice(Math.max(0, match.index - 40), match.index + 90),
        });
      }
    });
  });

  return results;
}

function createMatcher(options: SearchOptions): (value: string) => { index: number } | null {
  if (options.regex) {
    try {
      const pattern = options.wholeWord ? `\\b(?:${options.query})\\b` : options.query;
      const expression = new RegExp(pattern, options.caseSensitive ? '' : 'i');
      return (value) => {
        const match = expression.exec(value);
        return match ? { index: match.index } : null;
      };
    } catch {
      return () => null;
    }
  }

  const needle = options.caseSensitive ? options.query : options.query.toLowerCase();
  return (value) => {
    const haystack = options.caseSensitive ? value : value.toLowerCase();
    const index = options.wholeWord
      ? haystack.search(new RegExp(`\\b${escapeRegExp(needle)}\\b`))
      : haystack.indexOf(needle);
    return index >= 0 ? { index } : null;
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isDoi(value: string): boolean {
  return /^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/i.test(value);
}
