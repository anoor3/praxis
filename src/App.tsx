import { useState } from 'react';
import { Studio } from './Studio';

const STYLE_PRESETS = [
  { value: 'dreamy_oil', label: 'Dreamy Oil' },
  { value: 'watercolor', label: 'Watercolor' },
  { value: 'impressionist', label: 'Impressionist' },
] as const;

export function App() {
  const [prompt, setPrompt] = useState('Paint a beautiful sunset mountain lake with pine trees');
  const [stylePreset, setStylePreset] = useState('dreamy_oil');
  const [runId, setRunId] = useState(0);

  return (
    <div className="page">
      <header className="hero">
        <h1>Praxis</h1>
        <p className="tagline">Watch AI think, choose colors, and paint — stroke by stroke.</p>
      </header>

      <section className="prompt-bar">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          placeholder="Describe what you want painted..."
        />
        <div className="prompt-actions">
          <div className="style-chips">
            {STYLE_PRESETS.map((s) => (
              <button
                key={s.value}
                className={`chip ${stylePreset === s.value ? 'active' : ''}`}
                onClick={() => setStylePreset(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button className="btn-paint" onClick={() => setRunId((v) => v + 1)}>
            ▶ Paint
          </button>
        </div>
      </section>

      <Studio prompt={prompt} runId={runId} stylePreset={stylePreset} />
    </div>
  );
}
