import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ClinicalView from './ClinicalView';
import type { Patient } from '../types';

// Keep browser-oriented diagram/scanner dependencies out of these SSR tests.
// The ClinicalView report button and readiness logic remain real.
vi.mock('./ToothSelector', () => ({ ToothSelector: () => null }));
vi.mock('./PatientQRScanButton', () => ({ default: () => null }));

type Props = React.ComponentProps<typeof ClinicalView>;
const patient: Patient = {
  id: 'patient-1', location_id: 'branch-1', name: 'Synthetic Patient',
  email: '', phone: '', balance: 0, loyalty_points: 0, medicalHistory: '',
};
const props: Props = {
  selectedPatient: patient,
  patients: [patient],
  locations: [], doctors: [], selectedDoctorId: '', selectedTeeth: [],
  treatmentTypes: [], treatmentHistory: [], medicineSales: [], paymentRecords: [],
  patientFiles: [], uploadingFiles: false, useFlatRate: false, currency: 'MMK',
  appointments: [], appointmentTypes: [], loyaltyEnabled: false,
  onToggleTooth: () => {}, onSelectTeeth: () => {}, onDoctorChange: () => {},
  onDeselectAll: () => {}, onTreatmentSubmit: async () => {},
  onPaymentRequest: () => {}, onClosePatient: () => {}, onSelectPatient: () => {},
  onOpenDirectory: () => {}, onUploadFiles: () => {}, onDeleteFile: () => {},
  onGenerateReceipt: () => {}, onToggleFlatRate: () => {},
};

const unavailableMessage = 'Patient report is unavailable while details are loading or could not be loaded. Wait, or reopen this patient to retry.';
const render = (extra: Partial<Props> = {}) =>
  renderToStaticMarkup(React.createElement(ClinicalView, { ...props, ...extra }));

function expectReportReadiness(markup: string, disabled: boolean) {
  // Check this specific button, not unrelated disabled controls in the view.
  const buttons: string[] = markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const reportButtons = buttons.filter((button) => button.includes('About this patient'));
  expect(reportButtons).toHaveLength(1);
  expect(reportButtons[0]).toContain('Open visits, care, medicine and payment report');
  if (disabled) {
    expect(reportButtons[0]).toMatch(/<button\b[^>]*\sdisabled=""/);
    expect(markup).toMatch(new RegExp(`<p[^>]*role="status"[^>]*>${unavailableMessage}</p>`));
  } else {
    expect(reportButtons[0]).not.toMatch(/<button\b[^>]*\sdisabled(?:\s|=|>)/);
    expect(markup).not.toContain(unavailableMessage);
  }
}

const nonPaymentFailures: [string, Partial<Props>][] = [
  ['patient details loading', { patientDetailsLoading: true }],
  ['patient details error', { patientDetailsError: 'Details request failed' }],
  ['treatment history loading', { treatmentHistoryLoading: true }],
  ['treatment history error', { treatmentHistoryError: 'Treatment request failed' }],
  ['medicine history loading', { medicineHistoryLoading: true }],
  ['medicine history error', { medicineHistoryError: 'Medicine request failed' }],
];
const paymentFailures: [string, Partial<Props>][] = [
  ['payment history loading', { paymentHistoryLoading: true }],
  ['payment history error', { paymentHistoryError: 'Payment request failed' }],
];

describe('ClinicalView patient report readiness (SSR)', () => {
  it('enables the report with ready empty histories and default readiness props', () => {
    expectReportReadiness(render(), false);
  });

  it('enables the report when all available data is explicitly ready', () => {
    expectReportReadiness(render({
      patientDetailsLoading: false, patientDetailsError: null,
      treatmentHistoryLoading: false, treatmentHistoryError: null,
      medicineHistoryLoading: false, medicineHistoryError: null,
      paymentsAvailable: true, paymentHistoryLoading: false, paymentHistoryError: null,
    }), false);
  });

  it.each([...nonPaymentFailures, ...paymentFailures])('disables the report for %s', (_name, failure) => {
    expectReportReadiness(render({ paymentsAvailable: true, ...failure }), true);
  });

  it.each([
    ...paymentFailures,
    ['payment history loading and error', { paymentHistoryLoading: true, paymentHistoryError: 'Payment request failed' }],
  ] satisfies [string, Partial<Props>][])('does not block the doctor report for unavailable %s', (_name, failure) => {
    expectReportReadiness(render({ doctorMobileView: true, paymentsAvailable: false, ...failure }), false);
  });

  it.each(nonPaymentFailures)('still blocks the doctor report for %s when payments are unavailable', (_name, failure) => {
    expectReportReadiness(render({ doctorMobileView: true, paymentsAvailable: false, ...failure }), true);
  });
});
