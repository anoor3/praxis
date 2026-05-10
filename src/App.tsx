import { useMemo, useState } from 'react';
import { Studio } from './Studio';

export function App() {
  const [prompt, setPrompt] = useState('Paint a beautiful sunset mountain lake with pine trees');
  const [runId, setRunId] = useState(0);

  const title = useMemo(() => 'Praxis Studio · Give AI Hands', []);

  return (
    <div className="page">
      <header className="hero">
        <h1>{title}</h1>
        <p>
          A live creative agent prototype: type a prompt and watch Praxis plan, move, and paint stroke by
          stroke.
        </p>
      </header>
      <section className="controls">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          placeholder="Describe the art you want Praxis to paint..."
        />
        <div className="buttons">
          <button onClick={() => setRunId((value) => value + 1)}>Start Painting</button>
        </div>
      </section>
      <Studio prompt={prompt} runId={runId} />
    </div>
  );
}
