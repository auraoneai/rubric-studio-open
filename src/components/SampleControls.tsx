import { useState } from 'react';
import type { RubricProject, RubricSample, SurfaceMode } from '../domain/rubric';

export function SampleControls({
  project,
  selectedSampleId,
  surface,
  onSelect,
  onAddSample,
}: {
  project: RubricProject;
  selectedSampleId: string;
  surface: SurfaceMode;
  onSelect: (sampleId: string) => void;
  onAddSample: (sample: RubricSample) => void;
}) {
  const [scratch, setScratch] = useState('');

  async function importJsonl(file: File | undefined) {
    if (!file) {
      return;
    }
    const text = await file.text();
    const imported = parseSamples(text, project);
    imported.forEach(onAddSample);
  }

  function pasteScratch() {
    const text = scratch.trim();
    if (!text) {
      return;
    }
    parseSamples(text, project).forEach(onAddSample);
    setScratch('');
  }

  function generateSynthetic() {
    onAddSample({
      id: `synthetic-${Date.now()}`,
      prompt: 'Synthetic calibration prompt generated for rubric smoke testing.',
      response:
        'This response includes concrete steps, names uncertainty, cites where evidence is missing, and declines unsafe requests with a safe alternative.',
      metadata: {
        source: 'synthetic',
        surface,
      },
      goldScores: defaultGoldScores(project),
    });
  }

  return (
    <div className="sample-controls" aria-label="Sample loading controls">
      <label>
        Sample
        <select value={selectedSampleId} onChange={(event) => onSelect(event.target.value)}>
          {project.samples.map((sample) => (
            <option key={sample.id} value={sample.id}>
              {sample.id}
            </option>
          ))}
        </select>
      </label>
      <label className="file-button">
        <span>Load JSONL</span>
        <input
          type="file"
          accept=".jsonl,application/json"
          onChange={(event) => {
            void importJsonl(event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
      </label>
      <button className="ghost-button" type="button" onClick={generateSynthetic}>
        Generate synthetic
      </button>
      <label className="scratch-pane">
        Paste sample
        <textarea
          value={scratch}
          onChange={(event) => setScratch(event.target.value)}
          placeholder='{"id":"scratch-1","prompt":"...","response":"..."}'
        />
      </label>
      <button className="glass-button" type="button" onClick={pasteScratch}>
        Add scratch
      </button>
    </div>
  );
}

function parseSamples(text: string, project: RubricProject): RubricSample[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = lines.length > 1 ? lines : [text.trim()];

  return candidates.map((candidate, index) => {
    try {
      const parsed = JSON.parse(candidate) as Partial<RubricSample>;
      return {
        id: parsed.id || `scratch-${Date.now()}-${index + 1}`,
        prompt: parsed.prompt || 'Scratch sample',
        response: parsed.response || candidate,
        metadata: parsed.metadata || { source: 'paste' },
        goldScores: parsed.goldScores || defaultGoldScores(project),
      };
    } catch {
      return {
        id: `scratch-${Date.now()}-${index + 1}`,
        prompt: 'Scratch sample',
        response: candidate,
        metadata: { source: 'paste' },
        goldScores: defaultGoldScores(project),
      };
    }
  });
}

function defaultGoldScores(project: RubricProject): Record<string, number> {
  return Object.fromEntries(project.criteria.map((criterion, index) => [criterion.id, index % 2 === 0 ? 1 : 0.5]));
}
