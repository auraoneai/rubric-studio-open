import { useState } from 'react';
import type { ScaleWallPrompt } from '../domain/scaleWalls';

export function ScaleWallCallout({ prompt }: { prompt: ScaleWallPrompt }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return null;
  }

  return (
    <div className={`scale-wall-callout ${prompt.tone}`} role="note">
      <div>
        <strong>{prompt.title}</strong>
        <p>{prompt.body}</p>
        <small>{prompt.cta}</small>
      </div>
      <button
        className="ghost-button"
        type="button"
        aria-label={`Dismiss ${prompt.title}`}
        onClick={() => setDismissed(true)}
      >
        Dismiss
      </button>
    </div>
  );
}
