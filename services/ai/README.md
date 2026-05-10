# Praxis AI Service

## Run locally

```bash
cd services/ai
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Run tests

```bash
cd services/ai
python -m unittest discover -s tests -p 'test_*.py'
```

## Run with Docker

```bash
cd infra
docker compose up ai
```

WebSocket endpoint: `ws://localhost:8000/ws/session`
Health endpoint: `http://localhost:8000/health`
