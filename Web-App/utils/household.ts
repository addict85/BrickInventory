/**
 * Haushalt — verknüpfte Konten.
 * Ausführlich: docs/begruendungen/utils/household.ts.md#abschnitt
 */
import * as db from '../db/database';
import { getSetting } from './settings';
import { fehlerWerfen } from './fehlerTexte';

/** Wie lange ein Einladungscode gilt. Lang genug für „später am Abend“,
 *  kurz genug, dass ein liegen gebliebener Code nicht dauerhaft öffnet. */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export interface Household {
  /** Alle IDs des Blickfelds: eigene zuerst, dann die direkten Unterkonten. */
  memberIds: number[];
  /** true, wenn dieses Konto mindestens ein Unterkonto hat. */
  isMain: boolean;
  /** Alle Elternkonten — ein Konto kann mehreren Haushalten angehören. */
  elternIds: number[];
}

/**
 * Das Blickfeld eines Kontos.
 *
 * Ein Unterkonto sieht ausschliesslich sich selbst — die Sammlung der
 * Geschwister geht es nichts an, und der Hauptaccount ist kein gemeinsamer
 * Topf, sondern eine Sicht.
 */
export const HAUSHALT_KANAL = 'haushalt_geaendert';
const HAUSHALT_TTL_MS = 5 * 60 * 1000;
const HAUSHALT_MAX = 500;
const _haushalte = new Map<number, { wert: Household; zeit: number }>();

/** Das Gedaechtnis leeren — vom Signal und von den Schreibwegen aus. */
export function leereHaushaltCache(): void { _haushalte.clear(); }

/**
 * Eine Haushaltsaenderung bekanntmachen: hier sofort, in den anderen Workern
 * ueber NOTIFY. Fehler werden verschluckt — das Signal ist die Beschleunigung,
 * die Frist ist die Zusicherung.
 */
export function meldeHaushaltsaenderung(): void {
  leereHaushaltCache();
  require('./pgNotify').notify(HAUSHALT_KANAL).catch(() => {});
}

/**
 * Die direkten Unterkonten. Rechte und Sicht gehen bewusst nicht weiter:
 * Jedes Konto im Blickfeld hat selbst einer Einladung DIESES Kontos zugestimmt.
 */
async function kinder(id: number): Promise<number[]> {
  const rows = await db.all(
    'SELECT sub_user_id FROM account_links WHERE main_user_id = $1 ORDER BY sub_user_id', [id]);
  return rows.map((r: { sub_user_id: number | string }) => parseInt(String(r.sub_user_id)));
}

export async function resolveHousehold(uid: number): Promise<Household> {
  const id = parseInt(String(uid));
  const treffer = _haushalte.get(id);
  // Kopien zurückgeben: Ein Aufrufer, der die Liste verändert, veränderte
  // sonst den gemerkten Stand aller folgenden Anfragen.
  if (treffer && Date.now() - treffer.zeit < HAUSHALT_TTL_MS)
    return { ...treffer.wert, memberIds: [...treffer.wert.memberIds], elternIds: [...treffer.wert.elternIds] };

  const [unten, eltern] = await Promise.all([
    kinder(id),
    db.all('SELECT main_user_id FROM account_links WHERE sub_user_id = $1 ORDER BY main_user_id', [id]),
  ]);
  const haushalt: Household = {
    memberIds: [id, ...unten],
    isMain: unten.length > 0,
    elternIds: eltern.map((r: { main_user_id: number | string }) => parseInt(String(r.main_user_id))),
  };
  if (_haushalte.size >= HAUSHALT_MAX) _haushalte.clear();
  _haushalte.set(id, { wert: haushalt, zeit: Date.now() });
  return { ...haushalt, memberIds: [...haushalt.memberIds], elternIds: [...haushalt.elternIds] };
}

/**
 * Darf `actorId` Daten von `ownerId` ändern? Eigene immer, sonst nur die eines
 * direkten Unterkontos. Frisch abgefragt, nicht aus dem Gedächtnis: Nach dem
 * Lösen darf kein früheres Elternkonto noch minutenlang schreiben.
 */
export async function canWriteFor(actorId: number, ownerId: number): Promise<boolean> {
  const actor = parseInt(String(actorId));
  const owner = parseInt(String(ownerId));
  if (actor === owner) return true;
  return !!(await db.get(
    'SELECT 1 FROM account_links WHERE main_user_id = $1 AND sub_user_id = $2', [actor, owner]));
}

/** IDs, für die `uid` SCHREIBEN darf — eigene plus direkte Unterkonten, frisch. */
export async function writableIds(uid: number): Promise<number[]> {
  const id = parseInt(String(uid));
  return [id, ...(await kinder(id))];
}

/**
 * Mitglieder mit Namen — für die Kontoauswahl und die Besitzer-Plaketten.
 * `tiefe` bleibt für ältere App-Fassungen im Feld (0 = eigenes, 1 = Unterkonto).
 */
export async function householdMembers(uid: number) {
  const h = await resolveHousehold(uid);
  const self = parseInt(String(uid));
  const rows = await db.all(
    'SELECT id, username FROM users WHERE id = ANY($1) ORDER BY id', [h.memberIds]
  );
  return h.memberIds
    .map(id => rows.find((r: any) => parseInt(r.id) === id))
    .filter(Boolean)
    .map((r: any) => ({
      id: parseInt(r.id),
      username: r.username,
      is_self: parseInt(r.id) === self,
      tiefe: parseInt(r.id) === self ? 0 : 1,
    }));
}

/** SHA-256 wie bei API-Tokens und QR-Codes — im Klartext steht der Code nirgends. */
function hash(token: string) {
  return require('crypto').createHash('sha256').update(token).digest('hex');
}

/**
 * Einladungscode erzeugen (nur der Hauptaccount in spe).
 *
 * Abgelaufene und verbrauchte Codes werden dabei mit entsorgt; die Tabelle
 * bleibt so von selbst klein.
 */
export async function createInvite(uid: number) {
  // Absagen kommen als CODE zurueck, nicht als Satz: Dieser
  // Helfer weiss nicht, welche Sprache der Anfragende sieht — die Route weiss
  // es, weil sie den Request hat.
  // Ausführlich: docs/begruendungen/utils/household.ts.md#createinvite-id
  const id = parseInt(String(uid));
  // Jedes Konto darf einladen, auch eines, das selbst Unterkonto ist
  // (Nachtrag 173, Marcos Festlegung): Ein Zwischenkonto ist Vater UND Kind.
  // Vorher stand hier eine Absage für diesen Fall.
  await db.run(
    `DELETE FROM account_link_invites WHERE expires_at < NOW() OR used_at IS NOT NULL`
  ).catch(() => {});

  const code = require('crypto').randomBytes(24).toString('base64url');
  await db.run(
    'INSERT INTO account_link_invites (token_hash, main_user_id, expires_at) VALUES ($1,$2,$3)',
    [hash(code), id, new Date(Date.now() + INVITE_TTL_MS)]
  );
  return { code, expires_in: INVITE_TTL_MS / 1000 };
}

/**
 * Einladungscode einlösen — das einlösende Konto wird Unterkonto.
 * Ausführlich: docs/begruendungen/utils/household.ts.md#redeeminvite
 */
export async function redeemInvite(uid: number, code: string) {
  const subId = parseInt(String(uid));
  if (typeof code !== 'string' || code.length < 8) {
    return { fehler: 'einladungscode_ungueltig' as const };
  }
  const th = hash(code.trim());

  const claimed = await db.get(
    `UPDATE account_link_invites SET used_at = NOW(), used_by = $2
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
      RETURNING main_user_id`,
    [th, subId]
  ).catch(() => null);
  if (!claimed) return { fehler: 'einladungscode_abgelaufen' as const };

  const mainId = parseInt(claimed.main_user_id);
  const release = async () => {
    await db.run(
      'UPDATE account_link_invites SET used_at = NULL, used_by = NULL WHERE token_hash = $1', [th]
    ).catch(() => {});
  };

  if (mainId === subId) {
    await release();
    return { fehler: 'konto_mit_sich_selbst' as const };
  }

  // Frisch, nicht ueber resolveHousehold(): Hier wird ueber eine Verknuepfung
  // entschieden, und ein fuenf Minuten alter Stand koennte einen Kreis
  // durchlassen, den eine gleichzeitige Einloesung gerade erst moeglich
  // gemacht hat.
  const [schonDa, umgekehrt] = await Promise.all([
    db.get('SELECT 1 FROM account_links WHERE main_user_id = $1 AND sub_user_id = $2', [mainId, subId]),
    db.get('SELECT 1 FROM account_links WHERE main_user_id = $1 AND sub_user_id = $2', [subId, mainId]),
  ]);
  if (schonDa) {
    await release();
    return { fehler: 'konto_bereits_verknuepft' as const };
  }
  // Gegenseitig verknüpft sähe jedes Konto das andere — dann gäbe es kein
  // Unterkonto mehr, nur zwei Hauptkonten, die einander schreiben dürfen.
  if (umgekehrt) {
    await release();
    return { fehler: 'verknuepfung_erzeugt_kreis' as const };
  }

  // Die Haushaltssicht summiert Beträge; zwei Währungen ergäben eine Summe,
  // der man den Fehler nicht ansieht.
  const [curMain, curSub] = await Promise.all([
    getSetting(mainId, 'currency', 'EUR'),
    getSetting(subId, 'currency', 'EUR'),
  ]);
  if (String(curMain) !== String(curSub)) {
    await release();
    return { fehler: 'waehrung_ungleich' as const,
             vars: { haupt: String(curMain), unter: String(curSub) } };
  }

  await db.run(
    'INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [mainId, subId]
  );
  await db.run('DELETE FROM household_former_links WHERE main_user_id = $1 AND sub_user_id = $2',
    [mainId, subId]);
  meldeHaushaltsaenderung();
  const main = await db.get('SELECT username FROM users WHERE id = $1', [mainId]).catch(() => null);
  return { linked_to: { id: mainId, username: main?.username || String(mainId) } };
}

/**
 * Verknüpfung lösen — von BEIDEN Seiten erlaubt.
 *
 * `subUserId`: das Elternkonto löst ein Unterkonto. `mainUserId`: das
 * Unterkonto löst sich von diesem einen Elternkonto. Ohne beides löst es sich
 * von allen — so verhält sich eine ältere App, die nur ein Elternkonto kannte.
 */
export async function unlink(uid: number, subUserId?: number | null, mainUserId?: number | null) {
  const id = parseInt(String(uid));
  const gesetzt = (v: unknown) => v != null && String(v) !== '';
  let r;
  if (gesetzt(subUserId)) {
    r = await db.run('DELETE FROM account_links WHERE main_user_id = $1 AND sub_user_id = $2',
      [id, parseInt(String(subUserId))]);
  } else if (gesetzt(mainUserId)) {
    r = await db.run('DELETE FROM account_links WHERE main_user_id = $1 AND sub_user_id = $2',
      [parseInt(String(mainUserId)), id]);
  } else {
    r = await db.run('DELETE FROM account_links WHERE sub_user_id = $1', [id]);
  }
  meldeHaushaltsaenderung();
  return { removed: (r as any)?.changes ?? 0 };
}

/** Den Hinweis auf eine getrennte Kette verwerfen (nur der eigene). */
export async function verwerfeGetrennt(uid: number, subUserId: number) {
  const r = await db.run('DELETE FROM household_former_links WHERE main_user_id = $1 AND sub_user_id = $2',
    [parseInt(String(uid)), parseInt(String(subUserId))]);
  return { removed: (r as any)?.changes ?? 0 };
}

/** Zustand für die Einstellungen: Elternkonten, Unterkonten, offene Einladungen, Hinweise. */
export async function householdStatus(uid: number) {
  const id = parseInt(String(uid));
  const h = await resolveHousehold(id);
  const members = await householdMembers(id);
  const [eltern, openInvites, currency, getrennt] = await Promise.all([
    db.all('SELECT id, username FROM users WHERE id = ANY($1) ORDER BY username', [h.elternIds]),
    db.get(
      `SELECT COUNT(*)::int AS n FROM account_link_invites
        WHERE main_user_id = $1 AND used_at IS NULL AND expires_at > NOW()`, [id]
    ).catch(() => ({ n: 0 })),
    getSetting(id, 'currency', 'EUR'),
    db.all(
      `SELECT f.sub_user_id AS id, u.username, v.username AS via
         FROM household_former_links f
         JOIN users u ON u.id = f.sub_user_id
         LEFT JOIN users v ON v.id = f.via_user_id
        WHERE f.main_user_id = $1 ORDER BY u.username`, [id]),
  ]);
  const elternListe = eltern.map((e: any) => ({ id: parseInt(e.id), username: e.username }));
  return {
    is_main: h.isMain,
    is_sub: elternListe.length > 0,
    currency,
    parents: elternListe,
    // Ältere App-Fassungen kennen nur ein Elternkonto.
    linked_to: elternListe[0] ?? null,
    sub_accounts: members.filter(m => !m.is_self),
    blickfeld: members,
    open_invites: openInvites?.n ?? 0,
    former_links: getrennt.map((g: any) => ({ id: parseInt(g.id), username: g.username, via: g.via ?? null })),
  };
}

/**
 * Die IDs, mit denen gearbeitet wird — für Abfragen der Form
 * `user_id = ANY($1)`.
 * Ausführlich: docs/begruendungen/utils/household.ts.md#abschnitt-2
 */
/**
 * 'all' | 'own' | 'subs' — oder die ID EINES Kontos des Haushalts.
 *
 * Der Filter zeigt „Alle Konten", „Eigene" und dann jedes Unterkonto
 * namentlich; für die einzelnen Konten reist deren ID mit, und sie meint immer
 * nur dieses eine Konto. 'subs' bleibt als Sammelposten (alle Unterkonten).
 */
export type ScopeMode = 'all' | 'own' | 'subs' | number;

/**
 * Kontofilter aus der Anfrage lesen.
 *
 * Unbekannte oder fehlende Werte ergeben 'all' — das ist für ein Konto ohne
 * Verknüpfung ohnehin dasselbe wie 'own'. Eine Zahl wird durchgereicht, aber
 * NICHT hier geprüft: Ob sie zum Haushalt gehört, weiss erst scopeIds().
 */
export function parseScopeMode(v: any): ScopeMode {
  if (v === 'own' || v === 'subs') return v;
  const n = parseInt(String(v));
  return Number.isFinite(n) && n > 0 ? n : 'all';
}

export async function scopeIds(uid: number, mode: ScopeMode = 'all'): Promise<number[]> {
  const h = await resolveHousehold(uid);
  const id = parseInt(String(uid));
  // Ein Konto ohne Unterkonten sieht nur sich selbst — der Filter kann daran
  // nichts ändern, und 'subs' wäre dort eine leere Liste, also eine leere
  // Ansicht ohne erkennbaren Grund.
  if (!h.isMain) return h.memberIds;
  if (mode === 'own')  return [id];
  if (mode === 'subs') return h.memberIds.filter(m => m !== id);
  if (typeof mode === 'number') {
    // EIN bestimmtes Konto — und ausdrücklich NUR dieses, ohne dessen eigene
    // Unterkonten (Nachtrag 173, Marcos Festlegung). Wer im Filter „Kind"
    // wählt, will die Sammlung des Kindes sehen, nicht die des Kindes samt
    // Enkel; für „mit allem darunter" gibt es den Eintrag des Kindes im
    // Filter des Kindes.
    //
    // Eine fremde ID fällt auf 'all' zurück statt einen fremden Bestand zu
    // zeigen; der Filter ist eine Ansichtshilfe, kein Zugriffsweg.
    return h.memberIds.includes(mode) ? [mode] : h.memberIds;
  }
  return h.memberIds;
}

/**
 * Das BLICKFELD — wessen Daten gerechnet werden.
 * Ausführlich: docs/begruendungen/utils/household.ts.md#blickfeldeingabe
 */
export type BlickfeldEingabe = number | number[];

/** Nach `asIds()`: immer eine Liste. */
export type Blickfeld = number[];

/** Eine ID oder eine Liste zu einer Liste normalisieren. */
export function asIds(v: BlickfeldEingabe): Blickfeld {
  return Array.isArray(v) ? v.map(x => parseInt(String(x))) : [parseInt(String(v))];
}

/**
 * Zielkonto für eine Erfassung bestimmen.
 * Ausführlich: docs/begruendungen/utils/household.ts.md#resolvewritetarget
 * @returns die Ziel-ID, oder null wenn nicht erlaubt (Aufrufer antwortet 403)
 */
export async function resolveWriteTarget(
  actorId: number, requested: any
): Promise<number | null> {
  if (requested === undefined || requested === null || requested === '') return actorId;
  const target = parseInt(String(requested));
  if (!Number.isFinite(target)) return null;
  return (await canWriteFor(actorId, target)) ? target : null;
}

/** Erfassungstabellen je Art — Whitelist, damit nie ein Request-Wert in den
 *  Tabellennamen gerät. */
const ACQ_TABLES = {
  set:  'set_acquisitions',
  part: 'part_acquisitions',
  fig:  'minifig_acquisitions',
} as const;

/**
 * Absender eines Eigentümerwechsels aus der ERFASSUNGSZEILE ermitteln.
 * Ausführlich: docs/begruendungen/utils/household.ts.md#acquisitionmovesource
 * @throws mit e.status 404 (Zeile existiert nicht) oder 403 (keine Richtung)
 */
export async function acquisitionMoveSource(
  actorId: number, kind: keyof typeof ACQ_TABLES, acqId: number
): Promise<number> {
  const row = await db.get(
    `SELECT user_id FROM ${ACQ_TABLES[kind]} WHERE id = $1`, [acqId]);
  if (!row) {
    fehlerWerfen('kaufpreis_nicht_gefunden', 404);
  }
  const owner = parseInt(String(row.user_id));
  if (!(await canWriteFor(actorId, owner))) {
    fehlerWerfen('kein_schreibrecht', 403);
  }
  return owner;
}
