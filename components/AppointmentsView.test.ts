import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AppointmentsView from './AppointmentsView';
import type { Appointment } from '../types';

const appointment: Appointment = {
  id: 'appointment-1', location_id: 'branch-1', patient_id: 'patient-1',
  patient_name: 'Synthetic Patient', doctor_name: 'Synthetic Doctor',
  date: '2099-01-01', time: '10:00', type: 'Checkup', status: 'Scheduled',
};
const props: React.ComponentProps<typeof AppointmentsView> = {
  appointments: [], patients: [], loading: false, currency: 'MMK',
  initialDateQuickFilter: 'all',
  onAddAppointment: () => {}, onEditAppointment: () => {}, onDeleteAppointment: () => {},
  onUpdateStatus: () => {}, onViewChart: () => {}, onSelectPatient: () => {},
  onRefresh: async () => {},
};
const render = (overrides: Partial<typeof props> = {}) =>
  renderToStaticMarkup(React.createElement(AppointmentsView, { ...props, ...overrides }));

describe('AppointmentsView load errors', () => {
  it.each(['table', 'cards'] as const)('replaces empty %s content with an error and Retry', (uiStyle) => {
    const markup = render({ uiStyle, loadError: 'Connection failed. Please try again.' });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Unable to load appointments');
    expect(markup).toContain('Connection failed. Please try again.');
    expect(markup).toContain('Retry</button>');
    expect(markup).not.toMatch(/No (?:upcoming |past )?appointments/);
    expect(markup).not.toContain('<table');
    expect(markup).toContain('placeholder="Search appointments..."');
    expect(markup).toContain('aria-label="Filter appointments by doctor"');
    expect(markup).toContain('aria-label="Filter appointments by treatment"');
    expect(markup).toContain('type="date"');
    const inputs = markup.match(/<input\b[^>]*>/g) || [];
    expect(inputs).toHaveLength(4);
    inputs.forEach((input) => expect(input).not.toContain('disabled=""'));
    expect(markup.slice(markup.indexOf('role="alert"'))).not.toContain('disabled=""');
  });

  it.each(['table', 'cards'] as const)('hides stale %s appointments and pagination on failure', (uiStyle) => {
    const markup = render({ uiStyle, appointments: [appointment], totalAppointments: 100,
      onQueryChange: () => {}, loadError: 'Refresh failed' });
    expect(markup).toContain('Refresh failed');
    expect(markup).not.toContain('Synthetic Patient');
    expect(markup).not.toContain('Upcoming Appointments');
    expect(markup).not.toContain('<table');
    expect(markup).not.toMatch(/No (?:upcoming |past )?appointments/);
  });

  it('keeps the error visible and disables Retry while retrying', () => {
    const markup = render({ appointments: [appointment], loadError: 'Refresh failed', loading: true });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Retrying...</button>');
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain('Synthetic Patient');
  });

  it('does not offer a Retry button without a refresh callback', () => {
    const markup = render({ loadError: 'Refresh failed', onRefresh: undefined });
    expect(markup).toContain('Unable to load appointments');
    expect(markup).not.toContain('Retry</button>');
  });

  it.each([undefined, null, ''])('preserves normal rendering without an active error (%s)', (loadError) => {
    const markup = render({ appointments: [appointment], loadError });
    expect(markup).toContain('Synthetic Patient');
    expect(markup).toContain('<table');
    expect(markup).not.toContain('role="alert"');
    expect(render({ loadError })).toContain('No appointments found');
  });
});
