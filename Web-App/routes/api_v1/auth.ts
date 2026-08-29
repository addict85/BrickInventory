/** /api/v1/auth — Login (Token-Erzeugung), Logout, Me, Token-Create. */
import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import * as db from '../../db/database';
import { handleRouteError } from '../../utils/httpError';
import { isValidLoginIdentifier, validateToken, hashToken, deleteToken, assertLoginAllowed } from '../../utils/auth';
import { checkLoginAllowed, recordLoginFailure, recordLoginSuccess } from '../../utils/loginLimiter';
import { requireToken, bearerToken } from './middleware';
const router = express.Router();

function generateToken() { return crypto.randomBytes(32).toString('hex'); }

export async function createToken(userId: number, label = 'Android App') {
  const token = generateToken();
  // DB speichert nur den SHA-256-Hash; der Client erhält den Klartext-Token
  await db.run('INSERT INTO api_tokens (token, user_id, label, expires_at) VALUES ($1,$2,$3,NULL) ON CONFLICT DO NOTHING', [hashToken(token), userId, label]);
  return token;
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
  const { username, password, label } = req.body;
  if (!username || !password) return res.status(400).json({ success:false, error:'username und password erforderlich' });
  // Parität zum Webapp-Login, inklusive der Anmeldung per E-Mail. Die Prüfung
  // hält Unsinn von der Abfrage und vom Brute-Force-Zähler fern, der je
  // Kombination aus IP und Anmeldename zählt.
  if (!isValidLoginIdentifier(username))
    return res.status(400).json({ success:false, error:'Bitte Benutzername oder E-Mail-Adresse eingeben.' });
  // Brute-Force-Schutz (gleicher Limiter wie Webapp-Login)
  const locked = await checkLoginAllowed(req, username);
  if (locked) return res.status(429).json({ success:false, error: locked });
  try {
    // Parität zum Webapp-Login: dort ist auch die Anmeldung per E-Mail erlaubt.
    const user = await db.get(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)', [username]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      await recordLoginFailure(req, username);
      return res.status(401).json({ success:false, error:'Ungültige Anmeldedaten' });
    }
    await recordLoginSuccess(req, username);
    // WICHTIG: Diese Prüfung fehlte hier komplett. Ein deaktiviertes oder nie
    // bestätigtes Konto konnte sich über die Android-API anmelden und bekam
    // einen Token OHNE Ablaufdatum — während der Webapp-Login beides ablehnt.
    const blocked = assertLoginAllowed(user);
    if (blocked) return res.status(blocked.status).json({ success:false, error: blocked.error, ...(blocked.unverified ? { unverified:true } : {}) });
    const token = await createToken(user.id, label || 'Android App');
    res.json({ success:true, token, never_expires:true, user:{ id:user.id, username:user.username, is_admin:user.is_admin===1,
      mustChangePassword: !!(user.must_change_password === 1 || user.must_change_password === true) } });
  } catch (e) { handleRouteError(res, e); }
});

router.post('/auth/logout', requireToken, async (req: AuthedRequest, res) => {
  const token = bearerToken(req);
  if (token) await deleteToken(token);  // löscht die (gehashte) Zeile und invalidiert den Cache
  res.json({ success:true });
});

router.get('/auth/me', requireToken, (req: AuthedRequest, res) => {
  const u = req.apiUser;
  res.json({ success:true, user:{ id:u.user_id, username:u.username, is_admin:u.is_admin===1 }, token_expires:u.expires_at, token_last_used:u.last_used });
});

router.post('/auth/token-create', async (req, res) => {
  try {
    const token = bearerToken(req);
    const tokenUser = token ? await validateToken(token) : null;
    const userId = req.session?.userId || tokenUser?.user_id;
    if (!userId) return res.status(401).json({ success:false, error:'Nicht angemeldet' });
    const label = req.body?.label || 'Android App';
    const newTok = await createToken(userId, label);
    res.json({ success:true, token:newTok, label, never_expires:true });
  } catch (e) { handleRouteError(res, e); }
});


export default router;
