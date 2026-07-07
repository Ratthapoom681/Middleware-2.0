export const APP_TIME_ZONE = 'Asia/Bangkok';

const toValidDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date
    ? value
    : typeof value === 'number'
      ? new Date(value)
      : new Date(String(value).trim());
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatBangkokDateTime = (value, fallback = '') => {
  const date = toValidDate(value);
  if (!date) return fallback || String(value || '').trim();
  return date.toLocaleString(undefined, { timeZone: APP_TIME_ZONE });
};

export const formatBangkokIntl = (value, options = {}, fallback = '') => {
  const date = toValidDate(value);
  if (!date) return fallback || String(value || '').trim();
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: APP_TIME_ZONE }).format(date);
};
