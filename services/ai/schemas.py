from typing import Literal, Union
from pydantic import BaseModel, Field


class StartSessionRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=500)
    width: int = Field(default=900, ge=320, le=1920)
    height: int = Field(default=540, ge=240, le=1080)


class DrawStrokeAction(BaseModel):
    action_type: Literal["draw_stroke"] = "draw_stroke"
    reason_label: str
    color: str
    opacity: float = Field(ge=0.05, le=1.0)
    size: float = Field(ge=1.0, le=40.0)
    points: list[tuple[float, float]]


class FillRectAction(BaseModel):
    action_type: Literal["fill_rect"] = "fill_rect"
    reason_label: str
    color: str
    x: float
    y: float
    w: float
    h: float


Action = Union[DrawStrokeAction, FillRectAction]
