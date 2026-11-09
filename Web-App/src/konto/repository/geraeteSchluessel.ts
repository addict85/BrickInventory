import * as db from '../../../db/database';

/** Eine Token-Familie: Konto und created_at (auf Millisekunden, wie es über JavaScript reist). */
export interface Familie {
  uid: number;
  seit: string;
}

const FAMILIE_LEBT = `EXISTS (SELECT 1 FROM api_tokens t WHERE t.user_id = $1
  AND date_trunc('milliseconds', t.created_at) = $2::timestamptz)`;

export async function schluesselDer(f: Familie): Promise<string | null> {
  const z = await db.get<{ oeffentlich: string }>(
    'SELECT oeffentlich FROM geraete_schluessel WHERE user_id = $1 AND familie = $2::timestamptz',
    [f.uid, f.seit],
  );
  return z?.oeffentlich ?? null;
}

/** Nur für eine lebende, junge Familie ohne Schlüssel; Reste widerrufener Familien fallen dabei weg.
 * @returns ob er jetzt gilt */
export async function legeSchluesselAn(f: Familie, oeffentlich: string, fristS: number): Promise<boolean> {
  await db.run(
    `DELETE FROM geraete_schluessel g WHERE g.user_id = $1 AND NOT EXISTS (SELECT 1 FROM api_tokens t
    WHERE t.user_id = g.user_id AND date_trunc('milliseconds', t.created_at) = g.familie)`,
    [f.uid],
  );
  return !!(await db.get(
    `INSERT INTO geraete_schluessel (user_id, familie, oeffentlich)
     SELECT $1, $2::timestamptz, $3 WHERE ${FAMILIE_LEBT} AND $2::timestamptz > NOW() - make_interval(secs => $4)
     ON CONFLICT (user_id, familie) DO NOTHING RETURNING user_id`,
    [f.uid, f.seit, oeffentlich, fristS],
  ));
}

/** Höchstens [offen] gleichzeitig je Familie: Abholen ohne Einlösen füllt die Tabelle nicht. */
export async function legeChallengeAn(
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
export async function nimmChallenge(f: Familie, challenge: string): Promise<string | null> {
  const z = await db.get<{ aktion: string }>(
    `DELETE FROM schritt_challenges WHERE challenge = $1 AND user_id = $2 AND familie = $3::timestamptz
       AND ablauf > NOW() RETURNING aktion`,
    [challenge, f.uid, f.seit],
  );
  return z?.aktion ?? null;
}

export async function oeffneFreigabe(
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
export async function nutzeFreigabe(f: Familie, aktion: string, leerlaufS: number): Promise<boolean> {
  return !!(
    await db.run(
      `UPDATE schritt_freigaben SET bis = LEAST(NOW() + make_interval(secs => $4), hoechstens)
      WHERE user_id = $1 AND familie = $2::timestamptz AND aktion = $3 AND bis > NOW()`,
      [f.uid, f.seit, aktion, leerlaufS],
    )
  ).changes;
}
