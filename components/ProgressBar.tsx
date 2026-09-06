import React from 'react';

interface ProgressBarProps {
  /**
   * Determinate progress 0-100. Omit/null to render an indeterminate animated bar.
   * A determinate bar is used when the app can report real fetch progress; the
   * indeterminate variant is used when a load duration is unknown (audit log,
   * view refresh) so the screen still communicates activity.
   */
  progress?: number | null;
  /** Short status line shown above the track, e.g. "Loading treatment rows...". */
  label?: string;
  /** Extra className applied to the wrapper. */
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ progress, label, className = '' }) => {
  const determinate = typeof progress === 'number' && Number.isFinite(progress);
  const clamped = determinate ? Math.min(100, Math.max(0, Math.round(progress as number))) : 0;

  return (
    <div
      className={className}
      role="progressbar"
      aria-label={label || 'Loading'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? clamped : undefined}
    >
      {label ? (
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-bold text-slate-500 sm:text-[13px]">{label}</p>
          {determinate ? (
            <span className="text-xs font-black tabular-nums text-slate-400">{clamped}%</span>
          ) : null}
        </div>
      ) : null}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80">
        {determinate ? (
          <div
            className="h-full rounded-full bg-[var(--hover-600)] transition-[width] duration-500 ease-out"
            style={{ width: `${clamped}%` }}
          />
        ) : (
          <div className="progress-indeterminate-stripe h-full w-1/3 rounded-full bg-[var(--hover-500)]" />
        )}
      </div>
    </div>
  );
};

export default ProgressBar;
