const ISO_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const getLocalDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getReceiptItemDateKey = (dateStr: string): string | null => {
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  if (ISO_DATE_ONLY_PATTERN.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00`);
    return Number.isNaN(parsed.getTime()) || getLocalDateKey(parsed) !== trimmed ? null : trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return getLocalDateKey(parsed);
};

export const isReceiptItemRecent = (dateStr: string, today: Date = new Date()): boolean => {
  const normalizedDate = getReceiptItemDateKey(dateStr);
  if (!normalizedDate) return false;
  return normalizedDate === getLocalDateKey(today);
};

