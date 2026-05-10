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

export type Action = DrawStrokeAction | FillRectAction;
