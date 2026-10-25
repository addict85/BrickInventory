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

/**
 * Wie viele Stufen tief aufgelöst wird.
 *
 * Kein fachliches Limit, sondern eine Reissleine: Der Pfadvergleich in der
 * rekursiven Abfrage fängt jeden Kreis schon ab, aber eine Abfrage, die durch
 * einen Datenfehler doch läuft, soll nicht den Server blockieren. Zehn Stufen
 * sind für eine Familie unerreichbar viel.
 */
export const MAX_STUFEN = 10;

export interface Household {
  /** Alle IDs des Blickfelds: eigene zuerst, dann alle Nachfahren. */
  memberIds: number[];
  /** true, wenn dieses Konto mindestens ein direktes Unterkonto hat. */
  isMain: boolean;
  /** Das DIREKTE Elternkonto — nicht die Wurzel des Baums. */
  linkedToMainId: number | null;
  /**
   * Nachfahre → Stufe (1 = direktes Unterkonto, 2 = dessen Unterkonto, …).
   *
   * Nur für die Anzeige: Der Kontofilter rückt die Einträge damit ein, sonst
   * stünden Kind und Enkel gleichrangig nebeneinander. Für die Berechtigung
   * spielt die Stufe keine Rolle — wer im Blickfeld steht, steht drin.
   */
  tiefen: Record<number, number>;
}

/**
 * Das Blickfeld eines Kontos.
 *
 * Ein Unterkonto sieht ausschliesslich sich selbst — die Sammlung der
 * Geschwister geht es nichts an, und der Hauptaccount ist kein gemeinsamer
 * Topf, sondern eine Sicht.
 */
// Was gemessen wurde
// resolveHousehold() steht am Anfang praktisch jedes Lese-Endpunkts und macht
// zwei Abfragen. Ueber die echten Routen gezaehlt:
// Ausführlich: docs/begruendungen/utils/household.ts.md#haushalt-kanal
export const HAUSHALT_KANAL = 'haushalt_geaendert';
const HAUSHALT_TTL_MS = 5 * 60 * 1000;
// Deckel wie bei _tokenCache in utils/auth.ts, aus demselben Grund.
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
 * Alle Nachfahren eines Kontos, mit ihrer Stufe — die eine rekursive Abfrage.
 * Ausführlich: docs/begruendungen/utils/household.ts.md#nachfahren
 */
async function nachfahren(id: number): Promise<Array<{ id: number; tiefe: number }>> {
  const rows = await db.all(
    `WITH RECURSIVE baum(id, tiefe, pfad) AS (
         SELECT sub_user_id, 1, ARRAY[main_user_id, sub_user_id]
           FROM account_links WHERE main_user_id = $1
       UNION ALL
         SELECT l.sub_user_id, b.tiefe + 1, b.pfad || l.sub_user_id
           FROM account_links l
           JOIN baum b ON l.main_user_id = b.id
          WHERE NOT (l.sub_user_id = ANY(b.pfad)) AND b.tiefe < $2
     )
     SELECT id, tiefe FROM baum ORDER BY tiefe, id`,
    [id, MAX_STUFEN]
  ).catch(() => []);
  return (rows || []).map((r: any) => ({ id: parseInt(r.id), tiefe: parseInt(r.tiefe) }));
}

export async function resolveHousehold(uid: number): Promise<Household> {
  const id = parseInt(String(uid));
  const treffer = _haushalte.get(id);
  // Die Listen werden bei JEDER Rueckgabe frisch gebaut. scopeIds() gibt
  // memberIds teilweise unveraendert weiter; wuerde ein Aufrufer die Liste
  // anfassen, veraenderte er sonst den gemerkten Stand fuer alle folgenden
  // Anfragen — ein Fehler, den man an der Fundstelle nie sehen wuerde.
  if (treffer && Date.now() - treffer.zeit < HAUSHALT_TTL_MS)
    return { ...treffer.wert, memberIds: [...treffer.wert.memberIds] };

  const [unten, parent] = await Promise.all([
    nachfahren(id),
    db.get('SELECT main_user_id FROM account_links WHERE sub_user_id = $1', [id])
      .catch(() => null),
  ]);
  const tiefen: Record<number, number> = {};
  for (const n of unten) tiefen[n.id] = n.tiefe;
  const haushalt: Household = {
    memberIds: [id, ...unten.map(n => n.id)],
    // „Hat Unterkonten" heisst DIREKTE Unterkonten. Ein Konto, das nur über
    // eine tiefere Stufe erreichbare Nachfahren hätte, kann es nicht geben —
    // jede Stufe hängt an der darüber.
    isMain: unten.some(n => n.tiefe === 1),
    linkedToMainId: parent ? parseInt(parent.main_user_id) : null,
    tiefen,
  };
  if (_haushalte.size >= HAUSHALT_MAX) _haushalte.clear();
  _haushalte.set(id, { wert: haushalt, zeit: Date.now() });
  return { ...haushalt, memberIds: [...haushalt.memberIds] };
}

/**
 * Darf `actorId` Daten von `ownerId` ändern?
 * Ausführlich: docs/begruendungen/utils/household.ts.md#canwritefor
 */
export async function canWriteFor(actorId: number, ownerId: number): Promise<boolean> {
  const actor = parseInt(String(actorId));
  const owner = parseInt(String(ownerId));
  if (actor === owner) return true;
  return (await nachfahren(actor)).some(n => n.id === owner);
}

/**
 * IDs, für die `uid` SCHREIBEN darf — eigene plus ALLE Nachfahren.
 * Ausführlich: docs/begruendungen/utils/household.ts.md#writableids
 */
export async function writableIds(uid: number): Promise<number[]> {
  const id = parseInt(String(uid));
  // Frisch abgefragt, nicht aus resolveHousehold() — dieselbe Begründung wie
  // bei canWriteFor(): Diese Liste entscheidet über Schreibzugriffe.
  return [id, ...(await nachfahren(id)).map(n => n.id)];
}

/**
 * Mitglieder mit Namen — für die Kontoauswahl und die Besitzer-Plaketten.
 * Ausführlich: docs/begruendungen/utils/household.ts.md#householdmembers
 */
export async function householdMembers(uid: number) {
  const h = await resolveHousehold(uid);
  const rows = await db.all(
    'SELECT id, username FROM users WHERE id = ANY($1) ORDER BY id', [h.memberIds]
  ).catch(() => []);
  // Reihenfolge des Blickfelds beibehalten: eigenes Konto zuerst, dann nach
  // Stufe — genau die Reihenfolge, in der der Filter sie anzeigt.
  return h.memberIds
    .map(id => rows.find((r: any) => parseInt(r.id) === id))
    .filter(Boolean)
    .map((r: any) => ({
      id: parseInt(r.id),
      username: r.username,
      is_self: parseInt(r.id) === parseInt(String(uid)),
      tiefe: h.tiefen[parseInt(r.id)] ?? 0,
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
  const [subParent, subBaum] = await Promise.all([
    db.get('SELECT main_user_id FROM account_links WHERE sub_user_id = $1', [subId])
      .catch(() => null),
    nachfahren(subId),
  ]);

  // Hoechstens ein Elternkonto — das steht auch als UNIQUE im Schema; hier
  // steht es, um eine verstaendliche Absage statt eines Datenbankfehlers zu
  // geben.
  if (subParent) {
    await release();
    return { fehler: 'konto_bereits_verknuepft' as const };
  }

  // Kein Kreis
  // Die einzige Grenze, die von „nur eine Stufe" uebrig ist.
  // Wuerde ein Konto seinen eigenen Nachfahren als Elternkonto annehmen,
  // entstuende A→B→…→A. `UNIQUE (sub_user_id)` faengt das NICHT: In einem …
  // Ausführlich: docs/begruendungen/utils/household.ts.md#redeeminvite-2
  if (subBaum.some(n => n.id === mainId)) {
    await release();
    return { fehler: 'verknuepfung_erzeugt_kreis' as const };
  }

  // Währung muss übereinstimmen — im GANZEN einziehenden Teilbaum
  // Die Haushaltssicht summiert Beträge. Zwei Konten mit CHF und EUR ergäben
  // eine Summe aus zwei Währungen — kommentarlos falsch, und niemand sähe es
  // der Zahl an. Lieber hier ablehnen als später falsch rechnen.
  // Ausführlich: docs/begruendungen/utils/household.ts.md#redeeminvite-einziehend
  const einziehend = [subId, ...subBaum.map(n => n.id)];
  const [curMain, ...curSubs] = await Promise.all([
    getSetting(mainId, 'currency', 'EUR'),
    ...einziehend.map(i => getSetting(i, 'currency', 'EUR')),
  ]);
  const abweichend = curSubs.findIndex(c => String(c) !== String(curMain));
  if (abweichend >= 0) {
    await release();
    return { fehler: 'waehrung_ungleich' as const,
             vars: { haupt: String(curMain), unter: String(curSubs[abweichend]) } };
  }

  await db.run(
    'INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [mainId, subId]
  );
  meldeHaushaltsaenderung();
  const main = await db.get('SELECT username FROM users WHERE id = $1', [mainId]).catch(() => null);
  return { linked_to: { id: mainId, username: main?.username || String(mainId) } };
}

/**
 * Verknüpfung lösen — von BEIDEN Seiten erlaubt.
 * Ausführlich: docs/begruendungen/utils/household.ts.md#unlink
 */
export async function unlink(uid: number, subUserId?: number | null) {
  const id = parseInt(String(uid));
  if (subUserId != null && String(subUserId) !== '') {
    const sub = parseInt(String(subUserId));
    const r = await db.run(
      'DELETE FROM account_links WHERE main_user_id = $1 AND sub_user_id = $2', [id, sub]);
    meldeHaushaltsaenderung();
    return { removed: (r as any)?.changes ?? 1 };
  }
  const r = await db.run('DELETE FROM account_links WHERE sub_user_id = $1', [id]);
  meldeHaushaltsaenderung();
  return { removed: (r as any)?.changes ?? 1 };
}

/** Zustand für die Einstellungen: eigene Rolle, Mitglieder, offene Einladungen. */
export async function householdStatus(uid: number) {
  const id = parseInt(String(uid));
  const h = await resolveHousehold(id);
  const members = await householdMembers(id);
  const mainUser = h.linkedToMainId
    ? await db.get('SELECT id, username FROM users WHERE id = $1', [h.linkedToMainId]).catch(() => null)
    : null;
  const openInvites = await db.get(
    `SELECT COUNT(*)::int AS n FROM account_link_invites
      WHERE main_user_id = $1 AND used_at IS NULL AND expires_at > NOW()`, [id]
  ).catch(() => ({ n: 0 }));
  const currency = await getSetting(id, 'currency', 'EUR');
  return {
    is_main: h.isMain,
    is_sub: !!h.linkedToMainId,
    currency,
    linked_to: mainUser ? { id: parseInt(mainUser.id), username: mainUser.username } : null,
    // NUR die direkten Unterkonten — die Liste ist zum Entfernen da, und
    // entfernen kann jedes Konto ausschliesslich die Verknüpfungen, die an ihm
    // selbst hängen (siehe unlink()). Ein Enkel stünde hier mit einem Knopf,
    // der nichts löschte.
    sub_accounts: members.filter(m => m.tiefe === 1),
    // Das ganze Blickfeld — für den Kontofilter, der jedes Konto einzeln
    // anbietet. Getrennt von sub_accounts, weil die beiden Listen zwei
    // verschiedene Fragen beantworten: „was kann ich lösen" und „was kann ich
    // ansehen".
    blickfeld: members,
    open_invites: openInvites?.n ?? 0,
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
 * Der Filter zeigt „Alle Konten", „Eigene" und dann JEDEN Nachfahren
 * namentlich — auch Enkel, eingerückt nach Stufe; für die einzelnen Konten
 * reist deren ID mit, und sie meint immer nur dieses eine Konto. 'subs' bleibt
 * als Sammelposten erhalten (alle Nachfahren zusammen, ohne das eigene).
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
  // Ein Konto ohne Nachfahren sieht nur sich selbst — der Filter kann daran
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
