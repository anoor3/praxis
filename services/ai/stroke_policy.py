from random import Random
from typing import Optional, Tuple

from schemas import Action, DrawStrokeAction, FillRectAction

from openai_policy import OpenAIError, generate_actions_via_openai


def _palette(prompt: str) -> dict[str, str]:
    p = prompt.lower()
    if "night" in p:
        return {"sky": "#0d1230", "ground": "#1d2f59", "accent": "#b5c5ff", "tree": "#1d2b3f"}
    if "sunset" in p or "orange" in p:
        return {"sky": "#ff8a5c", "ground": "#5f7ea0", "accent": "#ffe6a6", "tree": "#264738"}
    return {"sky": "#78b6ff", "ground": "#70b9d6", "accent": "#f8fbd1", "tree": "#2f5b45"}


def generate_actions_local(prompt: str, width: int, height: int) -> list[Action]:
    palette = _palette(prompt)
    rng = Random(prompt)

    actions: list[Action] = [
        FillRectAction(reason_label="Blocking sky", color=palette["sky"], x=0, y=0, w=width, h=height * 0.74),
        FillRectAction(reason_label="Blocking water", color=palette["ground"], x=0, y=height * 0.74, w=width, h=height * 0.26),
    ]

    for i in range(5):
        x = width * (0.1 + i * 0.18)
        top = height * (0.45 + (i % 2) * 0.1)
        points = [(x, height * 0.82), (x - 22, top + 40), (x, top), (x + 22, top + 40), (x, height * 0.82)]
        actions.append(
            DrawStrokeAction(
                reason_label="Sketching tree silhouettes",
                color=palette["tree"],
                size=3,
                opacity=0.9,
                points=points,
            )
        )

    for _ in range(15):
        y = height * (0.2 + rng.random() * 0.6)
        sx = rng.random() * width
        ex = min(width, sx + 30 + rng.random() * 120)
        actions.append(
            DrawStrokeAction(
                reason_label="Adding painterly highlights",
                color=palette["accent"],
                size=1 + rng.random() * 3,
                opacity=0.12,
                points=[(sx, y), ((sx + ex) / 2, y + rng.uniform(-8, 8)), (ex, y)],
            )
        )
    return actions


def generate_actions_with_meta(prompt: str, width: int, height: int) -> Tuple[list[Action], str, Optional[str]]:
    """Returns (actions, mode, error_message)."""

    try:
        actions = generate_actions_via_openai(prompt, width, height)
        return actions, "openai", None
    except OpenAIError as e:
        actions = generate_actions_local(prompt, width, height)
        return actions, "fallback", str(e)


def generate_actions(prompt: str, width: int, height: int) -> list[Action]:
    actions, _, _ = generate_actions_with_meta(prompt, width, height)
    return actions
