from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from schemas import StartSessionRequest
from session import SessionRunner
from storage import init_db

app = FastAPI(title="Praxis AI Service", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event() -> None:
    init_db()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws/session")
async def ws_session(websocket: WebSocket) -> None:
    await websocket.accept()
    runner = SessionRunner(websocket)
    try:
        while True:
            payload = await websocket.receive_json()
            msg_type = payload.get("type")

            if msg_type == "start_session":
                request = StartSessionRequest.model_validate(payload.get("data", {}))
                await runner.run(request)
            elif msg_type == "interrupt_instruction":
                await runner.interrupt(payload.get("data", {}).get("instruction", ""))
            elif msg_type == "pause_session":
                runner.pause()
            elif msg_type == "resume_session":
                runner.resume()
            elif msg_type == "stop_session":
                runner.stop()
            else:
                await websocket.send_json({"type": "error", "data": {"message": f"Unknown message type: {msg_type}"}})
    except WebSocketDisconnect:
        runner.stop()
