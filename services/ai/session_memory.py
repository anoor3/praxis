from dataclasses import dataclass, field


@dataclass
class SessionMemory:
    prompt: str
    current_phase: str = "composition"
    completed_actions: int = 0
    weak_regions: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def update_phase(self, phase: str) -> None:
        self.current_phase = phase

    def mark_action(self) -> None:
        self.completed_actions += 1

    def add_weak_region(self, region: str) -> None:
        if region not in self.weak_regions:
            self.weak_regions.append(region)

    def add_note(self, note: str) -> None:
        self.notes.append(note)
