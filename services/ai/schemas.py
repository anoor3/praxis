from typing import Literal, Union, Optional
from pydantic import BaseModel, Field


class StartSessionRequest(BaseModel):
    # Longer prompts are useful for style/art direction.
    prompt: str = Field(min_length=3, max_length=4000)
    width: int = Field(default=900, ge=320, le=1920)
    height: int = Field(default=540, ge=240, le=1080)
    style_preset: Optional[str] = Field(default=None, max_length=64)


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


class FillCircleAction(BaseModel):
    action_type: Literal["fill_circle"] = "fill_circle"
    reason_label: str
    color: str
    x: float
    y: float
    r: float
    opacity: float = Field(default=1.0, ge=0.05, le=1.0)


class GradientRectAction(BaseModel):
    action_type: Literal["gradient_rect"] = "gradient_rect"
    reason_label: str
    x: float
    y: float
    w: float
    h: float
    direction: Literal["vertical", "horizontal"] = "vertical"
    color_stops: list[tuple[float, str]] = Field(min_length=2)


Action = Union[DrawStrokeAction, FillRectAction, FillCircleAction, GradientRectAction]
