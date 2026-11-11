import type { DbSchnittstelle } from '../../../db/database';

/** Eine Token-Familie: Konto und created_at (auf Millisekunden, wie es über JavaScript reist). */
export interface Familie {
  uid: number;
  seit: string;
}

const FAMILIE_LEBT = `EXISTS (SELECT 1 FROM api_tokens t WHERE t.user_id = $1
  AND date_trunc('milliseconds', t.created_at) = $2::timestamptz)`;

/** Ein unbestätigter Schlüssel (vor der Attestation hinterlegt) gilt nur bis [altBis]. */
/** Die Familie eines eben ausgestellten Tokens, auf Millisekunden wie FAMILIE_LEBT. */
export async function familieDesTokens(db: DbSchnittstelle, hash: string): Promise<Familie | null> {
  const z = await db.get<{ uid: number; seit: Date }>(
    `SELECT user_id AS uid, date_trunc('milliseconds', created_at) AS seit FROM api_tokens WHERE token = $1`,
    [hash],
  );
  return z ? { uid: z.uid, seit: new Date(z.seit).toISOString() } : null;
}

export async function schluesselDer(db: DbSchnittstelle, f: Familie, altBis: Date): Promise<string | null> {
  const z = await db.get<{ oeffentlich: string }>(
    `SELECT oeffentlich FROM geraete_schluessel WHERE user_id = $1 AND familie = $2::timestamptz
       AND (attestiert OR NOW() < $3)`,
    [f.uid, f.seit, altBis],
  );
  return z?.oeffentlich ?? null;
}

export async function eintragDer(
  db: DbSchnittstelle,
  f: Familie,
): Promise<{ oeffentlich: string; attestiert: boolean } | null> {
  return (
    (await db.get<{ oeffentlich: string; attestiert: boolean }>(
      'SELECT oeffentlich, attestiert FROM geraete_schluessel WHERE user_id = $1 AND familie = $2::timestamptz',
      [f.uid, f.seit],
    )) ?? null
  );
}

/** Nur für eine lebende, junge Familie; ein unbestätigter Schlüssel darf dabei einem
 * attestierten weichen. Reste widerrufener Familien fallen weg.
 * @returns ob er jetzt gilt */
export async function legeSchluesselAn(
  db: DbSchnittstelle,
  f: Familie,
  oeffentlich: string,
  fristS: number,
): Promise<boolean> {
  await db.run(
    `DELETE FROM geraete_schluessel g WHERE g.user_id = $1 AND NOT EXISTS (SELECT 1 FROM api_tokens t
    WHERE t.user_id = g.user_id AND date_trunc('milliseconds', t.created_at) = g.familie)`,
    [f.uid],
  );
  return !!(await db.get(
    `INSERT INTO geraete_schluessel (user_id, familie, oeffentlich, attestiert)
     SELECT $1, $2::timestamptz, $3, true WHERE ${FAMILIE_LEBT} AND $2::timestamptz > NOW() - make_interval(secs => $4)
     ON CONFLICT (user_id, familie) DO UPDATE SET oeffentlich = EXCLUDED.oeffentlich, attestiert = true,
       angelegt_am = NOW() WHERE NOT geraete_schluessel.attestiert
     RETURNING user_id`,
    [f.uid, f.seit, oeffentlich, fristS],
  ));
}

/** Eine Nonce für die Attestation-Challenge; höchstens [offen] je Familie, nur für eine junge Familie. */
export async function legeNonceAn(
  db: DbSchnittstelle,
  f: Familie,
  nonce: string,
  o: { fristS: number; offen: number; ausQr: boolean },
): Promise<boolean> {
  await db.run(
    `DELETE FROM geraete_nonces WHERE user_id = $1 AND familie = $2::timestamptz AND (ablauf <= NOW()
    OR nonce NOT IN (SELECT nonce FROM geraete_nonces WHERE user_id = $1 AND familie = $2::timestamptz
                     ORDER BY angelegt_am DESC LIMIT $3))`,
    [f.uid, f.seit, o.offen - 1],
  );
  return !!(await db.get<{ nonce: string }>(
    `INSERT INTO geraete_nonces (nonce, user_id, familie, aus_qr, ablauf)
     SELECT $3, $1, $2::timestamptz, $5, $2::timestamptz + make_interval(secs => $4)
      WHERE ${FAMILIE_LEBT} AND $2::timestamptz > NOW() - make_interval(secs => $4) RETURNING nonce`,
    [f.uid, f.seit, nonce, o.fristS, o.ausQr],
  ));
}

/** Die bei der QR-Abholung ausgegebene Nonce, solange sie gilt. */
export async function qrNonceDer(db: DbSchnittstelle, f: Familie): Promise<{ nonce: string; ablauf: Date } | null> {
  return (
    (await db.get<{ nonce: string; ablauf: Date }>(
      `SELECT nonce, ablauf FROM geraete_nonces WHERE user_id = $1 AND familie = $2::timestamptz AND aus_qr
         AND ablauf > NOW()`,
      [f.uid, f.seit],
    )) ?? null
  );
}

/** Löschen und Lesen in einem Schritt: Eine Nonce gilt genau einmal und nur für ihre Familie. */
export async function nimmNonce(db: DbSchnittstelle, f: Familie, nonce: string): Promise<boolean> {
  return !!(await db.get<{ nonce: string }>(
    `DELETE FROM geraete_nonces WHERE nonce = $1 AND user_id = $2 AND familie = $3::timestamptz AND ablauf > NOW()
     RETURNING nonce`,
    [nonce, f.uid, f.seit],
  ));
}

/** Höchstens [offen] gleichzeitig je Familie: Abholen ohne Einlösen füllt die Tabelle nicht. */
export async function legeChallengeAn(
  db: DbSchnittstelle,
  f: Familie,
  challenge: string,
  aktion: string,
  fristS: number,
  offen: number,
): Promise<Date> {
  await db.run(
    `DELETE FROM schritt_challenges WHERE user_id = $1 AND familie = $2::timestamptz AND (ablauf <= NOW()
    OR challenge NOT IN (SELECT challenge FROM schritt_challenges WHERE user_id = $1 AND familie = $2::timestamptz
                         ORDER BY angelegt_am DESC LIMIT $3))`,
    [f.uid, f.seit, offen - 1],
  );
  const z = await db.get<{ ablauf: Date }>(
    `INSERT INTO schritt_challenges (challenge, user_id, familie, aktion, ablauf)
     VALUES ($1, $2, $3::timestamptz, $4, NOW() + make_interval(secs => $5)) RETURNING ablauf`,
    [challenge, f.uid, f.seit, aktion, fristS],
  );
  if (!z) throw new Error('schritt_challenges: INSERT ohne Zeile');
  return z.ablauf;
}

/** Löschen und Lesen in einem Schritt: Eine Challenge gilt genau einmal, und nur für ihre Familie. */
export async function nimmChallenge(db: DbSchnittstelle, f: Familie, challenge: string): Promise<string | null> {
  const z = await db.get<{ aktion: string }>(
    `DELETE FROM schritt_challenges WHERE challenge = $1 AND user_id = $2 AND familie = $3::timestamptz
       AND ablauf > NOW() RETURNING aktion`,
    [challenge, f.uid, f.seit],
  );
  return z?.aktion ?? null;
}

export async function oeffneFreigabe(
  db: DbSchnittstelle,
  f: Familie,
  aktion: string,
  leerlaufS: number,
  hoechstensS: number,
): Promise<Date> {
  const z = await db.get<{ bis: Date }>(
    `INSERT INTO schritt_freigaben (user_id, familie, aktion, bis, hoechstens)
     VALUES ($1, $2::timestamptz, $3, NOW() + make_interval(secs => $4), NOW() + make_interval(secs => $5))
     ON CONFLICT (user_id, familie, aktion) DO UPDATE SET bis = EXCLUDED.bis, hoechstens = EXCLUDED.hoechstens
     RETURNING bis`,
    [f.uid, f.seit, aktion, leerlaufS, hoechstensS],
  );
  if (!z) throw new Error('schritt_freigaben: UPSERT ohne Zeile');
  return z.bis;
}

/** Prüfen und Verlängern in einem Schritt, nie über `hoechstens` hinaus. */
export async function nutzeFreigabe(
  db: DbSchnittstelle,
  f: Familie,
  aktion: string,
  leerlaufS: number,
): Promise<boolean> {
  return !!(
    await db.run(
      `UPDATE schritt_freigaben SET bis = LEAST(NOW() + make_interval(secs => $4), hoechstens)
      WHERE user_id = $1 AND familie = $2::timestamptz AND aktion = $3 AND bis > NOW()`,
      [f.uid, f.seit, aktion, leerlaufS],
    )
  ).changes;
}
