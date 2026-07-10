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

const getBangkokDateTimeParts = (value = new Date()) => {
  const date = toValidDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: APP_TIME_ZONE,
    year: 'numeric'
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
};

const formatBangkokDate = (value = new Date(), options = {}, fallback = '') => {
  const date = toValidDate(value);
  if (!date) return fallback || String(value || '').trim();
  return date.toLocaleDateString(undefined, { ...options, timeZone: APP_TIME_ZONE });
};

const formatBangkokClockTime = (value = new Date(), fallback = '') => {
  const parts = getBangkokDateTimeParts(value);
  if (!parts) return fallback || String(value || '').trim();
  return `${parts.hour}:${parts.minute}:${parts.second}`;
};

const formatBangkokSqlTimestamp = (value = new Date(), fallback = '') => {
  const parts = getBangkokDateTimeParts(value);
  if (!parts) return fallback || String(value || '').trim();
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
};

module.exports = {
  APP_TIME_ZONE,
  formatBangkokClockTime,
  formatBangkokDate,
  formatBangkokSqlTimestamp,
  toValidDate
};
