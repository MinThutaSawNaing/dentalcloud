import { supabase } from './supabase';
import { api } from './api';
import type { Appointment, AppointmentRescheduleLog, ClinicalRecord, PaymentRecord } from '../types';
import { buildAuditLogRows, type AuditExportRow, type AuditFilter } from '../utils/auditLogExport';

export interface AuditQuery {
  dateFrom: string;
  dateTo: string;
  auditFilter: AuditFilter;
  searchTerm: string;
  page: number;
  showAll?: boolean;
}
export interface AuditBundle {
  auditRows?: AuditExportRow[];
  records: ClinicalRecord[];
  appointments: Appointment[];
  payments: PaymentRecord[];
  rescheduleLogs: AppointmentRescheduleLog[];
}
export interface AuditDirectoryPage extends AuditBundle {
  total: number;
  counts: { appointments: number; reschedules: number; treatments: number; payments: number };
}
type Entry = { kind: 'treatment' | 'appointment' | 'payment' | 'reschedule'; ids: string[] };
const chunks = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) => ids.slice(i * 100, i * 100 + 100));

export async function getAuditDirectoryPage(locationId: string, query: AuditQuery, doctorId?: string): Promise<AuditDirectoryPage> {
  if (!locationId) throw new Error('A branch is required to load the audit directory.');
  const { data, error } = await supabase.rpc('audit_directory', {
    p_location_id: locationId, p_date_from: query.dateFrom, p_date_to: query.dateTo,
    p_filter: doctorId ? 'treatments' : query.auditFilter, p_search: query.searchTerm.trim(),
    p_doctor_id: doctorId ?? null, p_offset: (Math.max(1, query.page) - 1) * 100, p_limit: 100
  });
  if (error) throw new Error(error.code === 'PGRST202' || error.code === '42883'
    ? 'Audit filtering is not installed yet. Apply the audit directory migration.' : error.message);
  if (!data || !Array.isArray(data.rows) || !Number.isSafeInteger(Number(data.total)) || Number(data.total) < 0
    || !data.counts || !['appointments', 'reschedules', 'treatments', 'payments'].every((kind) =>
      Number.isSafeInteger(Number(data.counts[kind])) && Number(data.counts[kind]) >= 0)) {
    throw new Error('Invalid audit directory response.');
  }
  const selected = data.rows as Entry[];
  const entries = [...selected, ...(data.context || [])] as Entry[];
  const idsFor = (kind: Entry['kind']) => [...new Set(entries.filter((entry) => entry.kind === kind).flatMap((entry) => entry.ids))];
  // Every hydration request is bounded, including visits with >100 treatments.
  const [records, appointments, payments, rescheduleLogs] = await Promise.all([
    Promise.all(chunks(idsFor('treatment')).map((treatmentIds) => api.treatments.getAllRecords(locationId, {
      treatmentIds, limit: null, doctorId, includeCommissionEntries: false, throwOnError: true
    }))).then((parts) => parts.flat()),
    Promise.all(chunks(idsFor('appointment')).map((ids) => api.appointments.getAll(locationId, { ids, throwOnError: true }))).then((parts) => parts.flat()),
    Promise.all(chunks(idsFor('payment')).map((ids) => api.finance.getPayments(locationId, { ids }))).then((parts) => parts.flat()),
    Promise.all(chunks(idsFor('reschedule')).map((ids) => api.appointmentRescheduleLogs.getAll(locationId, { ids, throwOnError: true }))).then((parts) => parts.flat())
  ]);
  const allRows = buildAuditLogRows(records, appointments, !doctorId, payments, rescheduleLogs);
  const auditRows = selected.flatMap((entry) => {
    const row = allRows.find((row) => row.kind === entry.kind && (
      row.kind === 'treatment' ? (row.record._groupedRecords || [row.record]).some((record) => entry.ids.includes(record.id))
      : row.kind === 'appointment' ? entry.ids.includes(row.appointment.id)
      : row.kind === 'payment' ? entry.ids.includes(row.payment.id) : entry.ids.includes(row.rescheduleLog.id)
    ));
    return row ? [row] : [];
  });
  if (auditRows.length !== selected.length) throw new Error('Audit rows changed while loading. Please refresh.');
  return { records, appointments, payments, rescheduleLogs, auditRows, total: Number(data.total), counts: data.counts };
}

/** Explicit full filtered fetch, only for exports / user-selected Show all. Never used to discover filters. */
export async function getAllFilteredAuditRows(locationId: string, query: AuditQuery, doctorId?: string): Promise<AuditDirectoryPage> {
  const first = await getAuditDirectoryPage(locationId, { ...query, page: 1 }, doctorId);
  for (let page = 2; page <= Math.ceil(first.total / 100); page++) {
    const next = await getAuditDirectoryPage(locationId, { ...query, page }, doctorId);
    first.records.push(...next.records);
    first.appointments.push(...next.appointments);
    first.payments.push(...next.payments);
    first.rescheduleLogs.push(...next.rescheduleLogs);
    first.auditRows!.push(...next.auditRows!);
  }
  return first;
}