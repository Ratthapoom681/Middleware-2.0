const normalizeApiBase = (value) => String(value || '/api').replace(/\/+$/, '');

export const API_BASE = normalizeApiBase(import.meta.env.VITE_API_BASE);

export const getAuthToken = () => localStorage.getItem('defectdojo_token');
export const setAuthToken = (token) => localStorage.setItem('defectdojo_token', token);
export const removeAuthToken = () => localStorage.removeItem('defectdojo_token');

export const getCurrentUser = () => {
    try {
        return JSON.parse(localStorage.getItem('defectdojo_user') || 'null');
    } catch {
        return null;
    }
};
export const setCurrentUser = (user) => localStorage.setItem('defectdojo_user', JSON.stringify(user));
export const removeCurrentUser = () => localStorage.removeItem('defectdojo_user');

export const apiFetch = async (endpoint, options = {}) => {
    const token = getAuthToken();
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers
    });

    if (response.status === 401) {
        removeAuthToken();
        removeCurrentUser();
        window.location.reload();
    }

    return response;
};

const dispatchSyncEvent = (eventBlock, onEvent) => {
    const lines = eventBlock.split(/\r?\n/);
    let eventName = 'message';
    const dataLines = [];

    lines.forEach(line => {
        if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
        }
    });

    if (dataLines.length === 0) return;

    try {
        onEvent({ event: eventName, data: JSON.parse(dataLines.join('\n')) });
    } catch {
        onEvent({ event: eventName, data: dataLines.join('\n') });
    }
};

export const openDashboardSyncStream = async ({ signal, onEvent }) => {
    const token = getAuthToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await fetch(`${API_BASE}/sync/events`, { headers, signal });

    if (!response.ok || !response.body) {
        throw new Error(`Dashboard sync stream failed (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() || '';
        chunks.forEach(chunk => dispatchSyncEvent(chunk, onEvent));
    }
};
