import json
import os
import urllib.request
from typing import Any, Optional

from schemas import Action, DrawStrokeAction, FillRectAction, FillCircleAction, GradientRectAction


class OpenAIError(RuntimeError):
    pass


def _coerce_action(obj: dict[str, Any]) -> Optional[Action]:
    action_type = obj.get("action_type")
    try:
        if action_type == "draw_stroke":
            return DrawStrokeAction.model_validate(obj)
        if action_type == "fill_rect":
            return FillRectAction.model_validate(obj)
        if action_type == "fill_circle":
            return FillCircleAction.model_validate(obj)
        if action_type == "gradient_rect":
            return GradientRectAction.model_validate(obj)
    except Exception:
        return None
    return None


def _style_block(style_preset: str) -> str:
    presets = {
        "dreamy_oil": (
            "Style: dreamy oil painting. Warm undertones, visible brushwork, "
            "soft lost-and-found edges, atmospheric depth, glazing layers."
        ),
        "watercolor": (
            "Style: loose watercolor. Wet-into-wet bleeds, paper grain showing through, "
            "limited palette, expressive washes, dry-brush details."
        ),
        "impressionist": (
            "Style: impressionist. Broken color, visible dabs, complementary shadows, "
            "light-filled, vibrant and spontaneous."
        ),
    }
    return presets.get(style_preset, f"Style: {style_preset}")


def _request_actions(
    *,
    api_key: str,
    model: str,
    system: str,
    user: str,
    temperature: float,
    timeout_s: int,
) -> list[Action]:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
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
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
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
    for raw in raw_actions:
        if isinstance(raw, dict):
            a = _coerce_action(raw)
            if a is not None:
                actions.append(a)
    return actions


def generate_actions_via_openai(prompt: str, width: int, height: int, style_preset: str = "dreamy_oil") -> list[Action]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise OpenAIError("OPENAI_API_KEY is not set")

    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    min_actions = int(os.getenv("PRAXIS_MIN_ACTIONS", "80"))
    max_actions = int(os.getenv("PRAXIS_MAX_ACTIONS", "200"))
    if max_actions < min_actions:
        max_actions = min_actions

    system = (
        "You are a master painter working on a digital canvas. You paint EXACTLY like a skilled human artist.\n\n"
        "PROCESS — paint in this order:\n"
        "1. BLOCK IN: Large gradient_rect washes to establish atmosphere and value structure.\n"
        "2. UNDERPAINTING: Broad, low-opacity strokes mapping major shapes. Big brush (size 20-40), few points.\n"
        "3. MIDTONES: Build form with overlapping curved strokes. Medium brush (size 8-18), smooth arcs.\n"
        "4. COLOR LAYERS: Glazing — semi-transparent strokes layered to mix color optically.\n"
        "5. DETAILS: Small brush (size 2-6), precise strokes for edges, highlights, texture.\n"
        "6. FINISHING: Tiny accents, sparkle, final darks for contrast.\n\n"
        "STROKE RULES:\n"
        "- Every draw_stroke MUST have 15-50 points forming smooth, flowing curves (like a hand moving).\n"
        "- Points should follow natural arcs, S-curves, and sweeping motions — NEVER straight lines or zigzags.\n"
        "- Vary stroke length: long sweeping strokes for backgrounds, short confident dabs for details.\n"
        "- Overlap strokes slightly — real painters don't leave gaps.\n"
        "- Use opacity 0.1-0.4 for glazing layers, 0.6-1.0 for opaque marks.\n\n"
        "COLOR RULES:\n"
        "- Choose a deliberate limited palette (5-8 base colors) and mix by layering.\n"
        "- Use color temperature: warm light / cool shadows (or vice versa).\n"
        "- Never use pure black (#000000) or pure white (#FFFFFF) — always tinted.\n"
        "- reason_label should describe artistic intent: 'Glazing warm ochre over shadow', 'Dragging sky color into treeline'.\n\n"
        "OUTPUT FORMAT: Single JSON object with key 'actions'. Each action is one of:\n"
        "1) fill_rect: {action_type:'fill_rect', reason_label:str, color:'#RRGGBB', x, y, w, h}\n"
        "2) gradient_rect: {action_type:'gradient_rect', reason_label:str, x, y, w, h, direction:'vertical'|'horizontal', color_stops:[[0-1,'#RRGGBB'],...]}\n"
        "3) fill_circle: {action_type:'fill_circle', reason_label:str, color:'#RRGGBB', x, y, r, opacity:0.05-1.0}\n"
        "4) draw_stroke: {action_type:'draw_stroke', reason_label:str, color:'#RRGGBB', opacity:0.05-1.0, size:1-40, points:[[x,y],...]}\n\n"
        "CONSTRAINTS:\n"
        f"- Output {min_actions}-{max_actions} actions. At least {min_actions} is MANDATORY. More is better.\n"
        "- 90%+ of actions should be draw_stroke. Use gradient_rect only for initial washes (max 3). Avoid fill_circle.\n"
        "- Canvas coordinates: 0,0 is top-left. Stay within width/height.\n"
        "- Build up gradually. No large flat unmodulated areas.\n"
        "- The final result must clearly depict the prompt subject.\n\n"
        + _style_block(style_preset)
    )
    user = (
        f"Paint this scene: {prompt}\n"
        f"Canvas dimensions: {width}x{height} pixels.\n"
        "Begin with atmosphere, then build shapes, then refine. "
        "Make every stroke purposeful and beautiful."
    )

    temperature = float(os.getenv("PRAXIS_TEMPERATURE", "0.8"))
    timeout_s = int(os.getenv("PRAXIS_OPENAI_TIMEOUT_S", "90"))

    actions = _request_actions(
        api_key=api_key,
        model=model,
        system=system,
        user=user,
        temperature=temperature,
        timeout_s=timeout_s,
    )

    # If the model ignores the count constraint, retry once with stronger wording.
    if len(actions) < min_actions:
        retry_system = system + "\nIMPORTANT: If you output fewer actions than required, you have failed."
        actions = _request_actions(
            api_key=api_key,
            model=model,
            system=retry_system,
            user=user,
            temperature=temperature,
            timeout_s=timeout_s,
        )

    actions = actions[:max_actions]
    if len(actions) < min_actions:
        raise OpenAIError(f"OpenAI returned {len(actions)} actions, expected at least {min_actions}")
    return actions
