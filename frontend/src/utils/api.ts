const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
export const apiEnabled = Boolean(API_URL);
export const apiTokenKey = 'bdcrm-api-token';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly payload: Record<string, unknown>) { super(message); }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_URL) throw new Error('Set VITE_API_URL to connect the CRM API.');
  const token = sessionStorage.getItem(apiTokenKey);
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // FastAPI wraps HTTPException details in `detail`; flatten that shape so
    // duplicate-confirmation and other structured errors work like API mode expects.
    const detail = payload.detail && typeof payload.detail === 'object' ? payload.detail as Record<string, unknown> : {};
    const normalized = { ...detail, ...payload };
    throw new ApiError(String(normalized.error ?? normalized.message ?? `Request failed (${response.status}).`), response.status, normalized);
  }
  return payload as T;
}

export async function apiDownload(path: string, fileName: string): Promise<void> {
  if (!API_URL) throw new Error('Set VITE_API_URL to connect the CRM API.');
  const token = sessionStorage.getItem(apiTokenKey);
  const response = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `Download failed (${response.status}).`);
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = objectUrl; link.download = fileName; link.click(); URL.revokeObjectURL(objectUrl);
}
