import { useEffect, useRef, useState } from 'react';
import type { Action } from './types';

const WS_URL = 'ws://localhost:8000/ws/session';

/** Catmull-Rom spline: interpolate between p1 and p2 given neighbors p0, p3 */
function catmullRom(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number,
): [number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 *
    (2 * p1[0] +
      (-p0[0] + p2[0]) * t +
      (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
      (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
  const y =
    0.5 *
    (2 * p1[1] +
      (-p0[1] + p2[1]) * t +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
  return [x, y];
}

/** Subdivide points using Catmull-Rom for smooth curves */
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
  for (let i = 1; i < smooth.length; i += 1) {
    ctx.lineTo(smooth[i][0], smooth[i][1]);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

const STROKE_POINTS_PER_FRAME = 3;
const ACTIONS_PER_SECOND = 6;
const ACTION_COOLDOWN_MS = 1000 / ACTIONS_PER_SECOND;

export function Studio({
  prompt,
  runId,
  stylePreset,
}: {
  prompt: string;
  runId: number;
  stylePreset: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const queueRef = useRef<Action[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastActionAtRef = useRef<number>(0);
  const currentStrokeRef = useRef<
    { action: Extract<Action, { action_type: 'draw_stroke' }>; points: [number, number][]; index: number } | null
  >(null);

  const [feed, setFeed] = useState<string[]>(['Ready. Press “Start Painting”.']);
  const [policyStatus, setPolicyStatus] = useState<string>('');
  const [sessionStatus, setSessionStatus] = useState<'idle' | 'running' | 'paused'>('idle');
  const [currentPhase, setCurrentPhase] = useState<string>('');
  const [palette, setPalette] = useState<string[]>([]);
  const [currentAction, setCurrentAction] = useState<string>('');
  const [instruction, setInstruction] = useState('add golden fog');

  useEffect(() => {
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
    ctx.clearRect(0, 0, width, height);

    const cursor = cursorRef.current;
    if (cursor) {
      cursor.width = width * dpr;
      cursor.height = height * dpr;
      cursor.style.width = `${width}px`;
      cursor.style.height = `${height}px`;
      const cctx = cursor.getContext('2d');
      cctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      cctx?.clearRect(0, 0, width, height);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cursor = cursorRef.current;
    const cctx = cursor?.getContext('2d') ?? null;

    const tick = () => {
      const now = performance.now();

      // Continue the current stroke (point-by-point).
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
        for (let i = current.index + 1; i <= nextIndex; i += 1) {
          ctx.lineTo(points[i][0], points[i][1]);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;

        if (cctx) {
          const [cx, cy] = points[nextIndex];
          const [px, py] = points[Math.max(0, nextIndex - 1)];
          const angle = Math.atan2(cy - py, cx - px);

          cctx.clearRect(0, 0, 900, 540);

          cctx.save();
          cctx.translate(cx, cy);
          cctx.rotate(angle);

          const brushRadius = Math.max(3, action.size / 2);

          // Wooden handle
          cctx.fillStyle = '#8B6914';
          cctx.beginPath();
          cctx.roundRect(-brushRadius * 3.5, -2.5, brushRadius * 2.5, 5, 2);
          cctx.fill();
          cctx.strokeStyle = '#6B4F10';
          cctx.lineWidth = 0.5;
          cctx.stroke();

          // Metal ferrule
          cctx.fillStyle = '#C0C0C0';
          cctx.fillRect(-brushRadius * 1.0, -3, brushRadius * 0.6, 6);
          cctx.strokeStyle = '#888';
          cctx.lineWidth = 0.5;
          cctx.strokeRect(-brushRadius * 1.0, -3, brushRadius * 0.6, 6);

          // Bristles (fan shape with paint color)
          const bristleCount = Math.max(5, Math.round(brushRadius * 1.5));
          for (let b = 0; b < bristleCount; b++) {
            const spread = ((b / (bristleCount - 1)) - 0.5) * brushRadius * 1.4;
            const length = brushRadius * (0.8 + Math.random() * 0.4);
            cctx.strokeStyle = action.color;
            cctx.globalAlpha = 0.6 + Math.random() * 0.4;
            cctx.lineWidth = 1;
            cctx.beginPath();
            cctx.moveTo(-brushRadius * 0.4, spread * 0.3);
            cctx.quadraticCurveTo(length * 0.5, spread * 0.7, length, spread);
            cctx.stroke();
          }

          // Paint blob at tip
          cctx.globalAlpha = 0.85;
          cctx.fillStyle = action.color;
          cctx.beginPath();
          cctx.ellipse(brushRadius * 0.3, 0, brushRadius * 0.7, brushRadius * 0.5, 0, 0, Math.PI * 2);
          cctx.fill();

          // Subtle outer glow for visibility
          cctx.globalAlpha = 0.15;
          cctx.strokeStyle = '#fff';
          cctx.lineWidth = 1;
          cctx.beginPath();
          cctx.arc(0, 0, brushRadius + 4, 0, Math.PI * 2);
          cctx.stroke();

          cctx.restore();
        }

        if (nextIndex >= points.length - 1) {
          currentStrokeRef.current = null;
          cctx?.clearRect(0, 0, 900, 540);
        }
        else currentStrokeRef.current = { action, points, index: nextIndex };
      }

      // Start a new action if idle.
      if (!currentStrokeRef.current) {
        const canConsume = now - lastActionAtRef.current >= ACTION_COOLDOWN_MS;
        const next = canConsume ? queueRef.current.shift() : undefined;
        if (next) {
          lastActionAtRef.current = now;

          if (next.action_type === 'draw_stroke') currentStrokeRef.current = { action: next, points: smoothPoints(next.points), index: 0 };
          else renderAction(ctx, next);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (runId === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setFeed(['Connecting to Praxis AI service...']);
    setPolicyStatus('');
    setSessionStatus('running');
    setCurrentPhase('');
    setPalette([]);
    setCurrentAction('');
    ctx.clearRect(0, 0, 900, 540);
    queueRef.current = [];
    currentStrokeRef.current = null;

    socketRef.current?.close();
    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;

    ws.onopen = () => {
      setFeed((prev) => [...prev, 'Connected. Starting session...']);
      ws.send(
        JSON.stringify({
          type: 'start_session',
          data: { prompt, width: 900, height: 540, style_preset: stylePreset },
        }),
      );
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as { type: string; data: any };

      if (msg.type === 'session_started') {
        setFeed((prev) => [...prev, `Session ${msg.data.session_id} started`]);
        return;
      }

      if (msg.type === 'phase_changed') {
        setCurrentPhase(msg.data.label);
        setFeed((prev) => [...prev, `Phase: ${msg.data.label}`]);
        return;
      }

      if (msg.type === 'policy_status') {
        const detail = msg.data.detail ? ` (${msg.data.detail})` : '';
        const line = `Policy: ${msg.data.mode}${detail}`;
        setPolicyStatus(line);
        setFeed((prev) => [...prev, line]);
        return;
      }

      if (msg.type === 'action_batch') {
        const actions = msg.data.actions as Action[];
        actions.forEach((action) => {
          queueRef.current.push(action);
          setCurrentAction(action.reason_label);
          setFeed((prev) => [...prev, action.reason_label]);
          // Collect unique colors for the palette display
          const color = 'color' in action ? action.color : null;
          if (color) {
            setPalette((prev) => {
              if (prev.includes(color) || prev.length >= 12) return prev;
              return [...prev, color];
            });
          }
        });
        return;
      }

      if (msg.type === 'inspection_result') {
        setFeed((prev) => [...prev, `Inspect: ${msg.data.canvas_state}`]);
        return;
      }

      if (msg.type === 'critique_result') {
        setFeed((prev) => [
          ...prev,
          `Critique: issue=${msg.data.biggest_issue} align=${msg.data.prompt_alignment}`,
        ]);
        return;
      }

      if (msg.type === 'session_finished') {
        setSessionStatus('idle');
        setFeed((prev) => [...prev, `Done. ${msg.data.total_actions} actions.`]);
        return;
      }

      if (msg.type === 'error') {
        setSessionStatus('idle');
        setFeed((prev) => [...prev, `Error: ${msg.data.message}`]);
      }
    };

    ws.onerror = () => {
      setSessionStatus('idle');
      setFeed((prev) => [...prev, 'Backend unavailable. Start AI service on localhost:8000']);
    };

    ws.onclose = () => {
      socketRef.current = null;
    };

    return () => ws.close();
  }, [prompt, runId, stylePreset]);

  const sendControl = (type: string, data?: Record<string, unknown>) => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type, data }));
  };

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
                {palette.map((c) => (
                  <span key={c} className="swatch" style={{ backgroundColor: c }} title={c} />
                ))}
              </div>
            </div>
          )}
          {currentAction && (
            <div className="thinking-action">
              <span className="thinking-label">Thinking</span>
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
          <h3>Live Action Feed</h3>
          {policyStatus ? <p className="policy">{policyStatus}</p> : null}
          <ul>
            {feed.slice(-16).map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </aside>
      </section>

      <div className="runtime-controls">
        <button
          onClick={() => {
            sendControl('pause_session');
            setSessionStatus('paused');
          }}
          disabled={sessionStatus !== 'running'}
        >
          Pause
        </button>
        <button
          onClick={() => {
            sendControl('resume_session');
            setSessionStatus('running');
          }}
          disabled={sessionStatus !== 'paused'}
        >
          Resume
        </button>
        <button
          onClick={() => {
            sendControl('stop_session');
            setSessionStatus('idle');
          }}
        >
          Stop
        </button>
        <input value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        <button onClick={() => sendControl('interrupt_instruction', { instruction })}>Interrupt</button>
      </div>
    </section>
  );
}
