import { useEffect, useRef, useState } from 'react';
import type { Action } from './types';

const WS_URL = 'ws://localhost:8000/ws/session';

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

  ctx.strokeStyle = action.color;
  ctx.lineWidth = action.size;
  ctx.globalAlpha = action.opacity;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(action.points[0][0], action.points[0][1]);
  for (let i = 1; i < action.points.length; i += 1) {
    const [x, y] = action.points[i];
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

const STROKE_POINTS_PER_FRAME = 1;
const ACTIONS_PER_SECOND = 8;
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
    { action: Extract<Action, { action_type: 'draw_stroke' }>; index: number } | null
  >(null);

  const [feed, setFeed] = useState<string[]>(['Ready. Press “Start Painting”.']);
  const [policyStatus, setPolicyStatus] = useState<string>('');
  const [sessionStatus, setSessionStatus] = useState<'idle' | 'running' | 'paused'>('idle');
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
        const { action } = current;
        const nextIndex = Math.min(current.index + STROKE_POINTS_PER_FRAME, action.points.length - 1);

        ctx.strokeStyle = action.color;
        ctx.lineWidth = action.size;
        ctx.globalAlpha = action.opacity;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(action.points[current.index][0], action.points[current.index][1]);
        for (let i = current.index + 1; i <= nextIndex; i += 1) {
          ctx.lineTo(action.points[i][0], action.points[i][1]);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;

        if (cctx) {
          const [cx, cy] = action.points[nextIndex];
          const [px, py] = action.points[Math.max(0, nextIndex - 1)];
          const angle = Math.atan2(cy - py, cx - px);

          cctx.clearRect(0, 0, 900, 540);

          // Brush cursor: a small bristle dot + angled handle.
          cctx.save();
          cctx.translate(cx, cy);
          cctx.rotate(angle);
          cctx.globalAlpha = 0.9;

          cctx.strokeStyle = 'rgba(255,255,255,0.25)';
          cctx.lineWidth = 2;
          cctx.beginPath();
          cctx.moveTo(-14, -10);
          cctx.lineTo(-2, -2);
          cctx.stroke();

          cctx.fillStyle = action.color;
          cctx.beginPath();
          cctx.arc(0, 0, Math.max(2, action.size / 2), 0, Math.PI * 2);
          cctx.fill();

          cctx.restore();
        }

        if (nextIndex >= action.points.length - 1) {
          currentStrokeRef.current = null;
          cctx?.clearRect(0, 0, 900, 540);
        }
        else currentStrokeRef.current = { action, index: nextIndex };
      }

      // Start a new action if idle.
      if (!currentStrokeRef.current) {
        const canConsume = now - lastActionAtRef.current >= ACTION_COOLDOWN_MS;
        const next = canConsume ? queueRef.current.shift() : undefined;
        if (next) {
          lastActionAtRef.current = now;

          if (next.action_type === 'draw_stroke') currentStrokeRef.current = { action: next, index: 0 };
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
          setFeed((prev) => [...prev, action.reason_label]);
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
