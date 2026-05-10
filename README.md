# Praxis

Give AI hands.

Praxis is a live creative machine.
You type an idea.
It thinks in steps.
It paints on a blank canvas.
You watch every move.

This is not prompt to final image magic.
This is thought turning into action.

## What makes Praxis different

Most tools do this:

`prompt -> final image`

Praxis does this:

`prompt -> plan -> draw -> inspect -> fix -> finish`

You can pause it.
You can interrupt it.
You can steer it while it is working.

## The big idea

Imagine an AI mind with a creative body.

- **Brain** picks the next move.
- **Eyes** inspect the canvas.
- **Critic** scores what is weak.
- **Hand** draws strokes one by one.
- **Memory** tracks progress and mistakes.

The final artwork is built in public.
No hidden reveal.
No fake replay.

## What you get in this repo

### Frontend studio

- React + TypeScript + Vite app
- Prompt box
- Live canvas renderer
- Action feed
- Runtime controls: pause, resume, stop, interrupt

### AI backend

- FastAPI service
- WebSocket session endpoint
- Phase planner
- Stroke policy
- Vision + critique loop
- SQLite persistence for sessions and events

### Local dev setup

- Docker compose service for backend
- Python tests for core logic
- Git ignore rules for clean commits

## Quick start

### 1) Start backend

```bash
cd services/ai
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 2) Start frontend

```bash
npm install
npm run dev
```

Open the app and start painting with prompts.

## Run tests

```bash
cd services/ai
python -m unittest discover -s tests -p 'test_*.py'
```

## One line pitch

Figure gives AI a body.
**Praxis gives AI creative hands.**

## Future vision

Today it paints.
Tomorrow it can operate creative software like a pro.

- Design tools
- Animation timelines
- 3D sculpt workflows
- Visual storytelling systems

Praxis is the action layer between AI intelligence and creative software.

That is the mission.
