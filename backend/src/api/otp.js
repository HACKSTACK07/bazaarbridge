const crypto = require('crypto');

const OTP_HASH_SECRET = process.env.OTP_HASH_SECRET || 'bazaarbridge_default_otp_hash_secret_2026';

/**
 * Deterministic OTP derivation (reproducible by simulator and display endpoints)
 * 
 * @param {string} groupId - UUID of the fulfilment group
 * @param {string} [secret] - Optional secret override
 * @returns {{ code: string, otp_hash: string }}
 */
function deriveOtp(groupId, secret = OTP_HASH_SECRET) {
  const raw = crypto.createHmac('sha256', secret).update(`otp:${groupId}`).digest('hex');
  const code = String(parseInt(raw.slice(0, 8), 16) % 1000000).padStart(6, '0');
  const otp_hash = crypto.createHmac('sha256', secret).update(`hash:${code}`).digest('hex');
  return { code, otp_hash };
}

/**
 * Converts a submitted 6-digit raw code into an HMAC proof hash.
 * Only the proof travels in outbox payloads and Kafka events.
 * 
 * @param {string} code - Raw 6-digit OTP code
 * @param {string} [secret] - Optional secret override
 * @returns {string} Hex proof hash
 */
function hashOtpSubmission(code, secret = OTP_HASH_SECRET) {
  if (!code || typeof code !== 'string') {
    throw new Error('INVALID_OTP_CODE');
  }
  return crypto.createHmac('sha256', secret).update(`hash:${code}`).digest('hex');
}

/**
 * Constant-time comparison of submitted proof hash vs stored group otp_hash
 * 
 * @param {string} storedHash - Stored hex otp_hash from database
 * @param {string} submittedProof - Submitted hex otp_proof
 * @returns {boolean} True if matching, false otherwise
 */
function verifyOtpProof(storedHash, submittedProof) {
  if (!storedHash || !submittedProof) return false;
  try {
    const bufA = Buffer.from(storedHash, 'hex');
    const bufB = Buffer.from(submittedProof, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (err) {
    return false;
  }
}

module.exports = {
  deriveOtp,
  hashOtpSubmission,
  verifyOtpProof
};
