import type { LucideIcon } from 'lucide-react';
import { Bus, Layers, Ship, Train, TramFront, Zap } from 'lucide-react';

export type ModeKey =
  | 'tube'
  | 'bus'
  | 'dlr'
  | 'overground'
  | 'tram'
  | 'river-bus'
  | 'cable-car';

export interface ModeConfigEntry {
  label: string;
  icon: LucideIcon;
  /**
   * Tailwind-compatible background colour token in hex form (e.g. #0000ff) used to derive inline styles.
   */
  color: string;
}

export const modeConfig: Record<ModeKey, ModeConfigEntry> = {
  tube: { label: 'Underground', icon: Train, color: '#0019A8' },
  bus: { label: 'Buses', icon: Bus, color: '#DC241F' },
  dlr: { label: 'DLR', icon: Train, color: '#00A4A7' },
  overground: { label: 'Overground', icon: Train, color: '#EE7C0E' },
  tram: { label: 'Tram', icon: TramFront, color: '#0BD55C' },
  'river-bus': { label: 'River Bus', icon: Ship, color: '#1C3F94' },
  'cable-car': { label: 'Cable Car', icon: Zap, color: '#A50034' },
};

export const MODE_KEYS = Object.keys(modeConfig) as ModeKey[];

export const ALL_MODE_OPTION = {
  value: 'all' as const,
  label: 'All services',
  icon: Layers,
};

export type AllModeValue = typeof ALL_MODE_OPTION.value;

export type ModeSelectionValue = ModeKey | AllModeValue;

export const isSupportedMode = (value: string | null | undefined): value is ModeKey => {
  if (!value) return false;
  return Object.prototype.hasOwnProperty.call(modeConfig, value);
};

export const normalizeModeSelection = (value: string | null | undefined): ModeSelectionValue => {
  if (!value) return ALL_MODE_OPTION.value;
  return isSupportedMode(value) ? value : ALL_MODE_OPTION.value;
};

export const getModeLabel = (value: ModeSelectionValue): string => {
  if (value === ALL_MODE_OPTION.value) return ALL_MODE_OPTION.label;
  return modeConfig[value]?.label ?? value;
};

