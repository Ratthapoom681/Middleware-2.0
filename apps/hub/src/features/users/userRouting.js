const normalizeUserId = (value) => {
  const normalized = String(value || '').trim();
  if (!/^[0-9]+$/.test(normalized)) return '';
  try {
    const numericId = BigInt(normalized);
    return numericId > 0n ? numericId.toString() : '';
  } catch {
    return '';
  }
};

export const getUserAdminPath = user => (
  normalizeUserId(user?.userId)
    ? `/users/id/${normalizeUserId(user.userId)}`
    : `/users/${encodeURIComponent(user?.username || '')}`
);

export const getUserDetailHash = user => (
  normalizeUserId(user?.userId)
    ? `#users/id/${normalizeUserId(user.userId)}`
    : `#users/${encodeURIComponent(user?.username || '')}`
);

export const parseUserDetailHash = (hash) => {
  const idMatch = String(hash || '').match(/^#users\/id\/([0-9]+)$/);
  if (idMatch) {
    const userId = normalizeUserId(idMatch[1]);
    return {
      detail: true,
      userId,
      username: '',
      canonicalHash: userId && userId !== idMatch[1] ? `#users/id/${userId}` : '',
    };
  }

  const usernameMatch = String(hash || '').match(/^#users\/(.+)$/);
  if (!usernameMatch) return {
    detail: false, userId: '', username: '', canonicalHash: '',
  };
  try {
    return {
      detail: true, userId: '', username: decodeURIComponent(usernameMatch[1]), canonicalHash: '',
    };
  } catch {
    return {
      detail: true, userId: '', username: usernameMatch[1], canonicalHash: '',
    };
  }
};
