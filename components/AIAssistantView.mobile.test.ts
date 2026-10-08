import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./AIAssistantView.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

// Layout guards follow the repo's source-test convention. Real device/browser
// checks are still required for CSS geometry and virtual keyboard behavior.
describe('Loli mobile layout guards', () => {
  it('sizes the workspace from the visible viewport and app header', () => {
    expect(app).toContain('data-mobile-app-header');
    expect(source).toContain('window.visualViewport');
    expect(source).toContain("viewport?.addEventListener('resize', updateHeight)");
    expect(source).toContain("viewport?.removeEventListener('resize', updateHeight)");
    expect(source).toContain('observer?.disconnect()');
    expect(source).toContain('h-[var(--loli-mobile-height,100dvh)]');
    expect(source).toContain('lg:h-full');
  });

  it('keeps messages shrinkable and wide tables independently scrollable', () => {
    expect(source).toContain('aria-label="Chat messages"');
    expect(source).toContain('group min-w-0 max-w-[min(100%,76rem)] [overflow-wrap:anywhere]');
    expect(source).toContain('aria-label="Scrollable response table"');
    expect(source).toContain('overflow-x-auto overscroll-x-contain');
  });

  it('keeps mobile composer controls on one row and avoids small input text', () => {
    expect(source).toContain('loli-composer-actions flex w-full flex-row');
    expect(source).toContain('md:flex-col [&>button]:min-h-11');
    expect(source).toContain('aria-label="Message Loli"');
    expect(source).toContain('min-h-[60px] sm:min-h-[72px] min-w-0');
    expect(source).not.toContain('min-h-\\[60px\\]');
    expect(source).toContain('text-base text-gray-700');
    expect(source).toContain('env(safe-area-inset-bottom)');
  });

  it('bounds overlays to the dynamic viewport and wraps the memory toolbar', () => {
    expect(source.match(/max-h-\[90dvh\]/g)).toHaveLength(2);
    expect(source).toContain('flex shrink-0 flex-wrap items-center justify-between gap-3');
    expect(source).toContain('aria-label="Assistant Memory"');
    expect(source).toContain('aria-label="Quick Start Guide"');
  });

  it('provides touch targets, visible focus and reduced motion', () => {
    expect(source).toContain('.loli-workspace button { min-height: 44px; }');
    expect(source).toContain('.loli-workspace button:focus-visible');
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    expect(source).toContain("aria-pressed={mode === 'ask'}");
    expect(source).toContain("aria-pressed={mode === 'agent'}");
  });
});