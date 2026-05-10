import asyncio
from dataclasses import dataclass
from fastapi import WebSocket

from planner import make_phase_plan
from schemas import StartSessionRequest, DrawStrokeAction, FillRectAction
from stroke_policy import generate_actions


@dataclass
class Flags:
    paused: bool = False
    stopped: bool = False


class SessionRunner:
    def __init__(self, websocket: WebSocket) -> None:
        self.websocket = websocket
        self.flags = Flags()

    async def run(self, request: StartSessionRequest) -> None:
        self.flags = Flags()
        plan = make_phase_plan(request.prompt)
        await self.websocket.send_json({"type": "session_started", "data": {"prompt": request.prompt, "phases": plan.phases}})

        actions = generate_actions(request.prompt, request.width, request.height)

        for index, action in enumerate(actions):
            if self.flags.stopped:
                break
            while self.flags.paused and not self.flags.stopped:
                await asyncio.sleep(0.05)

            await self.websocket.send_json({"type": "action_emitted", "data": {"index": index, "action": action.model_dump()}})
            await asyncio.sleep(0.08)

        await self.websocket.send_json({"type": "session_finished", "data": {"total_actions": len(actions)}})

    async def interrupt(self, instruction: str) -> None:
        await self.websocket.send_json({"type": "phase_changed", "data": {"label": f"Adapting to instruction: {instruction}"}})

    def pause(self) -> None:
        self.flags.paused = True

    def resume(self) -> None:
        self.flags.paused = False

    def stop(self) -> None:
        self.flags.stopped = True
