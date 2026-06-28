from math import sin, cos, pi
from random import Random
from typing import Optional, Tuple

from schemas import Action, DrawStrokeAction, FillRectAction, GradientRectAction, FillCircleAction
from openai_policy import OpenAIError, generate_actions_via_openai


def _palette(prompt: str) -> dict[str, list[str]]:
    """Generate a rich multi-color palette based on the prompt."""
    p = prompt.lower()
    if "night" in p or "dark" in p:
        return {
            "sky": ["#0d1230", "#1a2255", "#0f1940"],
            "mid": ["#2d4470", "#1d3a6b", "#3a5080"],
            "ground": ["#1d2f59", "#162244", "#253d6b"],
            "accent": ["#b5c5ff", "#8fa8e0", "#c8d8ff"],
            "warm": ["#4a3a6b", "#5c4a7a", "#3d2f5c"],
            "detail": ["#e8d090", "#f0e0a0", "#d4c080"],
        }
    if "sunset" in p or "orange" in p or "evening" in p:
        return {
            "sky": ["#ff8a5c", "#ff6b3d", "#e87a50"],
            "mid": ["#c06040", "#d07050", "#a05535"],
            "ground": ["#5f7ea0", "#4a6a8a", "#6b8ab0"],
            "accent": ["#ffe6a6", "#ffd480", "#fff0c0"],
            "warm": ["#ff4a2a", "#cc3a20", "#ff6040"],
            "detail": ["#2a1a10", "#3d2a1a", "#1a1008"],
        }
    if "forest" in p or "tree" in p or "green" in p:
        return {
            "sky": ["#78b6ff", "#5a9ae0", "#90c8ff"],
            "mid": ["#4a8a50", "#3d7a44", "#5a9a5c"],
            "ground": ["#2f5b45", "#254a38", "#3a6b52"],
            "accent": ["#c8e080", "#b0d060", "#e0f0a0"],
            "warm": ["#8a6a30", "#7a5a28", "#9a7a3a"],
            "detail": ["#1a3020", "#0f2018", "#2a4030"],
        }
    # Default: serene lake/mountain
    return {
        "sky": ["#78b6ff", "#5aa0e8", "#90c8ff"],
        "mid": ["#70b9d6", "#5aa0c0", "#80c8e0"],
        "ground": ["#4a7a60", "#3a6a50", "#5a8a70"],
        "accent": ["#f8fbd1", "#e8e8b0", "#fffae0"],
        "warm": ["#d09060", "#c08050", "#e0a070"],
        "detail": ["#2a3a28", "#1a2a18", "#3a4a38"],
    }


def _smooth_curve(rng: Random, x_start: float, y_start: float, x_end: float, y_end: float, num_points: int = 20) -> list[tuple[float, float]]:
    """Generate smooth curve points between two endpoints with natural waviness."""
    points = []
    # Add slight curvature via a control offset
    cx = (x_start + x_end) / 2 + rng.uniform(-40, 40)
    cy = (y_start + y_end) / 2 + rng.uniform(-30, 30)
    for i in range(num_points):
        t = i / (num_points - 1)
        # Quadratic bezier
        x = (1 - t) ** 2 * x_start + 2 * (1 - t) * t * cx + t ** 2 * x_end
        y = (1 - t) ** 2 * y_start + 2 * (1 - t) * t * cy + t ** 2 * y_end
        # Add micro-jitter for hand feel
        x += rng.uniform(-1.5, 1.5)
        y += rng.uniform(-1.5, 1.5)
        points.append((x, y))
    return points


def _wavy_stroke(rng: Random, x: float, y: float, length: float, angle: float, wave: float = 8, num_points: int = 25) -> list[tuple[float, float]]:
    """Generate a wavy brush stroke with natural hand movement."""
    points = []
    for i in range(num_points):
        t = i / (num_points - 1)
        base_x = x + cos(angle) * length * t
        base_y = y + sin(angle) * length * t
        # Perpendicular wave
        perp_angle = angle + pi / 2
        wave_amt = sin(t * pi * (2 + rng.random())) * wave * (1 - abs(t - 0.5) * 1.5)
        px = base_x + cos(perp_angle) * wave_amt + rng.uniform(-1, 1)
        py = base_y + sin(perp_angle) * wave_amt + rng.uniform(-1, 1)
        points.append((px, py))
    return points


def generate_actions_local(prompt: str, width: int, height: int) -> list[Action]:
    palette = _palette(prompt)
    rng = Random(prompt)
    actions: list[Action] = []

    # === PHASE 1: Background washes (gradients) ===
    actions.append(GradientRectAction(
        reason_label="Washing in sky tone",
        x=0, y=0, w=width, h=height * 0.65,
        direction="vertical",
        color_stops=[(0, palette["sky"][0]), (0.5, palette["sky"][1]), (1.0, palette["mid"][0])],
    ))
    actions.append(GradientRectAction(
        reason_label="Establishing ground plane",
        x=0, y=height * 0.6, w=width, h=height * 0.4,
        direction="vertical",
        color_stops=[(0, palette["mid"][1]), (0.6, palette["ground"][0]), (1.0, palette["ground"][1])],
    ))

    # === PHASE 2: Large blocking strokes — atmosphere ===
    for i in range(20):
        y_pos = rng.uniform(0, height * 0.6)
        x_start = rng.uniform(-50, width * 0.3)
        length = rng.uniform(width * 0.3, width * 0.7)
        angle = rng.uniform(-0.15, 0.15)
        points = _wavy_stroke(rng, x_start, y_pos, length, angle, wave=12, num_points=30)
        color = rng.choice(palette["sky"] + palette["mid"])
        actions.append(DrawStrokeAction(
            reason_label="Blocking in atmosphere" if i < 10 else "Building sky depth",
            color=color, size=rng.uniform(18, 35), opacity=rng.uniform(0.08, 0.2),
            points=points,
        ))

    # === PHASE 3: Mid-ground shapes ===
    for i in range(25):
        y_pos = rng.uniform(height * 0.35, height * 0.75)
        x_start = rng.uniform(0, width * 0.8)
        length = rng.uniform(60, 200)
        angle = rng.uniform(-0.5, 0.5)
        points = _wavy_stroke(rng, x_start, y_pos, length, angle, wave=10, num_points=22)
        color = rng.choice(palette["mid"] + palette["ground"])
        actions.append(DrawStrokeAction(
            reason_label="Shaping mid-ground forms",
            color=color, size=rng.uniform(10, 22), opacity=rng.uniform(0.15, 0.35),
            points=points,
        ))

    # === PHASE 4: Foreground structure ===
    # Trees / vertical elements
    num_trees = rng.randint(4, 8)
    for t in range(num_trees):
        tree_x = width * (0.08 + t * (0.84 / num_trees)) + rng.uniform(-30, 30)
        tree_top = height * rng.uniform(0.2, 0.45)
        tree_bottom = height * rng.uniform(0.75, 0.88)

        # Trunk
        trunk_points = _smooth_curve(rng, tree_x, tree_bottom, tree_x + rng.uniform(-8, 8), tree_top, 20)
        actions.append(DrawStrokeAction(
            reason_label="Drawing trunk structure",
            color=rng.choice(palette["detail"]), size=rng.uniform(3, 6), opacity=0.8,
            points=trunk_points,
        ))

        # Foliage — many overlapping strokes
        for _ in range(rng.randint(6, 12)):
            fx = tree_x + rng.uniform(-35, 35)
            fy = rng.uniform(tree_top, tree_top + (tree_bottom - tree_top) * 0.5)
            angle = rng.uniform(0, 2 * pi)
            length = rng.uniform(15, 45)
            points = _wavy_stroke(rng, fx, fy, length, angle, wave=6, num_points=15)
            color = rng.choice(palette["ground"] + palette["mid"][:1])
            actions.append(DrawStrokeAction(
                reason_label="Dabbing foliage",
                color=color, size=rng.uniform(4, 12), opacity=rng.uniform(0.3, 0.7),
                points=points,
            ))

    # === PHASE 5: Lighting and highlights ===
    for i in range(20):
        y_pos = rng.uniform(0, height * 0.7)
        x_start = rng.uniform(0, width)
        length = rng.uniform(40, 150)
        angle = rng.uniform(-0.3, 0.3)
        points = _wavy_stroke(rng, x_start, y_pos, length, angle, wave=5, num_points=18)
        color = rng.choice(palette["accent"])
        actions.append(DrawStrokeAction(
            reason_label="Adding light catches" if i < 10 else "Glazing warm highlights",
            color=color, size=rng.uniform(2, 8), opacity=rng.uniform(0.08, 0.25),
            points=points,
        ))

    # Soft glow circles for atmosphere
    for _ in range(8):
        actions.append(FillCircleAction(
            reason_label="Atmospheric glow",
            color=rng.choice(palette["accent"] + palette["warm"]),
            x=rng.uniform(width * 0.2, width * 0.8),
            y=rng.uniform(height * 0.1, height * 0.5),
            r=rng.uniform(30, 80),
            opacity=rng.uniform(0.05, 0.12),
        ))

    # === PHASE 6: Details and texture ===
    for i in range(30):
        x_start = rng.uniform(0, width)
        y_pos = rng.uniform(height * 0.3, height)
        length = rng.uniform(15, 60)
        angle = rng.uniform(0, 2 * pi)
        points = _wavy_stroke(rng, x_start, y_pos, length, angle, wave=3, num_points=15)
        color = rng.choice(palette["detail"] + palette["warm"])
        actions.append(DrawStrokeAction(
            reason_label="Refining edges" if i < 15 else "Adding texture detail",
            color=color, size=rng.uniform(1.5, 5), opacity=rng.uniform(0.4, 0.8),
            points=points,
        ))

    # Final accent strokes
    for _ in range(15):
        x_start = rng.uniform(0, width)
        y_pos = rng.uniform(0, height)
        length = rng.uniform(20, 80)
        angle = rng.uniform(-0.5, 0.5)
        points = _wavy_stroke(rng, x_start, y_pos, length, angle, wave=4, num_points=12)
        color = rng.choice(palette["accent"] + palette["warm"])
        actions.append(DrawStrokeAction(
            reason_label="Final accent touches",
            color=color, size=rng.uniform(1, 3), opacity=rng.uniform(0.5, 0.9),
            points=points,
        ))

    return actions


def generate_actions_with_meta(
    prompt: str, width: int, height: int, style_preset: str = "dreamy_oil",
) -> Tuple[list[Action], str, Optional[str]]:
    """Returns (actions, mode, error_message)."""
    try:
        actions = generate_actions_via_openai(prompt, width, height, style_preset=style_preset)
        return actions, "openai", None
    except OpenAIError as e:
        actions = generate_actions_local(prompt, width, height)
        return actions, "fallback", str(e)


def generate_actions(prompt: str, width: int, height: int) -> list[Action]:
    actions, _, _ = generate_actions_with_meta(prompt, width, height)
    return actions
