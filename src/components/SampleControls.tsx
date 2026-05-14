import { useEffect, useRef, useState } from 'react';
import type { RubricProject, RubricSample, SurfaceMode } from '../domain/rubric';
import { generateSyntheticTestSample, parseJsonlSamples, parseScratchSamples } from '../domain/samples';

export type SampleAction = 'load-jsonl' | 'paste-sample' | 'generate-synthetic';
export type SampleActionRequest = { action: SampleAction; nonce: number };

export function SampleControls({
  project,
  selectedSampleId,
  surface,
  actionRequest,
  onSelect,
  onAddSample,
}: {
  project: RubricProject;
  selectedSampleId: string;
  surface: SurfaceMode;
  actionRequest: SampleActionRequest | null;
  onSelect: (sampleId: string) => void;
  onAddSample: (sample: RubricSample) => void;
}) {
  const [scratch, setScratch] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scratchRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!actionRequest) {
      return;
    }
    if (actionRequest.action === 'load-jsonl') {
      fileInputRef.current?.focus();
      setError('Choose a JSONL file from the focused loader to add samples.');
    }
    if (actionRequest.action === 'paste-sample') {
      scratchRef.current?.focus();
      setError('');
    }
    if (actionRequest.action === 'generate-synthetic') {
      generateSynthetic();
      setError('');
    }
  }, [actionRequest]);

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
    onAddSample(generateSyntheticTestSample(project, surface));
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
          ref={fileInputRef}
          type="file"
          accept=".jsonl,application/json"
          onChange={(event) => {
            void importJsonl(event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
      </label>
      <button className="ghost-button" type="button" onClick={generateSynthetic}>
        Generate test sample
      </button>
      <label className="scratch-pane">
        Paste sample
        <textarea
          ref={scratchRef}
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
