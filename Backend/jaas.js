const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const DEFAULT_APP_ID = 'vpaas-magic-cookie-816dc323fa8e4b6bbe903b8418b38488';

/**
 * Resolves the JaaS App ID from environment or default.
 */
function getJaasAppId() {
  return process.env.JAAS_APP_ID || DEFAULT_APP_ID;
}

/**
 * Resolves and normalizes the JaaS Key ID (kid) for the JWT header.
 * If only the suffix is provided (e.g. 'c03264'), prepends '<appId>/'.
 */
function getJaasKeyId() {
  const appId = getJaasAppId();
  const rawKeyId = process.env.JAAS_KEY_ID || process.env.JAAS_KID || '';

  if (!rawKeyId) {
    return `${appId}/default`;
  }

  if (rawKeyId.includes('/')) {
    return rawKeyId;
  }

  return `${appId}/${rawKeyId}`;
}

/**
 * Loads the RSA private key securely using production-ready mechanisms:
 * 1. JAAS_PRIVATE_KEY (env var, handles literal newlines or escaped \n)
 * 2. JAAS_PRIVATE_KEY_BASE64 (env var, base64 encoded for cloud platforms)
 * 3. JAAS_PRIVATE_KEY_PATH (path to a Render Secret File, e.g. /etc/secrets/jaas_private_key.pk)
 * 
 * Never searches for or depends on local key files in the repository.
 */
function getJaasPrivateKey() {
  // Option 1: Direct environment variable
  if (process.env.JAAS_PRIVATE_KEY) {
    const raw = process.env.JAAS_PRIVATE_KEY;
    return raw.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
  }

  // Option 2: Base64-encoded environment variable
  if (process.env.JAAS_PRIVATE_KEY_BASE64) {
    try {
      const decoded = Buffer.from(process.env.JAAS_PRIVATE_KEY_BASE64, 'base64').toString('utf8');
      return decoded.replace(/\r\n/g, '\n').trim();
    } catch (e) {
      console.error('[JaaS] Failed to decode JAAS_PRIVATE_KEY_BASE64:', e.message);
    }
  }

  // Option 3: Secret file path (Render Secret Files)
  if (process.env.JAAS_PRIVATE_KEY_PATH) {
    try {
      if (fs.existsSync(process.env.JAAS_PRIVATE_KEY_PATH)) {
        return fs.readFileSync(process.env.JAAS_PRIVATE_KEY_PATH, 'utf8').replace(/\r\n/g, '\n').trim();
      }
    } catch (e) {
      console.error('[JaaS] Failed to read private key from path:', process.env.JAAS_PRIVATE_KEY_PATH, e.message);
    }
  }

  return null;
}

/**
 * Returns true if the JaaS private key is available for signing.
 */
function isJaasConfigured() {
  const pk = getJaasPrivateKey();
  return Boolean(pk && pk.includes('BEGIN PRIVATE KEY'));
}

/**
 * Generates an RS256 signed JWT for 8x8 Jitsi as a Service (JaaS).
 * 
 * @param {Object} params
 * @param {Object} params.user User object ({ id, full_name, email })
 * @param {string} params.roomName Madrastak meeting room ID
 * @param {boolean} params.isTeacher Whether the user is instructor/host
 * @param {number} [params.durationMinutes=60] Scheduled lecture duration
 * @returns {Object|null} { token, appId, roomName, isModerator }
 */
function generateJaasToken({ user, roomName, isTeacher, durationMinutes = 60 }) {
  const privateKey = getJaasPrivateKey();
  if (!privateKey) {
    console.warn('[JaaS] Private key not available. Cannot generate JaaS JWT.');
    return null;
  }

  const appId = getJaasAppId();
  const kid = getJaasKeyId();
  const normalizedRoom = (roomName || '*').toLowerCase();

  const now = Math.floor(Date.now() / 1000);
  const nbf = now - 10;
  // Token valid for duration + 2 hour buffer, minimum 2 hours (7200s)
  const validitySeconds = Math.max((Number(durationMinutes) || 60) * 60 + 7200, 7200);
  const exp = now + validitySeconds;

  const isModerator = Boolean(isTeacher);

  const payload = {
    aud: 'jitsi',
    iss: 'chat',
    sub: appId,
    room: normalizedRoom,
    iat: now,
    nbf: nbf,
    exp: exp,
    context: {
      user: {
        id: String(user?.id || 'guest'),
        name: user?.full_name || (isModerator ? 'Instructor' : 'Student'),
        email: user?.email || '',
        avatar: '',
        moderator: isModerator ? 'true' : 'false'
      },
      features: {
        recording: isModerator ? 'true' : 'false',
        livestreaming: isModerator ? 'true' : 'false',
        transcription: isModerator ? 'true' : 'false',
        'screen-sharing': 'true'
      }
    }
  };

  try {
    const token = jwt.sign(payload, privateKey, {
      algorithm: 'RS256',
      header: {
        alg: 'RS256',
        typ: 'JWT',
        kid: kid
      }
    });

    return {
      token,
      appId,
      roomName: normalizedRoom,
      isModerator
    };
  } catch (err) {
    console.error('[JaaS] Error signing JWT:', err);
    throw new Error(`Failed to generate JaaS conference token: ${err.message}`);
  }
}

module.exports = {
  getJaasAppId,
  getJaasKeyId,
  getJaasPrivateKey,
  isJaasConfigured,
  generateJaasToken
};
