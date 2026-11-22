-- Session ids are stored as SHA-256 (hex) only; the cookie keeps the plaintext and the
-- store hashes it (src/account/sessionStore.ts). Existing sessions are hashed in place
-- instead of signing everyone out. express-session ids are 32 base64url characters,
-- never 64 hex digits, so the condition makes this repeatable.
UPDATE user_sessions
   SET sid = encode(sha256(convert_to(sid, 'UTF8')), 'hex')
 WHERE sid !~ '^[0-9a-f]{64}$';
