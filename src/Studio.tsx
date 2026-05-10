import { useEffect, useRef, useState } from 'react';

type Palette = {
  skyTop: string;
  skyBottom: string;
  sun: string;
  mountain: string;
  water: string;
  trees: string;
  accent: string;
};

type Action = {
  label: string;
  run: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;
  duration: number;
};

function pickPalette(prompt: string): Palette {
  const lower = prompt.toLowerCase();
  if (lower.includes('night')) {
    return {
      skyTop: '#090a2d', skyBottom: '#2e1f67', sun: '#9ea8ff', mountain: '#1f1f38',
      water: '#1f2e5d', trees: '#1a243d', accent: '#d6dcff'
    };
  }
  if (lower.includes('sunset') || lower.includes('orange')) {
    return {
      skyTop: '#ff7b54', skyBottom: '#ffd56f', sun: '#ffe7ab', mountain: '#72514d',
      water: '#3c6e9d', trees: '#284b3c', accent: '#fff0ce'
    };
  }
  return {
    skyTop: '#66b1ff', skyBottom: '#d4eeff', sun: '#fff8bf', mountain: '#607d8b',
    water: '#6bb7d6', trees: '#35624a', accent: '#f5fffd'
  };
}

function makeActions(palette: Palette): Action[] {
  return [
    {
      label: 'Blocking atmospheric gradient',
      duration: 900,
      run: (ctx, w, h) => {
        const grad = ctx.createLinearGradient(0, 0, 0, h * 0.65);
        grad.addColorStop(0, palette.skyTop);
        grad.addColorStop(1, palette.skyBottom);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
    },
    {
      label: 'Painting glow source',
      duration: 700,
      run: (ctx, w, h, t) => {
        const x = w * 0.72;
        const y = h * 0.26;
        const r = 40 + t * 12;
        const g = ctx.createRadialGradient(x, y, 1, x, y, r);
        g.addColorStop(0, palette.sun);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    },
    {
      label: 'Sketching mountain silhouettes',
      duration: 1300,
      run: (ctx, w, h, t) => {
        ctx.fillStyle = palette.mountain;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.63);
        ctx.lineTo(w * 0.2, h * (0.44 + t * 0.01));
        ctx.lineTo(w * 0.42, h * 0.62);
        ctx.lineTo(w * 0.58, h * 0.39);
        ctx.lineTo(w * 0.78, h * 0.61);
        ctx.lineTo(w, h * 0.5);
        ctx.lineTo(w, h * 0.75);
        ctx.lineTo(0, h * 0.75);
        ctx.closePath();
        ctx.fill();
      }
    },
    {
      label: 'Laying water reflection',
      duration: 1000,
      run: (ctx, w, h, t) => {
        ctx.fillStyle = palette.water;
        ctx.fillRect(0, h * 0.74, w, h * 0.26);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 15; i += 1) {
          const y = h * (0.76 + i * 0.015);
          ctx.beginPath();
          ctx.moveTo((i * 30 + t * 80) % w, y);
          ctx.quadraticCurveTo(w * 0.5, y + 4, ((i + 8) * 40 + t * 90) % w, y + 2);
          ctx.stroke();
        }
      }
    },
    {
      label: 'Adding foreground pines and accents',
      duration: 1500,
      run: (ctx, w, h, t) => {
        ctx.strokeStyle = palette.trees;
        ctx.lineWidth = 4;
        const baseY = h * 0.78;
        [0.1, 0.2, 0.32, 0.81, 0.9].forEach((ratio, idx) => {
          const x = w * ratio;
          const top = h * (0.49 + (idx % 2) * 0.07 - t * 0.01);
          ctx.beginPath();
          ctx.moveTo(x, baseY);
          ctx.lineTo(x, top);
          ctx.stroke();
          for (let i = 0; i < 6; i += 1) {
            const y = top + i * 18;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - (26 - i * 3), y + 6);
            ctx.moveTo(x, y);
            ctx.lineTo(x + (26 - i * 3), y + 6);
            ctx.stroke();
          }
        });
        ctx.fillStyle = palette.accent;
        ctx.fillRect(w * 0.64, h * 0.83, 3, 3);
      }
    }
  ];
}

export function Studio({ prompt, runId }: { prompt: string; runId: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [actions, setActions] = useState<string[]>(['Ready. Press “Start Painting”.']);

  useEffect(() => {
    if (runId === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = 900;
    const height = 540;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const palette = pickPalette(prompt);
    const plan = makeActions(palette);
    setActions(['Planning composition...', 'Starting from blank canvas...']);

    let frameHandle = 0;
    let step = 0;
    let start = performance.now();

    const tick = (now: number) => {
      if (step >= plan.length) {
        setActions((prev) => [...prev, 'Final polish complete. Session finished.']);
        return;
      }

      const current = plan[step];
      const progress = Math.min((now - start) / current.duration, 1);
      current.run(ctx, width, height, progress);

      if (progress >= 1) {
        setActions((prev) => [...prev, current.label]);
        step += 1;
        start = now;
      }

      frameHandle = requestAnimationFrame(tick);
    };

    ctx.clearRect(0, 0, width, height);
    frameHandle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameHandle);
  }, [prompt, runId]);

  return (
    <section className="studio">
      <canvas ref={canvasRef} className="canvas" />
      <aside className="feed">
        <h3>Live Action Feed</h3>
        <ul>
          {actions.slice(-10).map((action, index) => (
            <li key={`${action}-${index}`}>{action}</li>
          ))}
        </ul>
      </aside>
    </section>
  );
}
