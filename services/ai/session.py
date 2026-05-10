import asyncio
from dataclasses import dataclass
from uuid import uuid4
from fastapi import WebSocket

from critic import score_canvas
from planner import make_phase_plan
from schemas import StartSessionRequest
from session_memory import SessionMemory
from storage import append_event, create_session, set_session_status
from stroke_policy import generate_actions
from vision import inspect_canvas


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
        session_id = str(uuid4())
        memory = SessionMemory(prompt=request.prompt)
        create_session(session_id, request.prompt)

        plan = make_phase_plan(request.prompt)
        await self._send(session_id, "session_started", {"session_id": session_id, "prompt": request.prompt, "phases": plan.phases})

        actions = generate_actions(request.prompt, request.width, request.height)
        actions_per_phase = max(1, len(actions) // len(plan.phases))

        phase_index = 0
        memory.update_phase(plan.phases[phase_index])
        await self._send(session_id, "phase_changed", {"label": plan.phases[phase_index]})

        for index, action in enumerate(actions):
            if self.flags.stopped:
                set_session_status(session_id, "stopped")
                break
            while self.flags.paused and not self.flags.stopped:
                await asyncio.sleep(0.05)

            next_phase_index = min(index // actions_per_phase, len(plan.phases) - 1)
            if next_phase_index != phase_index:
                phase_index = next_phase_index
                memory.update_phase(plan.phases[phase_index])
                await self._send(session_id, "phase_changed", {"label": plan.phases[phase_index]})

            await self._send(session_id, "action_batch", {"start_index": index, "actions": [action.model_dump()]})
            memory.mark_action()

            if index % 6 == 0:
                inspection = inspect_canvas(memory)
                for weak in inspection["weak_regions"]:
                    memory.add_weak_region(str(weak))
                critique = score_canvas(memory, inspection)
                await self._send(session_id, "inspection_result", inspection)
                await self._send(session_id, "critique_result", critique)

            await asyncio.sleep(0.06)

        set_session_status(session_id, "finished")
        await self._send(session_id, "session_finished", {"session_id": session_id, "total_actions": len(actions), "weak_regions": memory.weak_regions})

    async def _send(self, session_id: str, event_type: str, data: dict) -> None:
        append_event(session_id, event_type, data)
        await self.websocket.send_json({"type": event_type, "data": data})

    async def interrupt(self, instruction: str) -> None:
        await self.websocket.send_json({"type": "phase_changed", "data": {"label": f"Adapting to: {instruction}"}})

    def pause(self) -> None:
        self.flags.paused = True

    def resume(self) -> None:
        self.flags.paused = False

    def stop(self) -> None:
        self.flags.stopped = True
