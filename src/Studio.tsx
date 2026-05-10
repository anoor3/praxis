import { useEffect, useRef, useState } from 'react';
import type { Action } from './types';

const WS_URL = 'ws://localhost:8000/ws/session';

function renderAction(ctx: CanvasRenderingContext2D, action: Action) {
  if (action.action_type === 'fill_rect') {
    ctx.fillStyle = action.color;
    ctx.fillRect(action.x, action.y, action.w, action.h);
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

export function Studio({ prompt, runId }: { prompt: string; runId: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [feed, setFeed] = useState<string[]>(['Ready. Press “Start Painting”.']);

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
  }, []);

  useEffect(() => {
    if (runId === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setFeed(['Connecting to Praxis AI service...']);
    ctx.clearRect(0, 0, 900, 540);

    if (socketRef.current) {
      socketRef.current.close();
    }

    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;

    ws.onopen = () => {
      setFeed((prev) => [...prev, 'Connected. Starting session...']);
      ws.send(
        JSON.stringify({
          type: 'start_session',
          data: { prompt, width: 900, height: 540 },
        }),
      );
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as { type: string; data: any };

      if (msg.type === 'session_started') {
        setFeed((prev) => [...prev, `Planning phases: ${msg.data.phases.join(' → ')}`]);
      }

      if (msg.type === 'action_emitted') {
        const action = msg.data.action as Action;
        renderAction(ctx, action);
        setFeed((prev) => [...prev, action.reason_label]);
      }

      if (msg.type === 'phase_changed') {
        setFeed((prev) => [...prev, msg.data.label]);
      }

      if (msg.type === 'session_finished') {
        setFeed((prev) => [...prev, `Done. ${msg.data.total_actions} actions executed.`]);
      }

      if (msg.type === 'error') {
        setFeed((prev) => [...prev, `Error: ${msg.data.message}`]);
      }
    };

    ws.onerror = () => {
      setFeed((prev) => [...prev, 'Failed to connect to ws://localhost:8000/ws/session']);
    };

    ws.onclose = () => {
      setFeed((prev) => [...prev, 'Connection closed.']);
    };

    return () => ws.close();
  }, [prompt, runId]);

  return (
    <section className="studio">
      <canvas ref={canvasRef} className="canvas" />
      <aside className="feed">
        <h3>Live Action Feed</h3>
        <ul>
          {feed.slice(-14).map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      </aside>
    </section>
  );
}
