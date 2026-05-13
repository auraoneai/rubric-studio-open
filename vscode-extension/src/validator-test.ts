import { strict as assert } from 'node:assert';
import { validateCriterionToml } from './validator';

const valid = validateCriterionToml({
  file: '/workspace/criteria/helpfulness/specificity.toml',
  content: [
    'id = "specificity"',
    'label = "Specificity"',
    'description = "The response contains concrete steps."',
    'weight = 0.2',
    'scale = "binary"',
    'positive_examples = ["A concrete answer", "A bounded answer"]',
    'negative_examples = ["A vague answer", "An unsupported answer"]',
  ].join('\n'),
});
assert.deepEqual(valid, []);

const missing = validateCriterionToml({
  file: '/workspace/criteria/safety/missing-fields.toml',
  content: 'id = "missing-fields"\nweight = 0.5\n',
});
assert.deepEqual(
  missing.filter((diagnostic) => diagnostic.severity === 'error').map((diagnostic) => diagnostic.field),
  ['label', 'description', 'scale'],
);
assert.deepEqual(
  missing.filter((diagnostic) => diagnostic.severity === 'hint').map((diagnostic) => diagnostic.field),
  ['positive_examples', 'negative_examples'],
);

const compactWeight = validateCriterionToml({
  file: '/workspace/criteria/safety/weight.toml',
  content: [
    'id="weight"',
    'label="Weight"',
    'description="Compact TOML spacing should still map diagnostics to the field line."',
    'weight=1.4',
    'scale="binary"',
  ].join('\n'),
});
assert.equal(compactWeight.find((diagnostic) => diagnostic.field === 'weight')?.line, 3);
assert.equal(compactWeight.find((diagnostic) => diagnostic.field === 'weight')?.severity, 'error');

console.log('Rubric Studio Open VS Code validator behavior passed.');
