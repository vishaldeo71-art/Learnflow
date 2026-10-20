from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(slots=True)
class Chunk:
    id: str
    course_id: str
    resource_id: str
    resource_name: str
    source_type: str
    content: str
    embedding: list[float]
    start_time: int | None = None
    end_time: int | None = None
    page_number: int | None = None
    slide_number: int | None = None

    def public_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result.pop("embedding", None)
        return result


@dataclass(slots=True)
class Interview:
    id: str
    role: str
    skill_level: str
    interview_type: str
    duration_minutes: int
    resume_text: str
    job_description: str
    candidate_skills: list[str]
    course_context: str = ""
    turns: list[dict[str, str]] = field(default_factory=list)
    completed: bool = False
    scorecard: dict[str, Any] | None = None
    response_language: str = "en"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

