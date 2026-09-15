/**
 * Madrastak Authentication Utilities
 * Manages JWT decoding, expiration validation, token integrity, and global 401 response handling.
 */

/**
 * Safely parses the payload of a JWT without third-party dependencies.
 * Supports both browser environments (atob) and test/node environments (Buffer).
 * 
 * @param {string} token 
 * @returns {object|null} Decoded JSON payload or null if invalid
 */
export function parseJwt(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');

    let jsonPayload;
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
      jsonPayload = decodeURIComponent(
        window.atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
    } else if (typeof Buffer !== 'undefined') {
      jsonPayload = Buffer.from(base64, 'base64').toString('utf8');
    } else {
      return null;
    }

    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

/**
 * Checks whether a given JWT is expired.
 * A token is considered expired if it is missing, malformed, lacks an `exp` claim,
 * or its expiration timestamp in milliseconds is in the past.
 * 
 * @param {string} token 
 * @returns {boolean} True if expired or invalid, false if active
 */
export function isTokenExpired(token) {
  if (!token || typeof token !== 'string') return true;
  const decoded = parseJwt(token);
  if (!decoded || typeof decoded.exp !== 'number') return true;
  return decoded.exp * 1000 <= Date.now();
}

/**
 * Returns the stored token only if it exists and is strictly unexpired.
 * If an expired token is detected, it automatically purges the token and user
 * from localStorage and dispatches a 'madrastak:unauthorized' event.
 * 
 * @returns {string|null} Active JWT or null
 */
export function getValidToken() {
  if (typeof localStorage === 'undefined') return null;
  const token = localStorage.getItem('token');
  if (!token) return null;

  if (isTokenExpired(token)) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('madrastak:unauthorized'));
    }
    return null;
  }

  return token;
}

let isInterceptorConfigured = false;

/**
 * Installs a global fetch interceptor that monitors protected API responses.
 * When any protected Madrastak API request returns HTTP 401 Unauthorized,
 * stored session data is purged and onUnauthorized() is invoked.
 * 
 * @param {Function} [onUnauthorized] Callback invoked upon 401
 */
export function setupAuthInterceptor(onUnauthorized) {
  if (isInterceptorConfigured || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  isInterceptorConfigured = true;

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    if (response && response.status === 401) {
      const url = typeof args[0] === 'string'
        ? args[0]
        : (args[0] && args[0].url ? args[0].url : '');

      // Only trigger unauthorized logout for Madrastak backend API endpoints,
      // excluding login and register where 401 indicates wrong credentials during submit.
      if (url.includes('/api/') && !url.includes('/api/login') && !url.includes('/api/register')) {
        console.warn('[Madrastak Auth] 401 Unauthorized received on protected route. Terminating session.');
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
        if (typeof onUnauthorized === 'function') {
          onUnauthorized();
        } else {
          window.dispatchEvent(new CustomEvent('madrastak:unauthorized'));
        }
      }
    }

    return response;
  };
}

