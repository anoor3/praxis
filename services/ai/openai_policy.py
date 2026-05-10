import json
import os
import urllib.request
from typing import Any

from schemas import Action, DrawStrokeAction, FillRectAction


class OpenAIError(RuntimeError):
    pass


def _coerce_action(obj: dict[str, Any]) -> Action:
    action_type = obj.get("action_type")
    if action_type == "draw_stroke":
        return DrawStrokeAction.model_validate(obj)
    if action_type == "fill_rect":
        return FillRectAction.model_validate(obj)
    raise OpenAIError(f"Unknown action_type: {action_type}")


def generate_actions_via_openai(prompt: str, width: int, height: int) -> list[Action]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise OpenAIError("OPENAI_API_KEY is not set")

    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    max_actions = int(os.getenv("PRAXIS_MAX_ACTIONS", "80"))

    system = (
        "You are a drawing agent that outputs JSON only. "
        "Return a single JSON object with key 'actions'. "
        "Each action must be one of:\n"
        "1) fill_rect: {action_type:'fill_rect', reason_label:str, color:'#RRGGBB', x:number, y:number, w:number, h:number}\n"
        "2) draw_stroke: {action_type:'draw_stroke', reason_label:str, color:'#RRGGBB', opacity:0.05-1.0, size:1-40, points:[[x,y],...] }\n"
        "Rules: use canvas coordinates within width/height; include 2+ points for draw_stroke; "
        "make the painting match the prompt; build up from big shapes to details; output 20-"
        + str(max_actions)
        + " actions."
    )
    user = f"Prompt: {prompt}\nCanvas: width={width}, height={height}."

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.7,
        "response_format": {"type": "json_object"},
    }

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
    except Exception as e:  # noqa: BLE001
        raise OpenAIError(f"OpenAI request failed: {e}") from e

    data = json.loads(body)
    content = data["choices"][0]["message"]["content"]
    decoded = json.loads(content)
    raw_actions = decoded.get("actions", [])
    if not isinstance(raw_actions, list):
        raise OpenAIError("OpenAI response JSON must contain list key 'actions'")

    actions: list[Action] = []
    for raw in raw_actions[:max_actions]:
        if isinstance(raw, dict):
            actions.append(_coerce_action(raw))
    if not actions:
        raise OpenAIError("OpenAI returned zero valid actions")
    return actions

