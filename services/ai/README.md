# Praxis AI Service

## Run locally

```bash
cd services/ai
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Use OpenAI (optional)

Create `services/ai/.env` (see `services/ai/.env.example`) and add:

```bash
OPENAI_API_KEY=your_key_here
```

Optional knobs:

- `PRAXIS_ACTION_DELAY_MS` (default `60`): delay between action batches, higher = slower painting.
- `PRAXIS_REQUIRE_OPENAI=1`: if set, session errors out instead of falling back.

Style presets:

- `dreamy_oil` (default): atmospheric, painterly lighting; encourages gradients + soft highlights.

## Run with Docker

```bash
cd infra
docker compose up ai
```

WebSocket endpoint: `ws://localhost:8000/ws/session`
Health endpoint: `http://localhost:8000/health`
