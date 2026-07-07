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

export const formatBangkokDateTime = (value, fallback = '') => {
  const date = toValidDate(value);
  if (!date) return fallback || String(value || '').trim();
  return date.toLocaleString(undefined, { timeZone: APP_TIME_ZONE });
};

export const formatBangkokDate = (value, fallback = '') => {
  const date = toValidDate(value);
  if (!date) return fallback || String(value || '').trim();
  return date.toLocaleDateString(undefined, { timeZone: APP_TIME_ZONE });
};

export const formatBangkokTime = (value, fallback = '') => {
  const date = toValidDate(value);
  if (!date) return fallback || String(value || '').trim();
  return date.toLocaleTimeString(undefined, { timeZone: APP_TIME_ZONE });
};
