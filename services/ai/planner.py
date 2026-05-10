from dataclasses import dataclass


@dataclass
class PhasePlan:
    phases: list[str]


def make_phase_plan(prompt: str) -> PhasePlan:
    _ = prompt
    return PhasePlan(
        phases=[
            "composition",
            "silhouette",
            "color_block",
            "lighting",
            "details",
            "finish",
        ]
    )
