import { useState } from 'react';
import type { RubricProject, RubricSample, SurfaceMode } from '../domain/rubric';
import { defaultGoldScores, parseJsonlSamples, parseScratchSamples } from '../domain/samples';

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
  const [error, setError] = useState('');

  async function importJsonl(file: File | undefined) {
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const imported = parseJsonlSamples(text, project);
      if (imported.length === 0) {
        setError('No samples were found in the JSONL file.');
        return;
      }
      setError('');
      imported.forEach(onAddSample);
    } catch {
      setError('Sample import failed. Use JSONL rows with id, prompt, and response fields, or paste plain text.');
    }
  }

  function pasteScratch() {
    const text = scratch.trim();
    if (!text) {
      setError('Paste a JSON sample or plain-text response before adding scratch data.');
      return;
    }
    parseScratchSamples(text, project).forEach(onAddSample);
    setError('');
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
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
    </div>
  );
}
