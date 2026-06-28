import { useEffect, useRef, useState } from 'react';
import type { Action } from './types';

const WS_URL = 'ws://localhost:8000/ws/session';

/** Catmull-Rom spline interpolation */
function catmullRom(
  p0: [number, number], p1: [number, number],
  p2: [number, number], p3: [number, number], t: number,
): [number, number] {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * (2*p1[0] + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
    0.5 * (2*p1[1] + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3),
  ];
}

function smoothPoints(raw: [number, number][], subdivisions = 4): [number, number][] {
  if (raw.length < 3) return raw;
  const result: [number, number][] = [raw[0]];
  for (let i = 0; i < raw.length - 1; i++) {
    const p0 = raw[Math.max(0, i - 1)];
    const p1 = raw[i];
    const p2 = raw[Math.min(raw.length - 1, i + 1)];
    const p3 = raw[Math.min(raw.length - 1, i + 2)];
    for (let s = 1; s <= subdivisions; s++) {
      result.push(catmullRom(p0, p1, p2, p3, s / subdivisions));
    }
  }
  return result;
}

function renderAction(ctx: CanvasRenderingContext2D, action: Action) {
  if (action.action_type === 'fill_rect') {
    ctx.fillStyle = action.color;
    ctx.fillRect(action.x, action.y, action.w, action.h);
    return;
  }
  if (action.action_type === 'gradient_rect') {
    const x2 = action.direction === 'horizontal' ? action.x + action.w : action.x;
    const y2 = action.direction === 'vertical' ? action.y + action.h : action.y;
    const grad = ctx.createLinearGradient(action.x, action.y, x2, y2);
    action.color_stops.forEach(([stop, color]) => grad.addColorStop(stop, color));
    ctx.fillStyle = grad;
    ctx.fillRect(action.x, action.y, action.w, action.h);
    return;
  }
  if (action.action_type === 'fill_circle') {
    ctx.save();
    ctx.globalAlpha = action.opacity;
    ctx.fillStyle = action.color;
    ctx.beginPath();
    ctx.arc(action.x, action.y, action.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  if (action.points.length < 2) return;
  const smooth = smoothPoints(action.points);
  ctx.strokeStyle = action.color;
  ctx.lineWidth = action.size;
  ctx.globalAlpha = action.opacity;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(smooth[0][0], smooth[0][1]);
  for (let i = 1; i < smooth.length; i++) ctx.lineTo(smooth[i][0], smooth[i][1]);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

const STROKE_POINTS_PER_FRAME = 3;
const ACTIONS_PER_SECOND = 6;
const ACTION_COOLDOWN_MS = 1000 / ACTIONS_PER_SECOND;

type FeedItem = { text: string; color?: string; type: 'phase' | 'action' | 'system' | 'critique' };

export function Studio({ prompt, runId, stylePreset }: { prompt: string; runId: number; stylePreset: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const queueRef = useRef<Action[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastActionAtRef = useRef<number>(0);
  const currentStrokeRef = useRef<{ action: Extract<Action, { action_type: 'draw_stroke' }>; points: [number, number][]; index: number } | null>(null);

  const [feedItems, setFeedItems] = useState<FeedItem[]>([{ text: 'Ready. Press "▶ Paint".', type: 'system' }]);
  const [sessionStatus, setSessionStatus] = useState<'idle' | 'running' | 'paused'>('idle');
  const [instruction, setInstruction] = useState('add golden fog');
  const [currentPhase, setCurrentPhase] = useState('');
  const [palette, setPalette] = useState<string[]>([]);
  const [currentAction, setCurrentAction] = useState('');
  const [actionCount, setActionCount] = useState(0);
  const [totalActions, setTotalActions] = useState(0);

  // Canvas setup
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 900 * dpr;
    canvas.height = 540 * dpr;
    canvas.style.width = '900px';
    canvas.style.height = '540px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 900, 540);

    const cursor = cursorRef.current;
    if (cursor) {
      cursor.width = 900 * dpr;
      cursor.height = 540 * dpr;
      cursor.style.width = '900px';
      cursor.style.height = '540px';
      cursor.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }, []);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const cctx = cursorRef.current?.getContext('2d') ?? null;

    const tick = () => {
      const now = performance.now();
      const current = currentStrokeRef.current;

      if (current) {
        const { action, points } = current;
        const nextIndex = Math.min(current.index + STROKE_POINTS_PER_FRAME, points.length - 1);

        ctx.strokeStyle = action.color;
        ctx.lineWidth = action.size;
        ctx.globalAlpha = action.opacity;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(points[current.index][0], points[current.index][1]);
        for (let i = current.index + 1; i <= nextIndex; i++) ctx.lineTo(points[i][0], points[i][1]);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Draw brush cursor
        if (cctx) {
          const [cx, cy] = points[nextIndex];
          const [px, py] = points[Math.max(0, nextIndex - 1)];
          const angle = Math.atan2(cy - py, cx - px);
          cctx.clearRect(0, 0, 900, 540);
          cctx.save();
          cctx.translate(cx, cy);
          cctx.rotate(angle);
          const r = Math.max(3, action.size / 2);

          // Handle
          cctx.fillStyle = '#8B6914';
          cctx.beginPath();
          cctx.roundRect(-r * 3.5, -2.5, r * 2.5, 5, 2);
          cctx.fill();

          // Ferrule
          cctx.fillStyle = '#C0C0C0';
          cctx.fillRect(-r, -3, r * 0.6, 6);

          // Bristles
          const n = Math.max(5, Math.round(r * 1.5));
          for (let b = 0; b < n; b++) {
            const spread = ((b / (n - 1)) - 0.5) * r * 1.4;
            const len = r * (0.8 + Math.random() * 0.4);
            cctx.strokeStyle = action.color;
            cctx.globalAlpha = 0.6 + Math.random() * 0.4;
            cctx.lineWidth = 1;
            cctx.beginPath();
            cctx.moveTo(-r * 0.4, spread * 0.3);
            cctx.quadraticCurveTo(len * 0.5, spread * 0.7, len, spread);
            cctx.stroke();
          }

          // Paint blob
          cctx.globalAlpha = 0.85;
          cctx.fillStyle = action.color;
          cctx.beginPath();
          cctx.ellipse(r * 0.3, 0, r * 0.7, r * 0.5, 0, 0, Math.PI * 2);
          cctx.fill();

          cctx.restore();
        }

        if (nextIndex >= points.length - 1) {
          currentStrokeRef.current = null;
          cctx?.clearRect(0, 0, 900, 540);
        } else {
          currentStrokeRef.current = { action, points, index: nextIndex };
        }
      }

      // Consume next action from queue
      if (!currentStrokeRef.current && now - lastActionAtRef.current >= ACTION_COOLDOWN_MS) {
        const next = queueRef.current.shift();
        if (next) {
          lastActionAtRef.current = now;
          setActionCount((c) => c + 1);
          if (next.action_type === 'draw_stroke') {
            currentStrokeRef.current = { action: next, points: smoothPoints(next.points), index: 0 };
          } else {
            renderAction(ctx, next);
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  // WebSocket session
  useEffect(() => {
    if (runId === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    setFeedItems([{ text: 'Connecting...', type: 'system' }]);
    setSessionStatus('running');
    setCurrentPhase('');
    setPalette([]);
    setCurrentAction('');
    setActionCount(0);
    setTotalActions(0);
    ctx.clearRect(0, 0, 900, 540);
    queueRef.current = [];
    currentStrokeRef.current = null;

    socketRef.current?.close();
    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;

    ws.onopen = () => {
      setFeedItems((p) => [...p, { text: 'Connected. Generating actions...', type: 'system' }]);
      ws.send(JSON.stringify({ type: 'start_session', data: { prompt, width: 900, height: 540, style_preset: stylePreset } }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as { type: string; data: any };

      if (msg.type === 'session_started') {
        setFeedItems((p) => [...p, { text: `Session started`, type: 'system' }]);
      } else if (msg.type === 'phase_changed') {
        setCurrentPhase(msg.data.label);
        setFeedItems((p) => [...p, { text: msg.data.label, type: 'phase' }]);
      } else if (msg.type === 'policy_status') {
        setFeedItems((p) => [...p, { text: `Engine: ${msg.data.mode}`, type: 'system' }]);
      } else if (msg.type === 'action_batch') {
        const actions = msg.data.actions as Action[];
        setTotalActions((t) => t + actions.length);
        actions.forEach((action) => {
          queueRef.current.push(action);
          setCurrentAction(action.reason_label);
          const color = 'color' in action ? (action as any).color as string : undefined;
          if (color) {
            setPalette((prev) => prev.includes(color) || prev.length >= 12 ? prev : [...prev, color]);
          }
          setFeedItems((p) => [...p, { text: action.reason_label, color, type: 'action' }]);
        });
      } else if (msg.type === 'critique_result') {
        setFeedItems((p) => [...p, { text: `Focus: ${msg.data.biggest_issue} (${Math.round(msg.data.prompt_alignment * 100)}% aligned)`, type: 'critique' }]);
      } else if (msg.type === 'session_finished') {
        setSessionStatus('idle');
        setTotalActions(msg.data.total_actions);
        setFeedItems((p) => [...p, { text: `✓ Complete — ${msg.data.total_actions} actions`, type: 'system' }]);
      } else if (msg.type === 'error') {
        setSessionStatus('idle');
        setFeedItems((p) => [...p, { text: `Error: ${msg.data.message}`, type: 'system' }]);
      }
    };

    ws.onerror = () => {
      setSessionStatus('idle');
      setFeedItems((p) => [...p, { text: 'Backend unavailable — start AI service on :8000', type: 'system' }]);
    };
    ws.onclose = () => { socketRef.current = null; };
    return () => ws.close();
  }, [prompt, runId, stylePreset]);

  const sendControl = (type: string, data?: Record<string, unknown>) => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, data }));
  };

  const progress = totalActions > 0 ? Math.min(100, Math.round((actionCount / totalActions) * 100)) : 0;

  return (
    <section className="studio-wrap">
      {sessionStatus !== 'idle' && (
        <div className="thinking-panel">
          <div className="thinking-phase">
            <span className="thinking-label">Phase</span>
            <span className="thinking-value">{currentPhase || 'initializing...'}</span>
          </div>
          {palette.length > 0 && (
            <div className="thinking-palette">
              <span className="thinking-label">Palette</span>
              <div className="palette-swatches">
                {palette.map((c) => <span key={c} className="swatch" style={{ backgroundColor: c }} title={c} />)}
              </div>
            </div>
          )}
          {currentAction && (
            <div className="thinking-action">
              <span className="thinking-label">Intent</span>
              <span className="thinking-value">{currentAction}</span>
            </div>
          )}
        </div>
      )}

      <section className="studio">
        <div className="canvas-stack">
          <canvas ref={canvasRef} className="canvas" />
          <canvas ref={cursorRef} className="cursor" />
        </div>
        <aside className="feed">
          <h3>Activity</h3>
          {totalActions > 0 && (
            <div className="progress-bar-wrap">
              <div className="progress-bar" style={{ width: `${progress}%` }} />
              <span className="progress-text">{actionCount}/{totalActions} strokes</span>
            </div>
          )}
          <ul>
            {feedItems.slice(-20).map((item, i) => (
              <li key={i} className={`feed-item feed-${item.type}`}>
                {item.color && <span className="feed-swatch" style={{ backgroundColor: item.color }} />}
                {item.text}
              </li>
            ))}
          </ul>
        </aside>
      </section>

      <div className="runtime-controls">
        <button onClick={() => { sendControl('pause_session'); setSessionStatus('paused'); }} disabled={sessionStatus !== 'running'}>Pause</button>
        <button onClick={() => { sendControl('resume_session'); setSessionStatus('running'); }} disabled={sessionStatus !== 'paused'}>Resume</button>
        <button onClick={() => { sendControl('stop_session'); setSessionStatus('idle'); }}>Stop</button>
        <input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Redirect the AI..." />
        <button onClick={() => sendControl('interrupt_instruction', { instruction })}>Redirect</button>
      </div>
    </section>
  );
}
