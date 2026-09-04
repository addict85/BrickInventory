/** /api/v1/auth — Login (Token-Erzeugung), Logout, Me, Token-Create. */
import express from 'express';
import crypto from 'crypto';
import * as db from '../../db/database';
import { handleRouteError } from '../../utils/httpError';
import { pruefeAnmeldedaten, validateToken, hashToken, deleteToken } from '../../utils/auth';
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
  try {
    // Dieselbe Prüfung wie beim Sitzungs-Login der Webapp (utils/auth.ts).
    // Sie stand hier einmal als eigene Fassung — und war zweimal
    // auseinandergelaufen: erst fehlten die Konto-Vorbedingungen, dann der
    // Vergleich gegen den Dummy-Hash. Der zweite Unterschied war von aussen
    // messbar (415 ms) und verriet, welche Konten es gibt.
    const pruefung = await pruefeAnmeldedaten(req, username, password);
    if (!pruefung.ok) {
      const { status, error, unverified } = pruefung.absage;
      return res.status(status).json({ success:false, error, ...(unverified ? { unverified:true } : {}) });
    }
    const user = pruefung.user;
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
