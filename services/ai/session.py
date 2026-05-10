import asyncio
from dataclasses import dataclass
import os
from uuid import uuid4

from fastapi import WebSocket

from critic import score_canvas
from planner import make_phase_plan
from schemas import StartSessionRequest
from session_memory import SessionMemory
from storage import append_event, create_session, init_db, set_session_status
from stroke_policy import generate_actions_with_meta
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
        init_db()

        session_id = str(uuid4())
        memory = SessionMemory(prompt=request.prompt)
        create_session(session_id, request.prompt)

        plan = make_phase_plan(request.prompt)
        await self._send(
            session_id,
            "session_started",
            {
                "session_id": session_id,
                "prompt": request.prompt,
                "phases": plan.phases,
            },
        )

        actions, mode, mode_error = generate_actions_with_meta(
            request.prompt,
            request.width,
            request.height,
            style_preset=request.style_preset or "dreamy_oil",
        )
        await self._send(
            session_id,
            "policy_status",
            {
                "mode": mode,
                "detail": mode_error,
            },
        )

        require_openai = os.getenv("PRAXIS_REQUIRE_OPENAI") == "1"
        if require_openai and mode != "openai":
            set_session_status(session_id, "error")
            await self._send(
                session_id,
                "error",
                {"message": f"OpenAI required but unavailable: {mode_error}"},
            )
            return

        delay_ms = int(os.getenv("PRAXIS_ACTION_DELAY_MS", "60"))
        delay_s = max(0.0, delay_ms / 1000.0)
        actions_per_phase = max(1, len(actions) // max(1, len(plan.phases)))

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

            await self._send(
                session_id,
                "action_batch",
                {"start_index": index, "actions": [action.model_dump()]},
            )
            memory.mark_action()

            if index % 6 == 0:
                inspection = inspect_canvas(memory)
                for weak in inspection.get("weak_regions", []):
                    memory.add_weak_region(str(weak))

                critique = score_canvas(memory, inspection)
                await self._send(session_id, "inspection_result", inspection)
                await self._send(session_id, "critique_result", critique)

            await asyncio.sleep(delay_s)

        if not self.flags.stopped:
            set_session_status(session_id, "finished")
            await self._send(
                session_id,
                "session_finished",
                {
                    "session_id": session_id,
                    "total_actions": len(actions),
                    "weak_regions": memory.weak_regions,
                },
            )

    async def _send(self, session_id: str, event_type: str, data: dict) -> None:
        append_event(session_id, event_type, data)
        await self.websocket.send_json({"type": event_type, "data": data})

    async def interrupt(self, instruction: str) -> None:
        label = f"Adapting to: {instruction}" if instruction else "Adapting to new instruction"
        await self.websocket.send_json({"type": "phase_changed", "data": {"label": label}})

    def pause(self) -> None:
        self.flags.paused = True

    def resume(self) -> None:
        self.flags.paused = False

    def stop(self) -> None:
        self.flags.stopped = True
