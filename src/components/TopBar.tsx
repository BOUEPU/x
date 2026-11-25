import { ArrowRight, Check, Database, FileDown } from 'lucide-react';

export type WizardStep = 1 | 2 | 3 | 4 | 'collector';

interface TopBarProps {
  currentStep: WizardStep;
  maxUnlockedStep: 1 | 2 | 3 | 4;
  loadedCount: number;
  hasResults: boolean;
  onSelectStep: (step: WizardStep) => void;
  onPrimaryAction: () => void;
  primaryActionLabel: string;
  primaryActionDisabled: boolean;
  isExportAction?: boolean;
}

const STEPS: { id: 1 | 2 | 3 | 4; shortLabel: string; label: string }[] = [
  { id: 1, shortLabel: '1. Upload', label: '1. Upload CSVs' },
  { id: 2, shortLabel: '2. Verify', label: '2. Calculate & Verify' },
  { id: 3, shortLabel: '3. Configure', label: '3. Configure Analysis' },
  { id: 4, shortLabel: '4. Results', label: '4. Results Dashboard' },
];

export function TopBar({
  currentStep,
  maxUnlockedStep,
  loadedCount,
  onSelectStep,
  onPrimaryAction,
  primaryActionLabel,
  primaryActionDisabled,
  isExportAction = false,
}: TopBarProps) {
  const collectorUnlocked = loadedCount > 0;
  const collectorActive = currentStep === 'collector';

  return (
    <header className="sticky top-0 z-30 border-b border-[#1E293B] bg-[#0B0F17]/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:h-16 sm:gap-6 sm:px-6">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => onSelectStep(1)}
          className="shrink-0 whitespace-nowrap text-left font-semibold tracking-tight text-slate-100 transition-colors hover:text-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          <span className="text-sm sm:text-base">BTC Correlation Analyzer</span>
        </button>

        {/* Zone 2: 4-Step Progress Stepper + Dedicated Candle Data Collector Tab */}
        <nav
          aria-label="Analysis workflow steps"
          className="hidden min-w-0 items-center gap-1 lg:flex xl:gap-1.5"
        >
          {STEPS.map((step, idx) => {
            const isActive = currentStep === step.id;
            const isUnlocked = step.id <= maxUnlockedStep;
            const isCompleted =
              typeof currentStep === 'number' && step.id < currentStep && isUnlocked;

            return (
              <div key={step.id} className="flex items-center">
                <button
                  type="button"
                  disabled={!isUnlocked}
                  onClick={() => isUnlocked && onSelectStep(step.id)}
                  aria-current={isActive ? 'step' : undefined}
                  className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 xl:px-3 ${
                    isActive
                      ? 'bg-[#162032] text-amber-400'
                      : isUnlocked
                        ? 'text-slate-300 hover:bg-[#111824] hover:text-slate-100'
                        : 'cursor-not-allowed text-slate-600'
                  }`}
                >
                  {isCompleted && (
                    <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                  )}
                  <span>{step.label}</span>
                </button>
                {idx < STEPS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="mx-0.5 h-px w-3 bg-[#1E293B]"
                  />
                )}
              </div>
            );
          })}

          <span
            aria-hidden="true"
            className="mx-1.5 h-4 w-px bg-[#2A3950]"
          />

          <button
            type="button"
            disabled={!collectorUnlocked}
            onClick={() => collectorUnlocked && onSelectStep('collector')}
            aria-current={collectorActive ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 xl:px-3 ${
              collectorActive
                ? 'bg-[#162032] text-amber-400'
                : collectorUnlocked
                  ? 'text-slate-200 hover:bg-[#111824] hover:text-amber-300'
                  : 'cursor-not-allowed text-slate-600'
            }`}
          >
            <Database className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Candle Data Collector</span>
          </button>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            disabled={primaryActionDisabled}
            onClick={onPrimaryAction}
            className={
              isExportAction
                ? 'inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded border border-[#2A3950] bg-[#111824] px-3.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-[#162032] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4'
                : 'inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded bg-amber-500 px-3.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 sm:px-4'
            }
          >
            {isExportAction && primaryActionLabel.toLowerCase().includes('pdf') ? (
              <FileDown className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
            ) : null}
            <span>{primaryActionLabel}</span>
            {!(isExportAction && primaryActionLabel.toLowerCase().includes('pdf')) ? (
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            ) : null}
          </button>
        </div>
      </div>

      {/* Compact step bar on mobile/tablet (< lg) */}
      <nav
        aria-label="Mobile workflow steps"
        className="flex items-center gap-1 overflow-x-auto border-t border-[#1E293B] bg-[#0D131E] px-4 py-1.5 lg:hidden"
      >
        {STEPS.map((step) => {
          const isActive = currentStep === step.id;
          const isUnlocked = step.id <= maxUnlockedStep;
          return (
            <button
              key={step.id}
              type="button"
              disabled={!isUnlocked}
              onClick={() => isUnlocked && onSelectStep(step.id)}
              aria-current={isActive ? 'step' : undefined}
              className={`shrink-0 whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-[#162032] text-amber-400'
                  : isUnlocked
                    ? 'text-slate-300 hover:text-slate-100'
                    : 'cursor-not-allowed text-slate-600'
              }`}
            >
              {step.shortLabel}
            </button>
          );
        })}

        <span aria-hidden="true" className="mx-1 h-3.5 w-px shrink-0 bg-[#2A3950]" />

        <button
          type="button"
          disabled={!collectorUnlocked}
          onClick={() => collectorUnlocked && onSelectStep('collector')}
          aria-current={collectorActive ? 'page' : undefined}
          className={`shrink-0 whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            collectorActive
              ? 'bg-[#162032] text-amber-400'
              : collectorUnlocked
                ? 'text-slate-200 hover:text-amber-300'
                : 'cursor-not-allowed text-slate-600'
          }`}
        >
          Collector
        </button>
      </nav>
    </header>
  );
}

