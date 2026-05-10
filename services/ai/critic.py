from session_memory import SessionMemory


def score_canvas(memory: SessionMemory, inspection: dict[str, object]) -> dict[str, object]:
    alignment = min(0.95, 0.4 + memory.completed_actions * 0.02)
    composition = min(0.9, 0.45 + memory.completed_actions * 0.015)
    lighting = 0.5 if "lighting cohesion" in inspection.get("weak_regions", []) else 0.78
    biggest_issue = inspection.get("next_focus", "none")
    return {
        "prompt_alignment": round(alignment, 3),
        "composition": round(composition, 3),
        "lighting": round(lighting, 3),
        "biggest_issue": biggest_issue,
    }
