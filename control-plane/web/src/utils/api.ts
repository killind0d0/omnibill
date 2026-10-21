// API Client for Control Plane Admin Endpoints.
// Rules:
// 1. All mutating calls (POST, PUT, PATCH, DELETE) send 'X-OmniBill-Admin: 1'.
// 2. 401 returns to login with a 'Session expired' message.
// 3. No local/session/cookie client storage used; server HttpOnly session cookie only.
// 4. Uses credentials: 'include' for HttpOnly session cookie transmission.

type UnauthorizedListener = (msg: string) => void;
let onUnauthorizedHandler: UnauthorizedListener | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedListener) {
  onUnauthorizedHandler = handler;
}

export async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});

  // Mutating requests strictly require the X-OmniBill-Admin header
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    headers.set('X-OmniBill-Admin', '1');
  }

  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // transmits HttpOnly admin_session cookie
  });

  if (response.status === 401) {
    if (onUnauthorizedHandler) {
      onUnauthorizedHandler('Session expired. Please log in again.');
    }
    throw new Error('Session expired');
  }

  if (!response.ok) {
    let errorText = `Request failed (${response.status})`;
    try {
      const errJson = await response.json();
      if (errJson.error) {
        errorText = errJson.error;
      }
    } catch {
      // Fallback to response status text
    }
    throw new Error(errorText);
  }

  return response.json() as Promise<T>;
}
