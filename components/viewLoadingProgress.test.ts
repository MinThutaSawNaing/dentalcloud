import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import DoctorsView from './DoctorsView';
import DashboardView from './DashboardView';

const doctorProps = {
  doctors: [{ id: 'doctor-1', name: 'Synthetic Doctor', location_id: 'branch-1', schedules: [], commission_percentage: 0 }],
  currency: 'MMK' as const, onAdd: () => {}, onEdit: () => {}, onDelete: () => {},
};
const dashboardProps = {
  patients: [], appointments: [], treatmentRecords: [], expenses: [], paymentRecords: [],
  currency: 'MMK' as const, locations: [], selectedLocationId: 'branch-1', allBranchesValue: 'all',
  canViewAllBranches: false, onLocationChange: () => {}, onSelectPatient: () => {},
  onLoadTreatmentAnalysis: async () => [], onLoadMonthlyReport: async () => { throw new Error('Not used'); },
  onUpdateCancellationOutcome: async () => {},
};

describe('Doctors and Overview loading progress', () => {
  it('shows real startup progress and keeps existing doctor cards visible', () => {
    const markup = renderToStaticMarkup(React.createElement(DoctorsView, { ...doctorProps, loading: true, syncProgress: 45 }));
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="45"');
    expect(markup).toContain('Loading doctors and schedules');
    expect(markup).toContain('Synthetic Doctor');
    expect(markup).not.toContain('No doctors found');
  });
  it('hides the doctor progress when loading completes', () => {
    const markup = renderToStaticMarkup(React.createElement(DoctorsView, { ...doctorProps, loading: false }));
    expect(markup).not.toContain('role="progressbar"');
    expect(markup).toContain('Synthetic Doctor');
  });
  it('shows indeterminate Overview progress during a scope refresh', () => {
    const markup = renderToStaticMarkup(React.createElement(DashboardView, { ...dashboardProps, loading: true }));
    expect(markup).toContain('Loading Overview data');
    expect(markup).toContain('progress-indeterminate-stripe');
    expect(markup).not.toContain('aria-valuenow');
  });
  it('shows startup percentage on Overview and hides it after completion', () => {
    const busy = renderToStaticMarkup(React.createElement(DashboardView, { ...dashboardProps, loading: true, syncProgress: 70 }));
    expect(busy).toContain('aria-valuenow="70"');
    const ready = renderToStaticMarkup(React.createElement(DashboardView, { ...dashboardProps, loading: false }));
    expect(ready).not.toContain('Loading Overview data');
  });
});