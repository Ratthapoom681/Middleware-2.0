export const APP_TIME_ZONE = 'Asia/Bangkok';

export const toValidDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date
    ? value
    : typeof value === 'number'
      ? new Date(value)
      : new Date(String(value).trim());
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeOptions = (optionsOrFallback, fallback = '') => (
  typeof optionsOrFallback === 'string'
    ? { options: {}, fallback: optionsOrFallback }
    : { options: optionsOrFallback || {}, fallback }
);

const invalidFallback = (value, fallback) => fallback || String(value || '').trim();

export const formatBangkokIntl = (value, options = {}, fallback = '') => {
  const date = toValidDate(value);
  if (!date) return invalidFallback(value, fallback);
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: APP_TIME_ZONE }).format(date);
};

export const formatBangkokDateTime = (value, fallback = '') => {
  const date = toValidDate(value);
  if (!date) return invalidFallback(value, fallback);
  return date.toLocaleString(undefined, { timeZone: APP_TIME_ZONE });
};

export const formatBangkokDate = (value, optionsOrFallback = {}, fallback = '') => {
  const normalized = normalizeOptions(optionsOrFallback, fallback);
  const date = toValidDate(value);
  if (!date) return invalidFallback(value, normalized.fallback);
  return date.toLocaleDateString(undefined, {
    ...normalized.options,
    timeZone: APP_TIME_ZONE
  });
};

export const formatBangkokTime = (value, optionsOrFallback = {}, fallback = '') => {
  const normalized = normalizeOptions(optionsOrFallback, fallback);
  const date = toValidDate(value);
  if (!date) return invalidFallback(value, normalized.fallback);
  return date.toLocaleTimeString(undefined, {
    ...normalized.options,
    timeZone: APP_TIME_ZONE
  });
};
