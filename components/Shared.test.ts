import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ConfirmDialog, formatTypedTime } from './Shared';

describe('ConfirmDialog', () => {
  it('renders a warning dialog with clear cancel and confirm actions', () => {
    const markup = renderToStaticMarkup(React.createElement(ConfirmDialog, {
      isOpen: true,
      title: 'Change Commission Method?',
      message: 'Changing the method resets commission amounts.',
      confirmText: 'Change Method',
      cancelText: 'Keep Current Method',
      type: 'warning',
      aboveModal: true,
      onConfirm: () => {},
      onCancel: () => {}
    }));

    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('z-[10000]');
    expect(markup).toContain('Change Commission Method?');
    expect(markup).toContain('Keep Current Method');
    expect(markup).toContain('Change Method');
  });

  it('does not render when closed', () => {
    expect(renderToStaticMarkup(React.createElement(ConfirmDialog, {
      isOpen: false, title: 'Change', message: 'Warning', onConfirm: () => {}, onCancel: () => {}
    }))).toBe('');
  });
});

describe('formatTypedTime', () => {
  it('preserves partial colon input while typing', () => {
    expect(formatTypedTime('10:3', 'AM')).toBe('10:3');
    expect(formatTypedTime('10:', 'AM')).toBe('10:');
  });

  it('formats complete 12-hour input once minutes are complete', () => {
    expect(formatTypedTime('10:30', 'AM')).toBe('10:30');
    expect(formatTypedTime('10:30 PM', 'AM')).toBe('22:30');
  });
});
