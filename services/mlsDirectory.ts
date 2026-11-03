import { api } from './api';
import { supabase } from './supabase';
import type { ClinicalRecord, PaymentRecord } from '../types';

export interface MlsDirectoryQuery {
  dateFrom?: string;
  dateTo?: string;
  patientSearch?: string;
  doctorSearch?: string;
  treatmentSearch?: string;
  page: number;
  pageSize: number;
  showAll?: boolean;
}

export interface MlsDirectoryPage {
  records: ClinicalRecord[];
  payments: PaymentRecord[];
  total: number;
  /** Allocation context only; never render these as additional directory rows. */
  allocationPayments: PaymentRecord[];
}

interface Selection {
  payment_ids: string[];
  patient_ids: string[];
  treatment_ids: string[];
  total: number;
}

const positiveInteger = (value: number, fallback: number) => Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;

/** Select on the server first, then hydrate only patients represented by the page.
 * Historical payments are essential: allocating a page alone reopens already-paid
 * debts and incorrectly attaches legacy balance payments to the oldest treatment.
 */
export async function loadMlsDirectoryPage(
  locationId: string,
  query: MlsDirectoryQuery,
  signal?: AbortSignal
): Promise<MlsDirectoryPage> {
  if (!locationId) throw new Error('A branch is required to load the MLS directory.');
  signal?.throwIfAborted();
  const pageSize = Math.min(500, positiveInteger(query.pageSize, 100));
  const paymentIds: string[] = [];
  const patientIds = new Set<string>();
  let total = 0;
  let page = query.showAll ? 1 : positiveInteger(query.page, 1);
  do {
    let request = supabase.rpc('mls_directory_page', {
      p_location_id: locationId,
      p_date_from: query.dateFrom || null,
      p_date_to: query.dateTo || null,
      p_patient_search: query.patientSearch?.trim() || '',
      p_doctor_search: query.doctorSearch?.trim() || '',
      p_treatment_search: query.treatmentSearch?.trim() || '',
      p_page: page,
      p_page_size: pageSize
    });
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    signal?.throwIfAborted();
    if (error) throw new Error(`Unable to load MLS directory: ${error.message}`);
    const selection = (Array.isArray(data) ? data[0] : data) as Selection | null;
    if (!selection) throw new Error('MLS directory returned no selection.');
    total = Number(selection.total);
    paymentIds.push(...selection.payment_ids);
    selection.patient_ids.forEach((id) => patientIds.add(id));
    if (!query.showAll || selection.payment_ids.length < pageSize || paymentIds.length >= total) break;
    page++;
  } while (true);

  if (!paymentIds.length) return { records: [], payments: [], allocationPayments: [], total };
  const records: ClinicalRecord[] = [];
  const allocationPayments: PaymentRecord[] = [];
  // Chunk IDs to keep PostgREST URLs bounded. All hydration retains existing API
  // commission/snapshot/MLS mapping and is constrained to selected page patients.
  const ids = [...patientIds];
  for (let offset = 0; offset < ids.length; offset += 40) {
    signal?.throwIfAborted();
    const patientChunk = ids.slice(offset, offset + 40);
    const [historyRecords, historyPayments] = await Promise.all([
      api.treatments.getAllRecords(locationId, { patientIds: patientChunk, limit: null, throwOnError: true, signal }),
      api.finance.getPayments(locationId, { patientIds: patientChunk, includeCorrections: false, signal })
    ]);
    records.push(...historyRecords);
    allocationPayments.push(...historyPayments);
  }
  signal?.throwIfAborted();
  const byId = new Map(allocationPayments.map((payment) => [payment.id, payment]));
  const payments = paymentIds.map((id) => byId.get(id)).filter((payment): payment is PaymentRecord => Boolean(payment));
  return { records, payments, total, allocationPayments };
}