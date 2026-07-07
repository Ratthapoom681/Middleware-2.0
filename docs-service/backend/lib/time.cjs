const APP_TIME_ZONE = process.env.TZ || 'Asia/Bangkok';

const toValidDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date
    ? value
    : typeof value === 'number'
      ? new Date(value)
      : new Date(String(value).trim());
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatBangkokDate = (value = new Date(), options = {}, fallback = '') => {
  const date = toValidDate(value);
  if (!date) return fallback || String(value || '').trim();
  return date.toLocaleDateString(undefined, {
    ...options,
    timeZone: APP_TIME_ZONE
  });
};

module.exports = {
  APP_TIME_ZONE,
  formatBangkokDate,
  toValidDate
};
