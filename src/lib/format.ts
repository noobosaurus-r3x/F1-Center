export const titleCase = (value: string) =>
  value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

export const compactNumber = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'n/d';
  }

  return new Intl.NumberFormat('fr-FR', {
    notation: Math.abs(value) >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: value < 10 ? 2 : 1,
  }).format(value);
};

export const normalizeOpenF1Date = (value: string) =>
  value.replace(/\.(\d{3})\d+(?=[+-]\d{2}:\d{2}|Z$)/, '.$1');

export const parseOpenF1Date = (value: string | null | undefined) => {
  if (!value) {
    return Number.NaN;
  }

  return Date.parse(normalizeOpenF1Date(value));
};

export const formatDateTime = (value: string | null | undefined, withTime = true) => {
  if (!value) {
    return 'n/d';
  }

  const timestamp = parseOpenF1Date(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  const parsed = new Date(timestamp);
  return parsed.toLocaleString('fr-FR', {
    month: 'short',
    day: 'numeric',
    hour: withTime ? '2-digit' : undefined,
    minute: withTime ? '2-digit' : undefined,
  });
};

export const formatDurationSeconds = (value: number | string | null | undefined) => {
  const numericValue = toNumeric(value);
  if (numericValue === null) {
    return 'n/d';
  }

  if (numericValue >= 60) {
    const minutes = Math.floor(numericValue / 60);
    const seconds = numericValue % 60;
    return `${minutes}m ${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  }

  return `${numericValue.toFixed(numericValue >= 10 ? 1 : 2)}s`;
};

export const formatValue = (value: unknown) => {
  if (value === null || value === undefined || value === '') {
    return 'n/d';
  }

  if (typeof value === 'number') {
    if (Math.abs(value) >= 1000) {
      return compactNumber(value);
    }

    return Number.isInteger(value) ? `${value}` : value.toFixed(2);
  }

  if (typeof value === 'boolean') {
    return value ? 'oui' : 'non';
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return formatDateTime(value);
  }

  return String(value);
};

export const toNumeric = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const cleaned = value.replace(/[A-Za-z+]/g, '').trim();
  if (!cleaned) {
    return null;
  }

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

export const average = (values: Array<number | null>) => {
  const validValues = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!validValues.length) {
    return null;
  }

  return validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
};

export const sortByDate = <T extends Record<string, unknown>>(rows: T[], field = 'date') =>
  [...rows].sort((left, right) => {
    const leftValue = typeof left[field] === 'string' ? parseOpenF1Date(String(left[field])) : 0;
    const rightValue = typeof right[field] === 'string' ? parseOpenF1Date(String(right[field])) : 0;
    return leftValue - rightValue;
  });

export const downsample = <T>(rows: T[], maxPoints: number) => {
  if (rows.length <= maxPoints) {
    return rows;
  }

  const step = Math.ceil(rows.length / maxPoints);
  return rows.filter((_, index) => index % step === 0);
};
