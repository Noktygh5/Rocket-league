import { CAMERA_DEFAULTS } from '@turboball/shared';

export type Quality = 'low' | 'medium' | 'high';

export const ACTIONS = [
  'throttle', 'reverse', 'left', 'right', 'jump', 'boost', 'powerslide',
  'rollLeft', 'rollRight', 'ballcam', 'scoreboard', 'pause', 'skip',
] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<Action, string> = {
  throttle: 'Throttle / pitch down', reverse: 'Reverse / pitch up', left: 'Steer / yaw left',
  right: 'Steer / yaw right', jump: 'Jump / flip', boost: 'Boost', powerslide: 'Powerslide',
  rollLeft: 'Air roll left', rollRight: 'Air roll right', ballcam: 'Ball cam',
  scoreboard: 'Scoreboard (hold)', pause: 'Pause / menu', skip: 'Skip replay',
};

export interface CameraSettings {
  fov: number; distance: number; height: number; angle: number;
  stiffness: number; swivelSpeed: number; transitionSpeed: number;
}

export interface Settings {
  camera: CameraSettings;
  keys: Record<Action, string>;
  quality: Quality;
  volume: number;
  showFps: boolean;
  showPing: boolean;
  speedUnit: 'kmh' | 'uu';
  name: string;
  /** Start matches with ball cam enabled. */
  ballCamDefault: boolean;
}

export const DEFAULT_KEYS: Record<Action, string> = {
  throttle: 'KeyW', reverse: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', boost: 'ShiftLeft',
  powerslide: 'KeyC', rollLeft: 'KeyQ', rollRight: 'KeyE', ballcam: 'KeyF', scoreboard: 'Tab',
  pause: 'Escape', skip: 'Backspace',
};

export function defaultSettings(): Settings {
  return {
    camera: { ...CAMERA_DEFAULTS },
    keys: { ...DEFAULT_KEYS },
    quality: 'medium',
    volume: 0.6,
    showFps: false,
    showPing: true,
    speedUnit: 'kmh',
    name: 'Player',
    ballCamDefault: true,
  };
}

const KEY = 'turboball.settings.v1';

function load(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      ...d, ...p,
      camera: { ...d.camera, ...(p.camera ?? {}) },
      keys: { ...d.keys, ...(p.keys ?? {}) },
    };
  } catch {
    return d;
  }
}

export const settings: Settings = load();

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode etc. */
  }
}

export function resetCamera(): void {
  settings.camera = { ...CAMERA_DEFAULTS };
  saveSettings();
}

export function keyLabel(code: string): string {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' L').replace('Right', ' R');
}
