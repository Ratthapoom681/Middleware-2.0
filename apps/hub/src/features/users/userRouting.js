export const getUserAdminPath = user => (
  user?.userId
    ? `/users/id/${encodeURIComponent(user.userId)}`
    : `/users/${encodeURIComponent(user?.username || '')}`
);

export const getUserDetailHash = user => (
  user?.userId
    ? `#users/id/${encodeURIComponent(user.userId)}`
    : `#users/${encodeURIComponent(user?.username || '')}`
);

export const parseUserDetailHash = (hash) => {
  const idMatch = String(hash || '').match(/^#users\/id\/([0-9]{6,})$/);
  if (idMatch) return { detail: true, userId: idMatch[1], username: '' };

  const usernameMatch = String(hash || '').match(/^#users\/(.+)$/);
  if (!usernameMatch) return { detail: false, userId: '', username: '' };
  try {
    return { detail: true, userId: '', username: decodeURIComponent(usernameMatch[1]) };
  } catch {
    return { detail: true, userId: '', username: usernameMatch[1] };
  }
};
