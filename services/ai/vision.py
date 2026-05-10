from session_memory import SessionMemory


def inspect_canvas(memory: SessionMemory) -> dict[str, object]:
    # placeholder vision heuristic for phase-3 looping.
    weak = []
    if memory.completed_actions < 5:
        weak.append("subject clarity")
    elif memory.completed_actions < 15:
        weak.append("lighting cohesion")
    return {
        "canvas_state": f"phase={memory.current_phase}, actions={memory.completed_actions}",
        "weak_regions": weak,
        "next_focus": weak[0] if weak else "final polish",
    }
