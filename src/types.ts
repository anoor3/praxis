export type DrawStrokeAction = {
  action_type: 'draw_stroke';
  reason_label: string;
  color: string;
  opacity: number;
  size: number;
  points: [number, number][];
};

export type FillRectAction = {
  action_type: 'fill_rect';
  reason_label: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type FillCircleAction = {
  action_type: 'fill_circle';
  reason_label: string;
  color: string;
  x: number;
  y: number;
  r: number;
  opacity: number;
};

export type GradientRectAction = {
  action_type: 'gradient_rect';
  reason_label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  direction: 'vertical' | 'horizontal';
  color_stops: [number, string][];
};

export type Action = DrawStrokeAction | FillRectAction | FillCircleAction | GradientRectAction;
