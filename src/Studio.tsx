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
  }, []);

  useEffect(() => {
    if (runId === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setFeed(['Connecting to Praxis AI service...']);
    setSessionStatus('running');
    ctx.clearRect(0, 0, 900, 540);

    socketRef.current?.close();
    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;

    ws.onopen = () => {
      setFeed((prev) => [...prev, 'Connected. Starting session...']);
      ws.send(JSON.stringify({ type: 'start_session', data: { prompt, width: 900, height: 540 } }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as { type: string; data: any };
      if (msg.type === 'session_started') setFeed((prev) => [...prev, `Session ${msg.data.session_id} started`]);
      else if (msg.type === 'phase_changed') setFeed((prev) => [...prev, `Phase: ${msg.data.label}`]);
      else if (msg.type === 'action_batch') {
        const actions = msg.data.actions as Action[];
        actions.forEach((action) => {
          renderAction(ctx, action);
          setFeed((prev) => [...prev, action.reason_label]);
        });
      } else if (msg.type === 'inspection_result') {
        setFeed((prev) => [...prev, `Inspect: ${msg.data.canvas_state}`]);
      } else if (msg.type === 'critique_result') {
        setFeed((prev) => [...prev, `Critique: issue=${msg.data.biggest_issue} align=${msg.data.prompt_alignment}`]);
      } else if (msg.type === 'session_finished') {
        setSessionStatus('idle');
        setFeed((prev) => [...prev, `Done. ${msg.data.total_actions} actions.`]);
      } else if (msg.type === 'error') setFeed((prev) => [...prev, `Error: ${msg.data.message}`]);
    };

    ws.onerror = () => {
      setSessionStatus('idle');
      setFeed((prev) => [...prev, 'Backend unavailable. Start AI service on localhost:8000']);
    };

    return () => ws.close();
  }, [prompt, runId]);

  const sendControl = (type: string, data?: Record<string, unknown>) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type, data }));
  };

  return (
    <section className="studio-wrap">
      <section className="studio">
        <canvas ref={canvasRef} className="canvas" />
        <aside className="feed">
          <h3>Live Action Feed</h3>
          <ul>{feed.slice(-16).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
        </aside>
      </section>
      <div className="runtime-controls">
        <button onClick={() => { sendControl('pause_session'); setSessionStatus('paused'); }} disabled={sessionStatus !== 'running'}>Pause</button>
        <button onClick={() => { sendControl('resume_session'); setSessionStatus('running'); }} disabled={sessionStatus !== 'paused'}>Resume</button>
        <button onClick={() => { sendControl('stop_session'); setSessionStatus('idle'); }}>Stop</button>
        <input value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        <button onClick={() => sendControl('interrupt_instruction', { instruction })}>Interrupt</button>
      </div>
    </section>
  );
}
