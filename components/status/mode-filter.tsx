import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ModeSelectionValue } from '@/lib/mode-config';

export interface ModeFilterOption {
  value: ModeSelectionValue;
  label: string;
  icon: LucideIcon;
}

interface ModeFilterProps {
  options: ModeFilterOption[];
  selected: ModeSelectionValue;
  onSelect: (value: ModeSelectionValue) => void;
  disabled?: boolean;
  heading?: string;
  description?: string;
  className?: string;
}

export function ModeFilter({
  options,
  selected,
  onSelect,
  disabled = false,
  heading = 'Transport mode',
  description = 'Choose a network to focus these results.',
  className,
}: ModeFilterProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border/70 bg-background/60 p-4 shadow-sm',
        className
      )}
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {heading}
        </p>
        <p className="text-sm text-muted-foreground/80">{description}</p>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {options.map((option) => {
          const Icon = option.icon;
          const isActive = option.value === selected;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              disabled={disabled && !isActive}
              className={cn(
                'flex items-center justify-start gap-3 rounded-lg border px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70',
                isActive
                  ? 'border-primary bg-primary/10 text-primary shadow-sm'
                  : 'border-border/70 bg-white hover:border-primary/40 hover:bg-primary/5'
              )}
            >
              <span
                className={cn(
                  'inline-flex h-9 w-9 items-center justify-center rounded-full border',
                  isActive
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-muted text-muted-foreground'
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="text-left">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

