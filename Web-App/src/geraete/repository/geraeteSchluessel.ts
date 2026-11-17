import type { DbSchnittstelle } from '../../../db/database';
import type { GeraeteLesevertrag } from '../lesevertrag';

/** Eine Token-Familie: Konto und created_at (auf Millisekunden, wie es über JavaScript reist). */
export interface Familie {
  uid: number;
  seit: string;
}

/** Ein unbestätigter Schlüssel (vor der Attestation hinterlegt) gilt nur bis [altBis]. */
/** Die Familie eines eben ausgestellten Tokens, auf Millisekunden wie familieLebt. */
export async function familieDesTokens(
  db: DbSchnittstelle,
  l: GeraeteLesevertrag,
  hash: string,
): Promise<Familie | null> {
  const z = await db.get<{ uid: number; seit: Date }>(l.tokenFamilieSql('$1'), [hash]);
  return z ? { uid: z.uid, seit: new Date(z.seit).toISOString() } : null;
}

export async function schluesselDer(db: DbSchnittstelle, f: Familie, altBis: Date): Promise<string | null> {
  const z = await db.get<{ public_key: string }>(
    `SELECT public_key FROM device_keys WHERE user_id = $1 AND token_family = $2::timestamptz
       AND (attested OR NOW() < $3)`,
    [f.uid, f.seit, altBis],
  );
  return z?.public_key ?? null;
}

export async function eintragDer(
  db: DbSchnittstelle,
  f: Familie,
): Promise<{ public_key: string; attested: boolean } | null> {
  return (
    (await db.get<{ public_key: string; attested: boolean }>(
      'SELECT public_key, attested FROM device_keys WHERE user_id = $1 AND token_family = $2::timestamptz',
      [f.uid, f.seit],
    )) ?? null
  );
}

/** Nur für eine lebende, junge Familie; ein unbestätigter Schlüssel darf dabei einem
 * attestierten weichen. Reste widerrufener Familien fallen weg.
 * @returns ob er jetzt gilt */
export async function legeSchluesselAn(
  db: DbSchnittstelle,
  l: GeraeteLesevertrag,
  f: Familie,
  public_key: string,
  fristS: number,
): Promise<boolean> {
  await db.run(
    `DELETE FROM device_keys g WHERE g.user_id = $1 AND NOT ${l.familieLebt('g.user_id', 'g.token_family')}`,
    [f.uid],
  );
  return !!(await db.get<{ user_id: number }>(
    `INSERT INTO device_keys (user_id, token_family, public_key, attested)
     SELECT $1, $2::timestamptz, $3, true WHERE ${l.familieLebt('$1', '$2')} AND $2::timestamptz > NOW() - make_interval(secs => $4)
     ON CONFLICT (user_id, token_family) DO UPDATE SET public_key = EXCLUDED.public_key, attested = true,
       created_at = NOW() WHERE NOT device_keys.attested
     RETURNING user_id`,
    [f.uid, f.seit, public_key, fristS],
  ));
}

/** Eine Nonce für die Attestation-Challenge; höchstens [offen] je Familie, nur für eine junge Familie. */
export async function legeNonceAn(
  db: DbSchnittstelle,
  l: GeraeteLesevertrag,
  f: Familie,
  nonce: string,
  o: { fristS: number; offen: number; ausQr: boolean },
): Promise<boolean> {
  await db.run(
    `DELETE FROM device_nonces WHERE user_id = $1 AND token_family = $2::timestamptz AND (expires_at <= NOW()
    OR nonce NOT IN (SELECT nonce FROM device_nonces WHERE user_id = $1 AND token_family = $2::timestamptz
                     ORDER BY created_at DESC LIMIT $3))`,
    [f.uid, f.seit, o.offen - 1],
  );
  return !!(await db.get<{ nonce: string }>(
    `INSERT INTO device_nonces (nonce, user_id, token_family, from_qr, expires_at)
     SELECT $3, $1, $2::timestamptz, $5, $2::timestamptz + make_interval(secs => $4)
      WHERE ${l.familieLebt('$1', '$2')} AND $2::timestamptz > NOW() - make_interval(secs => $4) RETURNING nonce`,
    [f.uid, f.seit, nonce, o.fristS, o.ausQr],
  ));
}

/** Die bei der QR-Abholung ausgegebene Nonce, solange sie gilt. */
export async function qrNonceDer(db: DbSchnittstelle, f: Familie): Promise<{ nonce: string; expires_at: Date } | null> {
  return (
    (await db.get<{ nonce: string; expires_at: Date }>(
      `SELECT nonce, expires_at FROM device_nonces WHERE user_id = $1 AND token_family = $2::timestamptz AND from_qr
         AND expires_at > NOW()`,
      [f.uid, f.seit],
    )) ?? null
  );
}

/** Löschen und Lesen in einem Schritt: Eine Nonce gilt genau einmal und nur für ihre Familie. */
export async function nimmNonce(db: DbSchnittstelle, f: Familie, nonce: string): Promise<boolean> {
  return !!(await db.get<{ nonce: string }>(
    `DELETE FROM device_nonces WHERE nonce = $1 AND user_id = $2 AND token_family = $3::timestamptz AND expires_at > NOW()
     RETURNING nonce`,
    [nonce, f.uid, f.seit],
  ));
}

/** Höchstens [offen] gleichzeitig je Familie: Abholen ohne Einlösen füllt die Tabelle nicht. */
export async function legeChallengeAn(
  db: DbSchnittstelle,
  f: Familie,
  challenge: string,
  action: string,
  fristS: number,
  offen: number,
): Promise<Date> {
  await db.run(
    `DELETE FROM step_up_challenges WHERE user_id = $1 AND token_family = $2::timestamptz AND (expires_at <= NOW()
    OR challenge NOT IN (SELECT challenge FROM step_up_challenges WHERE user_id = $1 AND token_family = $2::timestamptz
                         ORDER BY created_at DESC LIMIT $3))`,
    [f.uid, f.seit, offen - 1],
  );
  const z = await db.get<{ expires_at: Date }>(
    `INSERT INTO step_up_challenges (challenge, user_id, token_family, action, expires_at)
     VALUES ($1, $2, $3::timestamptz, $4, NOW() + make_interval(secs => $5)) RETURNING expires_at`,
    [challenge, f.uid, f.seit, action, fristS],
  );
  if (!z) throw new Error('step_up_challenges: INSERT ohne Zeile');
  return z.expires_at;
}

/** Löschen und Lesen in einem Schritt: Eine Challenge gilt genau einmal, und nur für ihre Familie. */
export async function nimmChallenge(db: DbSchnittstelle, f: Familie, challenge: string): Promise<string | null> {
  const z = await db.get<{ action: string }>(
    `DELETE FROM step_up_challenges WHERE challenge = $1 AND user_id = $2 AND token_family = $3::timestamptz
       AND expires_at > NOW() RETURNING action`,
    [challenge, f.uid, f.seit],
  );
  return z?.action ?? null;
}

export async function oeffneFreigabe(
  db: DbSchnittstelle,
  f: Familie,
  action: string,
  leerlaufS: number,
  hoechstensS: number,
): Promise<Date> {
  const z = await db.get<{ until_at: Date }>(
    `INSERT INTO step_up_approvals (user_id, token_family, action, until_at, max_until)
     VALUES ($1, $2::timestamptz, $3, NOW() + make_interval(secs => $4), NOW() + make_interval(secs => $5))
     ON CONFLICT (user_id, token_family, action) DO UPDATE SET until_at = EXCLUDED.until_at, max_until = EXCLUDED.max_until
     RETURNING until_at`,
    [f.uid, f.seit, action, leerlaufS, hoechstensS],
  );
  if (!z) throw new Error('step_up_approvals: UPSERT ohne Zeile');
  return z.until_at;
}

/** Prüfen und Verlängern in einem Schritt, nie über `max_until` hinaus. */
export async function nutzeFreigabe(
  db: DbSchnittstelle,
  f: Familie,
  action: string,
  leerlaufS: number,
): Promise<boolean> {
  return !!(
    await db.run(
      `UPDATE step_up_approvals SET until_at = LEAST(NOW() + make_interval(secs => $4), max_until)
      WHERE user_id = $1 AND token_family = $2::timestamptz AND action = $3 AND until_at > NOW()`,
      [f.uid, f.seit, action, leerlaufS],
    )
  ).changes;
}
