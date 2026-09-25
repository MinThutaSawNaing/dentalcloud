import type { ClinicalRecord, PaymentRecord, TreatmentCostSummary } from '../types';
import type { Currency } from './currency';
import { allocateCommissionablePayments } from './doctorCommissionLedger';
import {
  dedupePaymentRecords,
  getPaymentTreatmentIds,
  getPaymentTreatmentShare
} from './paymentTreatmentAllocation';
import { chunkUniqueIds, REPORT_URL_BATCH_SIZE } from './reportBatching';

export interface MonthlyReportSourceRecord extends ClinicalRecord {
  patient_age?: number | null;
  patient_phone?: string | null;
  patient_city?: string | null;
  patient_township?: string | null;
}

export interface MonthlyReportData {
  records: MonthlyReportSourceRecord[];
  allocationRecords?: MonthlyReportSourceRecord[];
  payments: PaymentRecord[];
  costSummaries: Record<string, TreatmentCostSummary>;
  dateFrom?: string;
  dateTo?: string;
}

export interface MonthlyReportRow {
  treatmentId: string;
  date: string;
  patientId: string;
  patientName: string;
  age: number | null;
  phone: string;
  city: string;
  township: string;
  patientType: string;
  treatment: string;
  doctor: string;
  cost: number;
  payment: number;
  balance: number;
  labCost: number;
  materialCost: number;
  specialDoctorCost: number;
  doctorCost: number;
  totalCost: number;
  netProfit: number;
  netMargin: number;
}

export interface MonthlyReportDetailRow extends MonthlyReportRow {
  treatmentIds: string[];
  treatmentCount: number;
}

export interface MonthlyReportSummary {
  treatmentCount: number;
  patientCount: number;
  production: number;
  payment: number;
  balance: number;
  labCost: number;
  materialCost: number;
  specialDoctorCost: number;
  doctorCost: number;
  totalCost: number;
  netProfit: number;
  netMargin: number;
  collectionRate: number;
}

export interface MonthlyReportGroup {
  name: string;
  treatments: number;
  patients: number;
  production: number;
  payment: number;
  totalCost: number;
  netProfit: number;
  netMargin: number;
}

export interface MonthlyReport {
  rows: MonthlyReportRow[];
  // Detail rows are date-based: treatment production stays on the treatment
  // date, while later collections are represented by zero-production rows on
  // their payment dates. `rows` remains the treatment-only source used by the
  // report summaries and analysis groups.
  detailRows?: MonthlyReportRow[];
  summary: MonthlyReportSummary;
  byTreatment: MonthlyReportGroup[];
  byDoctor: MonthlyReportGroup[];
  byPatientType: MonthlyReportGroup[];
}

export interface MonthlyReportMetadata {
  dateFrom: string;
  dateTo: string;
  locationName: string;
  currency: Currency;
  generatedAt?: Date;
}

export interface MonthlyReportProgress {
  percent: number;
  label: string;
}

export type MonthlyReportProgressCallback = (progress: MonthlyReportProgress) => void;

// Keep PostgREST `in.(...)` URLs below production proxy limits. Larger UUID batches can
// be rejected by the gateway before CORS headers are added, which browsers report as a
// misleading CORS failure rather than an HTTP 414/502 response.
export const MONTHLY_REPORT_PATIENT_BATCH_SIZE = REPORT_URL_BATCH_SIZE;

export const chunkMonthlyReportPatientIds = (patientIds: string[]): string[][] => chunkUniqueIds(patientIds);

const money = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : 0;
};

const positiveMoney = (value: unknown): number => Math.max(0, money(value));

const combineLabels = (labels: string[]): string => {
  const counts = new Map<string, number>();
  labels.forEach(label => counts.set(label, (counts.get(label) || 0) + 1));
  return Array.from(counts, ([label, count]) => count > 1 ? `${label} ×${count}` : label).join('; ');
};

const combineDistinctLabels = (labels: string[]): string => Array.from(new Set(labels)).join('; ');

const isValidLocalDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export const groupMonthlyReportDetailRows = (rows: MonthlyReportRow[]): MonthlyReportDetailRow[] => {
  const groups = new Map<string, MonthlyReportRow[]>();

  rows.forEach((row, index) => {
    const hasPatientId = Boolean(row.patientId?.trim());
    const hasLocalDate = isValidLocalDate(row.date || '');
    const key = hasPatientId && hasLocalDate
      ? `${row.patientId.trim()}|${row.date}`
      : `treatment:${row.treatmentId || index}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  });

  return Array.from(groups.values()).map(group => {
    const sortedGroup = [...group].sort((a, b) => a.treatmentId.localeCompare(b.treatmentId));
    const first = sortedGroup[0];
    const sum = (selector: (row: MonthlyReportRow) => number) => money(sortedGroup.reduce((total, row) => total + selector(row), 0));
    const cost = sum(row => row.cost);
    const payment = sum(row => row.payment);
    const balance = sum(row => row.balance);
    const labCost = sum(row => row.labCost);
    const materialCost = sum(row => row.materialCost);
    const specialDoctorCost = sum(row => row.specialDoctorCost);
    const doctorCost = sum(row => row.doctorCost);
    const totalCost = sum(row => row.totalCost);
    const netProfit = sum(row => row.netProfit);

    return {
      ...first,
      treatmentId: sortedGroup.map(row => row.treatmentId).join('|'),
      treatmentIds: sortedGroup.map(row => row.treatmentId),
      treatmentCount: sortedGroup.length,
      treatment: combineLabels(sortedGroup.map(row => row.treatment)),
      doctor: combineDistinctLabels(sortedGroup.map(row => row.doctor)),
      cost,
      payment,
      balance,
      labCost,
      materialCost,
      specialDoctorCost,
      doctorCost,
      totalCost,
      netProfit,
      netMargin: cost > 0 ? netProfit / cost : 0
    };
  }).sort((a, b) => (
    a.date.localeCompare(b.date)
    || a.patientName.localeCompare(b.patientName)
    || a.patientId.localeCompare(b.patientId)
    || a.treatmentIds[0].localeCompare(b.treatmentIds[0])
  ));
};

const buildPaymentAllocations = (
  records: MonthlyReportSourceRecord[],
  payments: PaymentRecord[]
) => {
  const uniquePayments = dedupePaymentRecords(payments);
  return allocateCommissionablePayments(
    records.map(record => ({
      id: record.id,
      patientId: record.patient_id,
      date: record.date,
      cost: positiveMoney(record.cost)
    })),
    uniquePayments.map(payment => ({
      id: payment.id,
      patientId: payment.patientId,
      date: payment.date,
      createdAt: payment.createdAt,
      commissionableAmount: getPaymentTreatmentShare(payment),
      treatmentIds: getPaymentTreatmentIds(payment)
    }))
  );
};

const buildPaymentByTreatment = (allocations: ReturnType<typeof buildPaymentAllocations>): Map<string, number> => {
  return allocations.reduce((map, allocation) => {
    map.set(allocation.treatmentId, money((map.get(allocation.treatmentId) || 0) + allocation.amount));
    return map;
  }, new Map<string, number>());
};

const buildDateBasedDetailRows = (
  treatmentRows: MonthlyReportRow[],
  allocationRecords: MonthlyReportSourceRecord[],
  payments: PaymentRecord[],
  allocations: ReturnType<typeof buildPaymentAllocations>,
  dateFrom?: string,
  dateTo?: string
): MonthlyReportRow[] => {
  if (treatmentRows.length === 0) return [];

  const inferredFrom = treatmentRows.reduce((earliest, row) => row.date < earliest ? row.date : earliest, treatmentRows[0].date);
  const inferredTo = treatmentRows.reduce((latest, row) => row.date > latest ? row.date : latest, treatmentRows[0].date);
  const from = dateFrom || inferredFrom;
  const to = dateTo || inferredTo;
  const paymentById = new Map(dedupePaymentRecords(payments).map(payment => [payment.id, payment]));
  const recordsById = new Map(allocationRecords.map(record => [record.id, record]));
  const paymentByPatientDate = new Map<string, { amount: number; paymentIds: string[]; treatmentIds: string[] }>();

  allocations.forEach((allocation) => {
    if (allocation.paymentDate < from || allocation.paymentDate > to) return;
    const payment = paymentById.get(allocation.paymentId);
    const linkedTreatment = recordsById.get(allocation.treatmentId);
    if (!payment || !linkedTreatment) return;
    const key = `${linkedTreatment.patient_id}|${allocation.paymentDate}`;
    const current = paymentByPatientDate.get(key) || { amount: 0, paymentIds: [], treatmentIds: [] };
    current.amount = money(current.amount + allocation.amount);
    if (!current.paymentIds.includes(allocation.paymentId)) current.paymentIds.push(allocation.paymentId);
    if (!current.treatmentIds.includes(allocation.treatmentId)) current.treatmentIds.push(allocation.treatmentId);
    paymentByPatientDate.set(key, current);
  });

  const treatmentRowsByPatientDate = new Map<string, MonthlyReportRow[]>();
  treatmentRows.forEach((row) => {
    const key = `${row.patientId}|${row.date}`;
    const rows = treatmentRowsByPatientDate.get(key) || [];
    rows.push(row);
    treatmentRowsByPatientDate.set(key, rows);
  });

  // Keep a collection on only one treatment row per patient/date so the
  // existing same-day grouping does not duplicate it across multiple services.
  const detailRows = treatmentRows.map((row) => ({ ...row, payment: 0, balance: row.cost }));
  treatmentRowsByPatientDate.forEach((rows, key) => {
    const collection = paymentByPatientDate.get(key);
    if (!collection) return;
    const firstRow = rows[0];
    const index = treatmentRows.indexOf(firstRow);
    if (index < 0) return;
    detailRows[index] = {
      ...detailRows[index],
      payment: collection.amount,
      balance: money(Math.max(0, detailRows[index].cost - collection.amount))
    };
    // If several treatment rows share a date, the grouped detail row should
    // retain the full date-level balance without repeating the collection.
    if (rows.length > 1) {
      const totalCost = money(rows.reduce((sum, treatment) => sum + treatment.cost, 0));
      detailRows[index].balance = money(Math.max(0, totalCost - collection.amount));
    }
    paymentByPatientDate.delete(key);
  });

  // A payment made on a later date has no treatment production. Add it as a
  // separate zero-production detail row so the report shows the collection on
  // the day it actually happened.
  paymentByPatientDate.forEach((collection, key) => {
    const [patientId, paymentDate] = key.split('|');
    const patient = allocationRecords.find(record => record.patient_id === patientId);
    if (!patient) return;
    const linkedTreatments = collection.treatmentIds
      .map(treatmentId => recordsById.get(treatmentId))
      .filter((record): record is MonthlyReportSourceRecord => Boolean(record));
    detailRows.push({
      treatmentId: `payment-${collection.paymentIds.join('|')}`,
      date: paymentDate,
      patientId,
      patientName: patient.patient_name?.trim() || 'Unknown patient',
      age: patient.patient_age !== null && patient.patient_age !== undefined && Number.isFinite(Number(patient.patient_age)) ? Number(patient.patient_age) : null,
      phone: patient.patient_phone?.trim() || 'Not recorded',
      city: patient.patient_city?.trim() || 'Not recorded',
      township: patient.patient_township?.trim() || 'Not recorded',
      patientType: patient.patient_type?.trim() || 'Not assigned',
      treatment: linkedTreatments.length > 0 ? 'Balance payment' : 'Payment',
      doctor: Array.from(new Set(linkedTreatments.map(record => record.doctor_name?.trim()).filter(Boolean))).join('; ') || 'Unassigned',
      cost: 0,
      payment: collection.amount,
      balance: 0,
      labCost: 0,
      materialCost: 0,
      specialDoctorCost: 0,
      doctorCost: 0,
      totalCost: 0,
      netProfit: 0,
      netMargin: 0
    });
  });

  return detailRows.sort((a, b) => (
    a.date.localeCompare(b.date) || a.patientName.localeCompare(b.patientName) || a.treatmentId.localeCompare(b.treatmentId)
  ));
};

const summarizeRows = (rows: MonthlyReportRow[]): MonthlyReportSummary => {
  const total = (selector: (row: MonthlyReportRow) => number) => money(rows.reduce((sum, row) => sum + selector(row), 0));
  const production = total(row => row.cost);
  const payment = total(row => row.payment);
  const netProfit = total(row => row.netProfit);
  return {
    treatmentCount: rows.length,
    patientCount: new Set(rows.map(row => row.patientId).filter(Boolean)).size,
    production,
    payment,
    balance: total(row => row.balance),
    labCost: total(row => row.labCost),
    materialCost: total(row => row.materialCost),
    specialDoctorCost: total(row => row.specialDoctorCost),
    doctorCost: total(row => row.doctorCost),
    totalCost: total(row => row.totalCost),
    netProfit,
    netMargin: production > 0 ? netProfit / production : 0,
    collectionRate: production > 0 ? payment / production : 0
  };
};

const groupRows = (rows: MonthlyReportRow[], key: (row: MonthlyReportRow) => string): MonthlyReportGroup[] => {
  const groups = new Map<string, MonthlyReportRow[]>();
  rows.forEach(row => {
    const name = key(row) || 'Not recorded';
    groups.set(name, [...(groups.get(name) || []), row]);
  });
  return Array.from(groups, ([name, group]) => {
    const summary = summarizeRows(group);
    return {
      name,
      treatments: summary.treatmentCount,
      patients: summary.patientCount,
      production: summary.production,
      payment: summary.payment,
      totalCost: summary.totalCost,
      netProfit: summary.netProfit,
      netMargin: summary.netMargin
    };
  }).sort((a, b) => b.production - a.production || a.name.localeCompare(b.name));
};

export const buildMonthlyReport = (data: MonthlyReportData): MonthlyReport => {
  const allocationRecords = data.allocationRecords || data.records;
  const paymentAllocations = buildPaymentAllocations(allocationRecords, data.payments);
  const paymentByTreatment = buildPaymentByTreatment(paymentAllocations);
  const rows = data.records.map((record): MonthlyReportRow => {
    const cost = positiveMoney(record.cost);
    const payment = Math.min(cost, positiveMoney(paymentByTreatment.get(record.id)));
    const costs = data.costSummaries[record.id];
    const labCost = positiveMoney(costs?.labTotal);
    const materialCost = positiveMoney(costs?.materialTotal);
    const specialDoctorCost = positiveMoney(costs?.specialDoctorTotal);
    const doctorCost = positiveMoney(record.doctorEarnings);
    const totalCost = money(labCost + materialCost + specialDoctorCost + doctorCost);
    const netProfit = money(cost - totalCost);
    return {
      treatmentId: record.id,
      date: record.date,
      patientId: record.patient_id,
      patientName: record.patient_name?.trim() || 'Unknown patient',
      age: record.patient_age !== null && record.patient_age !== undefined && Number.isFinite(Number(record.patient_age))
        ? Number(record.patient_age)
        : null,
      phone: record.patient_phone?.trim() || 'Not recorded',
      city: record.patient_city?.trim() || 'Not recorded',
      township: record.patient_township?.trim() || 'Not recorded',
      patientType: record.patient_type?.trim() || 'Not assigned',
      treatment: record.description?.trim() || 'Treatment',
      doctor: record.doctor_name?.trim() || 'Unassigned',
      cost,
      payment,
      balance: money(Math.max(0, cost - payment)),
      labCost,
      materialCost,
      specialDoctorCost,
      doctorCost,
      totalCost,
      netProfit,
      netMargin: cost > 0 ? netProfit / cost : 0
    };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.patientName.localeCompare(b.patientName) || a.treatmentId.localeCompare(b.treatmentId));

  return {
    rows,
    detailRows: buildDateBasedDetailRows(rows, allocationRecords, data.payments, paymentAllocations, data.dateFrom, data.dateTo),
    summary: summarizeRows(rows),
    byTreatment: groupRows(rows, row => row.treatment),
    byDoctor: groupRows(rows, row => row.doctor),
    byPatientType: groupRows(rows, row => row.patientType)
  };
};

export const monthlyReportFilename = (metadata: MonthlyReportMetadata, extension: 'pdf' | 'xlsx'): string => {
  const scope = metadata.locationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report';
  return `monthly-report-${metadata.dateFrom}-to-${metadata.dateTo}-${scope}.${extension}`;
};
