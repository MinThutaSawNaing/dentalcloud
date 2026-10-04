import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PatientsView from './PatientsView';

// SSR cannot click controls. Seed existing hook state to cover active filters
// and the details panel without adding production-only testing props.
const state = vi.hoisted(() => ({ index: 0, overrides: new Map<number, unknown>() }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => actual.useState(
      state.overrides.has(state.index) ? state.overrides.get(state.index++) : (state.index++, initial)
    ),
  };
});

const patient = { id: 'patient-1', location_id: 'branch-1', name: 'Synthetic Patient', email: '', phone: '', loyalty_points: 0, balance: 0, medicalHistory: '' };
const props = {
  patients: [patient], patientTypes: [], locations: [], appointments: [],
  loading: false, currency: 'MMK' as const, loyaltyEnabled: false,
  onSelectPatient: () => {}, onAddPatient: () => {}, onLoadHistory: () => {},
};
const render = (extra: Partial<React.ComponentProps<typeof PatientsView>> = {}) => {
  state.index = 0;
  return renderToStaticMarkup(React.createElement(PatientsView, { ...props, ...extra }));
};
afterEach(() => state.overrides.clear());

describe('PatientsView optional history readiness', () => {
  it('preserves existing empty-history behavior by default', () => {
    const markup = render();
    expect(markup).toContain('No visits');
    expect(markup).toContain('Next : -');
    expect(markup).not.toContain('Load history');
    expect(markup).not.toMatch(/<fieldset[^>]*\sdisabled=""/);
  });

  it('shows placeholders on desktop/mobile and disables only history controls', () => {
    const markup = render({ historyReady: false });
    expect(markup).toContain('Patient history is not loaded yet. Load history to see all visit dates, treatments, and history filters.');
    expect(markup).toMatch(/<fieldset disabled="" aria-label="Patient history filters"/);
    expect(markup.match(/Next : Load history/g)).toHaveLength(2);
    expect(markup.match(/>Load history</g)).toHaveLength(5);
    expect(markup).not.toContain('No visits');
    expect(markup).not.toContain('Next : -');
    const registrationControls = markup.split('<fieldset')[0];
    expect(registrationControls).toContain('type="date"');
    expect(registrationControls).not.toContain('disabled=""');
  });

  it('shows an error and Retry, with Loading taking precedence and disabling the action', () => {
    const failed = render({ historyReady: false, historyError: 'History request failed' });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('History request failed');
    expect(failed).toContain('>Retry</button>');
    const busy = render({ historyReady: false, historyLoading: true, historyError: 'History request failed' });
    expect(busy).toMatch(/<button type="button" disabled=""[^>]*>Loading<\/button>/);
    expect(busy).not.toContain('>Retry</button>');
    expect(render({ historyReady: false, onLoadHistory: undefined })).toMatch(/<button type="button" disabled=""[^>]*>Load history<\/button>/);
  });

  it('ignores previously active history filters after readiness resets', () => {
    state.overrides.set(6, 'custom');
    state.overrides.set(7, '2020-01-01');
    state.overrides.set(8, '2020-12-31');
    state.overrides.set(9, 'id:doctor-1');
    state.overrides.set(10, 'Cleaning');
    expect(render()).not.toContain('Synthetic Patient');
    const markup = render({ historyReady: false });
    expect(markup.match(/Synthetic Patient/g)).toHaveLength(2);
    expect(markup).toMatch(/<fieldset disabled=""[\s\S]*value="2020-01-01"/);
  });

  it('keeps details from claiming no treatments when history is unavailable', () => {
    state.overrides.set(20, patient);
    const markup = render({ historyReady: false });
    expect(markup).toContain('Treatment and Diagnosis');
    expect(markup).toContain('>Load history</p>');
    expect(markup).not.toContain('No Treatment and Diagnosis records available.');
    expect(render()).toContain('No Treatment and Diagnosis records available.');
  });

  it('retains server search results and hides the banner once ready', () => {
    state.overrides.set(2, 'remote');
    const markup = render({ searchResults: [{ ...patient, id: 'remote', name: 'Remote Result' }] });
    expect(markup).toContain('Remote Result');
    expect(markup).not.toContain('Synthetic Patient');
    expect(markup).not.toContain('Patient history is not loaded yet');
  });
});
