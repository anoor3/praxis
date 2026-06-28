import { useEffect, useRef, useState } from 'react';
import type { Action } from './types';

const WS_URL = 'ws://localhost:8000/ws/session';

function catmullRom(p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], t: number): [number, number] {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * (2*p1[0] + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
    0.5 * (2*p1[1] + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3),
  ];
}

function smoothPoints(raw: [number, number][], sub = 3): [number, number][] {
  if (raw.length < 3) return raw;
  const r: [number, number][] = [raw[0]];
  for (let i = 0; i < raw.length - 1; i++) {
    const p0 = raw[Math.max(0, i-1)], p1 = raw[i], p2 = raw[Math.min(raw.length-1, i+1)], p3 = raw[Math.min(raw.length-1, i+2)];
    for (let s = 1; s <= sub; s++) r.push(catmullRom(p0, p1, p2, p3, s / sub));
  }
  return r;
}

function renderAction(ctx: CanvasRenderingContext2D, action: Action) {
  if (action.action_type === 'fill_rect') { ctx.fillStyle = action.color; ctx.fillRect(action.x, action.y, action.w, action.h); return; }
  if (action.action_type === 'gradient_rect') {
    const x2 = action.direction === 'horizontal' ? action.x + action.w : action.x;
    const y2 = action.direction === 'vertical' ? action.y + action.h : action.y;
    const g = ctx.createLinearGradient(action.x, action.y, x2, y2);
    action.color_stops.forEach(([s, c]) => g.addColorStop(s, c));
    ctx.fillStyle = g; ctx.fillRect(action.x, action.y, action.w, action.h); return;
  }
  if (action.action_type === 'fill_circle') { ctx.save(); ctx.globalAlpha = action.opacity; ctx.fillStyle = action.color; ctx.beginPath(); ctx.arc(action.x, action.y, action.r, 0, Math.PI*2); ctx.fill(); ctx.restore(); return; }
  if (action.points.length < 2) return;
  const pts = smoothPoints(action.points);
  ctx.strokeStyle = action.color; ctx.lineWidth = action.size; ctx.globalAlpha = action.opacity; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke(); ctx.globalAlpha = 1;
}

function easeInOut(t: number) { return t < 0.5 ? 2*t*t : 1 - (-2*t+2)**2/2; }
function lerp(a: number, b: number, t: number) { return a + (b-a)*t; }

// Palette positioning
const paletteColors: string[] = [];
function getPaletteSlot(color: string): [number, number] {
  let idx = paletteColors.indexOf(color);
  if (idx === -1) { paletteColors.push(color); idx = paletteColors.length - 1; }
  const col = idx % 6, row = Math.floor(idx / 6);
  return [830 - col * 24, 510 - row * 24];
}

// Animation state machine
type Anim =
  | { s: 'idle' }
  | { s: 'travel'; from: [number,number]; to: [number,number]; t: number; color: string; size: number; lifted: boolean; then: AnimNext }
  | { s: 'dip'; pos: [number,number]; color: string; size: number; frame: number; then: AnimNext }
  | { s: 'paint'; action: Extract<Action,{action_type:'draw_stroke'}>; pts: [number,number][]; idx: number };

type AnimNext = { type: 'paint'; action: Extract<Action,{action_type:'draw_stroke'}>; pts: [number,number][] } | { type: 'dip'; pos: [number,number]; color: string; size: number; then: AnimNext };

const PTS_PER_FRAME = 2;
const TRAVEL_SPEED = 0.045;
const DIP_FRAMES = 16;

type FeedItem = { text: string; color?: string; type: 'phase'|'action'|'system'|'critique' };

export function Studio({ prompt, runId, stylePreset }: { prompt: string; runId: number; stylePreset: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const queueRef = useRef<Action[]>([]);
  const rafRef = useRef<number | null>(null);
  const animRef = useRef<Anim>({ s: 'idle' });
  const lastColorRef = useRef('');
  const lastPosRef = useRef<[number,number]>([450, 270]);

  const [feedItems, setFeedItems] = useState<FeedItem[]>([{ text: 'Ready. Press "▶ Paint".', type: 'system' }]);
  const [sessionStatus, setSessionStatus] = useState<'idle'|'running'|'paused'>('idle');
  const [instruction, setInstruction] = useState('');
  const [currentPhase, setCurrentPhase] = useState('');
  const [palette, setPalette] = useState<string[]>([]);
  const [currentAction, setCurrentAction] = useState('');
  const [actionCount, setActionCount] = useState(0);
  const [totalActions, setTotalActions] = useState(0);

  function drawBrush(cctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string, size: number, lifted: boolean) {
    cctx.clearRect(0, 0, 900, 540);
    // Draw palette blobs
    for (let i = 0; i < paletteColors.length; i++) {
      const [px, py] = getPaletteSlot(paletteColors[i]);
      cctx.globalAlpha = 0.85; cctx.fillStyle = paletteColors[i];
      cctx.beginPath(); cctx.arc(px, py, 9, 0, Math.PI*2); cctx.fill();
      cctx.globalAlpha = 0.3; cctx.strokeStyle = '#fff'; cctx.lineWidth = 0.5;
      cctx.stroke(); cctx.globalAlpha = 1;
    }
    cctx.save();
    cctx.translate(x, y);
    cctx.rotate(angle);
    const r = Math.max(3, size / 2);
    const lift = lifted ? -5 : 0;
    if (lifted) { cctx.globalAlpha = 0.15; cctx.fillStyle = '#000'; cctx.beginPath(); cctx.ellipse(2, 4, r+2, r, 0, 0, Math.PI*2); cctx.fill(); cctx.globalAlpha = 1; }
    cctx.fillStyle = '#8B6914'; cctx.beginPath(); cctx.roundRect(-r*3.2, -2+lift, r*2.2, 4, 2); cctx.fill();
    cctx.fillStyle = '#B0B0B0'; cctx.fillRect(-r*1.0, -2.5+lift, r*0.5, 5);
    const n = Math.max(4, Math.round(r));
    for (let b = 0; b < n; b++) {
      const sp = ((b/(n-1))-0.5)*r*1.2, len = r*(0.7+Math.random()*0.3);
      cctx.strokeStyle = color; cctx.globalAlpha = 0.5+Math.random()*0.5; cctx.lineWidth = 1;
      cctx.beginPath(); cctx.moveTo(-r*0.3, sp*0.3+lift); cctx.quadraticCurveTo(len*0.5, sp*0.6+lift, len, sp+lift); cctx.stroke();
    }
    cctx.globalAlpha = 0.8; cctx.fillStyle = color; cctx.beginPath(); cctx.ellipse(r*0.2, lift, r*0.5, r*0.35, 0, 0, Math.PI*2); cctx.fill();
    cctx.restore();
  }

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    c.width = 900*dpr; c.height = 540*dpr; c.style.width = '900px'; c.style.height = '540px';
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,900,540);
    const cur = cursorRef.current;
    if (cur) { cur.width = 900*dpr; cur.height = 540*dpr; cur.style.width = '900px'; cur.style.height = '540px'; cur.getContext('2d')?.setTransform(dpr,0,0,dpr,0,0); }
  }, []);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    const cctx = cursorRef.current?.getContext('2d') ?? null;

    const tick = () => {
      const a = animRef.current;

      if (a.s === 'paint') {
        const { action, pts } = a;
        const next = Math.min(a.idx + PTS_PER_FRAME, pts.length - 1);
        ctx.strokeStyle = action.color; ctx.lineWidth = action.size; ctx.globalAlpha = action.opacity;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(pts[a.idx][0], pts[a.idx][1]);
        for (let i = a.idx+1; i <= next; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke(); ctx.globalAlpha = 1;
        if (cctx) {
          const [cx,cy] = pts[next], [px,py] = pts[Math.max(0,next-1)];
          drawBrush(cctx, cx, cy, Math.atan2(cy-py, cx-px), action.color, action.size, false);
        }
        if (next >= pts.length-1) { lastPosRef.current = pts[next]; animRef.current = { s: 'idle' }; }
        else animRef.current = { ...a, idx: next };

      } else if (a.s === 'travel') {
        const newT = Math.min(1, a.t + TRAVEL_SPEED);
        const e = easeInOut(newT);
        const x = lerp(a.from[0], a.to[0], e), y = lerp(a.from[1], a.to[1], e);
        const ang = Math.atan2(a.to[1]-a.from[1], a.to[0]-a.from[0]);
        if (cctx) drawBrush(cctx, x, y, ang, a.color, a.size, true);
        if (newT >= 1) {
          lastPosRef.current = a.to;
          const nx = a.then;
          if (nx.type === 'dip') animRef.current = { s: 'dip', pos: nx.pos, color: nx.color, size: nx.size, frame: 0, then: nx.then };
          else animRef.current = { s: 'paint', action: nx.action, pts: nx.pts, idx: 0 };
        } else animRef.current = { ...a, t: newT };

      } else if (a.s === 'dip') {
        const t = a.frame / DIP_FRAMES;
        const [px, py] = a.pos;
        const bobY = py + Math.sin(t * Math.PI * 3) * 5;
        if (cctx) drawBrush(cctx, px, bobY, -0.4, a.color, a.size, false);
        if (a.frame >= DIP_FRAMES) {
          lastColorRef.current = a.color;
          const nx = a.then;
          if (nx.type === 'paint') {
            // Travel from palette to stroke start
            animRef.current = { s: 'travel', from: a.pos, to: nx.pts[0], t: 0, color: a.color, size: a.size, lifted: true, then: nx };
          } else {
            animRef.current = { s: 'dip', pos: nx.pos, color: nx.color, size: nx.size, frame: 0, then: nx.then };
          }
        } else animRef.current = { ...a, frame: a.frame + 1 };

      } else {
        // Idle — consume next
        const next = queueRef.current.shift();
        if (next) {
          setActionCount(c => c + 1);
          if (next.action_type === 'draw_stroke') {
            const pts = smoothPoints(next.points);
            const start: [number,number] = pts[0];
            const colorChanged = next.color !== lastColorRef.current && lastColorRef.current !== '';
            const paintNext: AnimNext = { type: 'paint', action: next, pts };

            if (colorChanged) {
              getPaletteSlot(next.color);
              const dipPos = getPaletteSlot(next.color);
              const dipNext: AnimNext = { type: 'dip', pos: dipPos, color: next.color, size: next.size, then: paintNext };
              animRef.current = { s: 'travel', from: lastPosRef.current, to: dipPos, t: 0, color: lastColorRef.current || '#888', size: next.size, lifted: true, then: dipNext };
            } else {
              lastColorRef.current = next.color;
              const dist = Math.hypot(start[0]-lastPosRef.current[0], start[1]-lastPosRef.current[1]);
              if (dist > 40) {
                animRef.current = { s: 'travel', from: lastPosRef.current, to: start, t: 0, color: next.color, size: next.size, lifted: true, then: paintNext };
              } else {
                animRef.current = { s: 'paint', action: next, pts, idx: 0 };
              }
            }
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

  useEffect(() => {
    if (runId === 0) return;
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d')!;

    setFeedItems([{ text: 'Connecting...', type: 'system' }]);
    setSessionStatus('running'); setCurrentPhase(''); setPalette([]); setCurrentAction(''); setActionCount(0); setTotalActions(0);
    ctx.clearRect(0, 0, 900, 540);
    queueRef.current = []; animRef.current = { s: 'idle' };
    lastColorRef.current = ''; lastPosRef.current = [450, 270];
    paletteColors.length = 0;

    socketRef.current?.close();
    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;

    ws.onopen = () => {
      setFeedItems(p => [...p, { text: 'Connected. Generating...', type: 'system' }]);
      ws.send(JSON.stringify({ type: 'start_session', data: { prompt, width: 900, height: 540, style_preset: stylePreset } }));
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as { type: string; data: any };
      if (msg.type === 'session_started') { setFeedItems(p => [...p, { text: 'Session started', type: 'system' }]); }
      else if (msg.type === 'phase_changed') { setCurrentPhase(msg.data.label); setFeedItems(p => [...p, { text: msg.data.label, type: 'phase' }]); }
      else if (msg.type === 'policy_status') { setFeedItems(p => [...p, { text: `Engine: ${msg.data.mode}`, type: 'system' }]); }
      else if (msg.type === 'action_batch') {
        const actions = msg.data.actions as Action[];
        setTotalActions(t => t + actions.length);
        actions.forEach(action => {
          queueRef.current.push(action);
          setCurrentAction(action.reason_label);
          const color = 'color' in action ? (action as any).color as string : undefined;
          if (color) setPalette(prev => prev.includes(color) || prev.length >= 14 ? prev : [...prev, color]);
          setFeedItems(p => [...p, { text: action.reason_label, color, type: 'action' }]);
        });
      }
      else if (msg.type === 'critique_result') { setFeedItems(p => [...p, { text: `Focus: ${msg.data.biggest_issue}`, type: 'critique' }]); }
      else if (msg.type === 'session_finished') { setSessionStatus('idle'); setTotalActions(msg.data.total_actions); setFeedItems(p => [...p, { text: `✓ Done — ${msg.data.total_actions} strokes`, type: 'system' }]); }
      else if (msg.type === 'error') { setSessionStatus('idle'); setFeedItems(p => [...p, { text: `Error: ${msg.data.message}`, type: 'system' }]); }
    };
    ws.onerror = () => { setSessionStatus('idle'); setFeedItems(p => [...p, { text: 'Backend unavailable', type: 'system' }]); };
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
          <div className="thinking-phase"><span className="thinking-label">Phase</span><span className="thinking-value">{currentPhase || 'starting...'}</span></div>
          {palette.length > 0 && (
            <div className="thinking-palette"><span className="thinking-label">Palette</span>
              <div className="palette-swatches">{palette.map(c => <span key={c} className="swatch" style={{ backgroundColor: c }} title={c} />)}</div>
            </div>
          )}
          {currentAction && <div className="thinking-action"><span className="thinking-label">Intent</span><span className="thinking-value">{currentAction}</span></div>}
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
              <span className="progress-text">{actionCount}/{totalActions}</span>
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
        <input value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="Redirect the AI..." />
        <button onClick={() => sendControl('interrupt_instruction', { instruction })}>Redirect</button>
      </div>
    </section>
  );
}
