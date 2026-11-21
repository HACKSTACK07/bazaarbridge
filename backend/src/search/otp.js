/**
 * BazaarBridge OTP Helpers (Authoritative Contract v7.2)
 *
 * Locked rules:
 * - deriveOtp(groupId) -> '######' (display endpoints only)
 * - hashOtpSubmission(code) -> hex (HMAC(secret, "hash:" + code))
 * - verifyOtpProof(groupId, proof, expectedHash) -> boolean (constant-time compare vs otp_hash)
 * - Raw codes NEVER travel in outbox payloads, Kafka, logs or the search index.
 */

const crypto = require('crypto');

function getOtpSecret(customSecret) {
  const secret = customSecret || process.env.OTP_HASH_SECRET || process.env.OTP_SECRET || 'bazaarbridge_otp_secret_default';
  return secret;
}

/**
 * Deterministically derives 6-digit numeric OTP string for display endpoints.
 * Used ONLY for display to owning customer and admin demo button.
 *
 * Derivation formula:
 * raw = HMAC_SHA256(OTP_HASH_SECRET, "otp:" + groupId) // hex
 * code = String(parseInt(raw.slice(0, 8), 16) % 1000000).padStart(6, '0')
 *
 * @param {string} groupId - Fulfilment group UUID
 * @param {string} [customSecret] - Optional secret override
 * @returns {string} 6-digit numeric string '######'
 */
function deriveOtp(groupId, customSecret) {
  if (!groupId) {
    throw new Error('groupId is required to derive OTP');
  }
  const secret = getOtpSecret(customSecret);
  const raw = crypto.createHmac('sha256', secret).update('otp:' + String(groupId)).digest('hex');
  const code = String(parseInt(raw.slice(0, 8), 16) % 1000000).padStart(6, '0');
  return code;
}

/**
 * Converts submitted 6-digit OTP code into proof hash before it enters outbox payload.
 *
 * Derivation formula:
 * HMAC_SHA256(OTP_HASH_SECRET, "hash:" + code)
 *
 * @param {string} code - 6-digit numeric OTP code
 * @param {string} [customSecret] - Optional secret override
 * @returns {string} Hex string (otp_proof)
 */
function hashOtpSubmission(code, customSecret) {
  if (!code && code !== 0) {
    throw new Error('code is required for hashOtpSubmission');
  }
  const secret = getOtpSecret(customSecret);
  return crypto.createHmac('sha256', secret).update('hash:' + String(code)).digest('hex');
}

/**
 * Constant-time comparison between submitted otp_proof and stored fulfilment_groups.otp_hash.
 * Consumer never derives or sees raw code.
 *
 * @param {string} groupId - Fulfilment group UUID
 * @param {string} proof - Hex string submitted as otp_proof
 * @param {string} [expectedHash] - Stored otp_hash from fulfilment_groups table (if known)
 * @param {string} [customSecret] - Optional secret override
 * @returns {boolean} true if proof matches expected hash, false otherwise
 */
function verifyOtpProof(groupId, proof, expectedHash = null, customSecret = null) {
  if (!proof) {
    return false;
  }

  // If expectedHash is provided (from database column fulfilment_groups.otp_hash), use it directly.
  // Otherwise, compute what the authoritative otp_hash is for this groupId.
  const targetHash = expectedHash || hashOtpSubmission(deriveOtp(groupId, customSecret), customSecret);

  try {
    const proofBuf = Buffer.from(String(proof).trim(), 'hex');
    const targetBuf = Buffer.from(String(targetHash).trim(), 'hex');

    if (proofBuf.length === 0 || targetBuf.length === 0 || proofBuf.length !== targetBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(proofBuf, targetBuf);
  } catch (err) {
    return false;
  }
}

module.exports = {
  deriveOtp,
  hashOtpSubmission,
  verifyOtpProof
};
