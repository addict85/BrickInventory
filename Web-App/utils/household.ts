/**
 * Haushalt — verknüpfte Konten.
 *
 * ── Wozu ────────────────────────────────────────────────────────────────────
 * Eine Familie verwaltet die Sammlung je Kind in einem eigenen Konto. Der
 * Hauptaccount eines Haushalts sieht alles zusammen und darf verschieben.
 *
 * ── Die eine Stelle, an der „wessen Daten?" beantwortet wird ────────────────
 * Alles andere im Projekt fragt `resolveHousehold()` und bekommt eine Liste
 * von Benutzer-IDs. Wer eigene Abfragen gegen account_links baut, bekommt
 * früher oder später eine andere Antwort als der Rest — bei der
 * Zustandsauflösung ist genau das passiert (fünf Fundorte, leicht verschieden).
 *
 * ── Zwei Grenzen, die überall gelten ────────────────────────────────────────
 * 1. NUR EINE STUFE. Ein Hauptaccount ist nirgends Unterkonto und umgekehrt.
 *    Ohne diese Grenze bräuchte jede Abfrage eine rekursive Auflösung samt
 *    Zyklusschutz, und „wer darf verschieben" wäre nicht mehr eindeutig.
 * 2. LESEN WEIT, SCHREIBEN ENG. Der Haushalt erweitert das BLICKFELD. Ob
 *    jemand etwas ändern darf, beantwortet `canWriteFor()` — und zwar
 *    ausdrücklich, nicht als Nebenwirkung des Blickfelds.
 */
import * as db from '../db/database';
import { getSetting } from './settings';
import { fehlerWerfen } from './fehlerTexte';

/** Wie lange ein Einladungscode gilt. Lang genug für „später am Abend“,
 *  kurz genug, dass ein liegen gebliebener Code nicht dauerhaft öffnet. */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export interface Household {
  /** ID des Hauptaccounts — bei einem Konto ohne Verknüpfung die eigene. */
  mainId: number;
  /** Alle IDs des Blickfelds: eigene zuerst, dann die Unterkonten. */
  memberIds: number[];
  /** true, wenn dieses Konto Hauptaccount MIT mindestens einem Unterkonto ist. */
  isMain: boolean;
  /** Gesetzt, wenn dieses Konto selbst ein Unterkonto ist. */
  linkedToMainId: number | null;
}

/**
 * Das Blickfeld eines Kontos.
 *
 * Ein Unterkonto sieht ausschliesslich sich selbst — die Sammlung der
 * Geschwister geht es nichts an, und der Hauptaccount ist kein gemeinsamer
 * Topf, sondern eine Sicht.
 */
// ═══════════════════════════════════════════════════════════════════════════
// Das Blickfeld wird auf JEDER Anfrage gebraucht
// ═══════════════════════════════════════════════════════════════════════════
//
// ── Was gemessen wurde ──────────────────────────────────────────────────────
//
// resolveHousehold() steht am Anfang praktisch jedes Lese-Endpunkts und macht
// zwei Abfragen. Ueber die echten Routen gezaehlt:
//
//     /api/v1/sets          5 Abfragen, davon 2 auf account_links
//     /api/v1/parts         6 Abfragen, davon 2
//     /api/v1/minifigs      5 Abfragen, davon 2
//     /api/v1/stats         9 Abfragen, davon 2
//     /api/v1/parts/stats   5 Abfragen, davon 2
//
// Immer GENAU einmal je Anfrage — kein N+1, sondern ein fester Aufschlag:
// 0,438 ms je Aufruf (500 Aufrufe in 219 ms, lokaler Socket). Im Betrieb
// liegt Postgres in einem eigenen Container, der Umlauf kostet dort mehr.
//
// ── Warum ein Gedaechtnis vertretbar ist ────────────────────────────────────
//
// Ein Haushalt aendert sich, wenn jemand eine Einladung einloest oder eine
// Verknuepfung loest — also alle paar Monate, nicht alle paar Sekunden.
//
// ── Warum NOTIFY und nicht nur eine kurze Frist ─────────────────────────────
//
// Der Server laeuft im Cluster. Loest Worker A die Einladung ein, wuesste
// Worker B ohne Signal bis zum Ablauf der Frist nichts davon — der Nutzer
// klickt „einloesen" und sieht sein Unterkonto je nach Worker mal ja, mal
// nein. Genau dafuer gibt es utils/pgNotify.ts schon; hier wird es benutzt
// statt die Frist so kurz zu waehlen, dass sie den Gewinn wieder auffrisst.
//
// Die Frist bleibt als NETZ darunter: NOTIFY ist fluechtig (siehe pgNotify),
// ein Worker ohne Verbindung im Moment des Signals bekommt es nie.
//
// Jede Aenderung leert ALLES, nicht nur die betroffenen Konten. Eine
// Verknuepfung beruehrt immer zwei Konten, das Loeschen eines Kontos raeumt
// per ON DELETE CASCADE weitere Zeilen ab — und die Karte hat einen Eintrag
// je aktivem Nutzer, ist also winzig. Gezielt zu leeren waere mehr Code mit
// mehr Moeglichkeiten, einen Fall zu uebersehen.
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

export async function resolveHousehold(uid: number): Promise<Household> {
  const id = parseInt(String(uid));
  const treffer = _haushalte.get(id);
  // Die Listen werden bei JEDER Rueckgabe frisch gebaut. scopeIds() gibt
  // memberIds teilweise unveraendert weiter; wuerde ein Aufrufer die Liste
  // anfassen, veraenderte er sonst den gemerkten Stand fuer alle folgenden
  // Anfragen — ein Fehler, den man an der Fundstelle nie sehen wuerde.
  if (treffer && Date.now() - treffer.zeit < HAUSHALT_TTL_MS)
    return { ...treffer.wert, memberIds: [...treffer.wert.memberIds] };

  const [subs, parent] = await Promise.all([
    db.all('SELECT sub_user_id FROM account_links WHERE main_user_id = $1 ORDER BY sub_user_id', [id])
      .catch(() => []),
    db.get('SELECT main_user_id FROM account_links WHERE sub_user_id = $1', [id])
      .catch(() => null),
  ]);
  const subIds = (subs || []).map((r: any) => parseInt(r.sub_user_id));
  const haushalt: Household = {
    mainId: parent ? parseInt(parent.main_user_id) : id,
    memberIds: [id, ...subIds],
    isMain: subIds.length > 0,
    linkedToMainId: parent ? parseInt(parent.main_user_id) : null,
  };
  if (_haushalte.size >= HAUSHALT_MAX) _haushalte.clear();
  _haushalte.set(id, { wert: haushalt, zeit: Date.now() });
  return { ...haushalt, memberIds: [...haushalt.memberIds] };
}

/**
 * Darf `actorId` Daten von `ownerId` ändern?
 *
 * Eigene immer; fremde nur, wenn `ownerId` ein bestätigtes Unterkonto von
 * `actorId` ist. Bewusst eine eigene Funktion und nicht „steht in memberIds“:
 * Ein Unterkonto hat den Hauptaccount NICHT in seinem Blickfeld, und diese
 * Asymmetrie soll beim Lesen des Codes sichtbar sein.
 */
export async function canWriteFor(actorId: number, ownerId: number): Promise<boolean> {
  const actor = parseInt(String(actorId));
  const owner = parseInt(String(ownerId));
  if (actor === owner) return true;
  const row = await db.get(
    'SELECT 1 AS ok FROM account_links WHERE main_user_id = $1 AND sub_user_id = $2',
    [actor, owner]).catch(() => null);
  return !!row;
}

/**
 * IDs, für die `uid` SCHREIBEN darf — eigene plus bestätigte Unterkonten.
 *
 * ── Warum das gebraucht wird (Nachtrag 45, Marcos Fehlerbericht) ────────────
 * „Wenn ich den Kaufpreis anpasse, wird er nicht gespeichert; in der Webapp
 * kommt Not found." Die Erfassungs-Routen suchten die Zeile mit
 * `WHERE id=$1 AND user_id=$2` und der EIGENEN Betrachter-ID. Gehört die
 * Erfassung einem Unterkonto — im Haushalt der Normalfall —, findet das
 * Hauptkonto sie nicht und bekommt 404, obwohl es sie sehen und ändern DARF.
 *
 * Bewusst NICHT scopeIds(): Das ist das LESE-Blickfeld und enthält für ein
 * Unterkonto auch dessen Hauptkonto. Damit dürfte ein Unterkonto rückwärts
 * schreiben, und genau diese Asymmetrie („Lesen weit, Schreiben eng") ist eine
 * tragende Regel dieses Projekts. Die Menge hier ist deshalb absichtlich
 * kleiner als scopeIds() und deckt sich mit canWriteFor(): eigene ID immer,
 * fremde nur als bestätigtes Unterkonto.
 */
export async function writableIds(uid: number): Promise<number[]> {
  const id = parseInt(String(uid));
  const subs = await db.all(
    'SELECT sub_user_id FROM account_links WHERE main_user_id = $1 ORDER BY sub_user_id', [id]
  ).catch(() => []);
  return [id, ...(subs || []).map((r: any) => parseInt(r.sub_user_id))];
}

/** Mitglieder mit Namen — für die Kontoauswahl und die Besitzer-Plaketten. */
export async function householdMembers(uid: number) {
  const h = await resolveHousehold(uid);
  const rows = await db.all(
    'SELECT id, username FROM users WHERE id = ANY($1) ORDER BY id', [h.memberIds]
  ).catch(() => []);
  // Reihenfolge des Blickfelds beibehalten: eigenes Konto zuerst.
  return h.memberIds
    .map(id => rows.find((r: any) => parseInt(r.id) === id))
    .filter(Boolean)
    .map((r: any) => ({ id: parseInt(r.id), username: r.username, is_self: parseInt(r.id) === parseInt(String(uid)) }));
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
  // Absagen kommen als CODE zurueck, nicht als Satz (Nachtrag 130): Dieser
  // Helfer weiss nicht, welche Sprache der Anfragende sieht — die Route weiss
  // es, weil sie den Request hat.
  const id = parseInt(String(uid));
  const own = await resolveHousehold(id);
  // Eine Stufe: Wer selbst Unterkonto ist, kann keinen Haushalt aufmachen.
  if (own.linkedToMainId) {
    return { code: 'konto_bereits_verknuepft_eine_stufe' as const };
  }
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
 *
 * Der Code wird ATOMAR entwertet (UPDATE … WHERE used_at IS NULL … RETURNING),
 * damit zwei gleichzeitige Versuche nicht beide durchkommen. Erst danach wird
 * geprüft, ob die Verknüpfung überhaupt zulässig ist — schlägt eine Prüfung
 * fehl, wird der Code wieder freigegeben, sonst wäre er für den zweiten,
 * richtigen Versuch verbraucht.
 */
export async function redeemInvite(uid: number, code: string) {
  const subId = parseInt(String(uid));
  if (typeof code !== 'string' || code.length < 8) {
    return { code: 'einladungscode_ungueltig' as const };
  }
  const th = hash(code.trim());

  const claimed = await db.get(
    `UPDATE account_link_invites SET used_at = NOW(), used_by = $2
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
      RETURNING main_user_id`,
    [th, subId]
  ).catch(() => null);
  if (!claimed) return { code: 'einladungscode_abgelaufen' as const };

  const mainId = parseInt(claimed.main_user_id);
  const release = async () => {
    await db.run(
      'UPDATE account_link_invites SET used_at = NULL, used_by = NULL WHERE token_hash = $1', [th]
    ).catch(() => {});
  };

  if (mainId === subId) {
    await release();
    return { code: 'konto_mit_sich_selbst' as const };
  }

  const [subState, mainState] = await Promise.all([
    resolveHousehold(subId), resolveHousehold(mainId),
  ]);
  if (subState.linkedToMainId) {
    await release();
    return { code: 'konto_bereits_verknuepft' as const };
  }
  // Eine Stufe, beide Richtungen: Wer selbst Unterkonten hat, kann nicht
  // Unterkonto werden; wer Unterkonto ist, kann keine aufnehmen.
  if (subState.isMain) {
    await release();
    return { code: 'konto_hat_unterkonten' as const };
  }
  if (mainState.linkedToMainId) {
    await release();
    return { code: 'einladender_ist_unterkonto' as const };
  }

  // ── Währung muss übereinstimmen ───────────────────────────────────────────
  // Die Haushaltssicht summiert Beträge. Zwei Konten mit CHF und EUR ergäben
  // eine Summe aus zwei Währungen — kommentarlos falsch, und niemand sähe es
  // der Zahl an. Lieber hier ablehnen als später falsch rechnen.
  const [curMain, curSub] = await Promise.all([
    getSetting(mainId, 'currency', 'EUR'),
    getSetting(subId, 'currency', 'EUR'),
  ]);
  if (String(curMain) !== String(curSub)) {
    await release();
    return { code: 'waehrung_ungleich' as const, vars: { haupt: String(curMain), unter: String(curSub) } };
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
 *
 * Der Hauptaccount entfernt ein Unterkonto (subId gesetzt), das Unterkonto
 * löst sich selbst (subId leer). Ein Unterkonto, das nicht mehr mitmachen
 * will, wäre sonst auf das Wohlwollen des Hauptaccounts angewiesen.
 *
 * Daten bleiben, wo sie sind. Bereits verschobene Sets bleiben verschoben —
 * sie gehören dem Zielkonto, nicht dem Haushalt.
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
    // Unterkonten ohne das eigene Konto — die Liste ist zum Entfernen da.
    sub_accounts: members.filter(m => !m.is_self),
    open_invites: openInvites?.n ?? 0,
  };
}

/**
 * Die IDs, mit denen gearbeitet wird — für Abfragen der Form
 * `user_id = ANY($1)`.
 *
 * ── Der Filter ──────────────────────────────────────────────────────────────
 * Ein Hauptkonto kann JE ANSICHT zwischen Alle / Eigene / Unterkonten
 * umschalten. Der Wert reist als Anfrageparameter mit (`accounts=`) und wird
 * genau hier in Konto-IDs übersetzt — deshalb kennt ihn jede Zahl derselben
 * Antwort automatisch: Liste, Gesamtzahl, Kennzahlen und Summen entstehen aus
 * derselben ID-Liste.
 *
 * Das ist der Grund, warum der Filter am Server hängt und nicht in der
 * Oberfläche gefiltert wird: Eine Kachelwand liesse sich clientseitig
 * aussieben, die Gesamtzahl darunter und die Bewertung im Finanzreiter nicht.
 *
 * Für ein Konto OHNE Unterkonten ist der Filter wirkungslos — es sieht sich
 * selbst, egal was gefragt wird.
 *
 * Diese Liste ist zugleich der SCHREIBBEREICH: Der Hauptaccount darf in den
 * Daten seiner Unterkonten schreiben (so festgelegt), ein Unterkonto nur in
 * seinen eigenen. `canWriteFor()` bleibt trotzdem, für den Fall, dass ein
 * Zielkonto AUSDRÜCKLICH benannt wird (Erfassen mit Kontoauswahl,
 * Verschieben) — dort genügt „steht in der Liste" nicht, dort muss die
 * Richtung stimmen.
 */
/**
 * 'all' | 'own' | 'subs' — oder die ID EINES Kontos des Haushalts.
 *
 * Der Filter zeigt „Alle Konten", „Eigene" und dann jedes Unterkonto
 * namentlich; für die einzelnen Konten reist deren ID mit. 'subs' bleibt als
 * Sammelposten erhalten (alle Unterkonten zusammen, ohne das eigene).
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
  // Ein Unterkonto (oder ein Konto ohne Verknüpfung) hat nur sich selbst im
  // Blickfeld — der Filter kann daran nichts ändern, und 'subs' wäre dort
  // eine leere Liste, also eine leere Ansicht ohne erkennbaren Grund.
  if (!h.isMain) return h.memberIds;
  if (mode === 'own')  return [id];
  if (mode === 'subs') return h.memberIds.filter(m => m !== id);
  if (typeof mode === 'number') {
    // EIN bestimmtes Konto — aber nur, wenn es zum Haushalt gehört. Eine
    // fremde ID fällt auf 'all' zurück statt einen fremden Bestand zu zeigen;
    // der Filter ist eine Ansichtshilfe, kein Zugriffsweg.
    return h.memberIds.includes(mode) ? [mode] : h.memberIds;
  }
  return h.memberIds;
}

/** Eine ID oder eine Liste zu einer Liste normalisieren. */
export function asIds(v: number | number[]): number[] {
  return Array.isArray(v) ? v.map(x => parseInt(String(x))) : [parseInt(String(v))];
}

/**
 * Zielkonto für eine Erfassung bestimmen.
 *
 * Ohne Angabe das eigene Konto — so verhält sich alles wie vor der
 * Haushaltssicht. Mit Angabe nur, wenn der Anfragende dafür schreiben darf:
 * `canWriteFor()` prüft die RICHTUNG (Hauptkonto → eigenes Unterkonto), nicht
 * bloss die Mitgliedschaft im Blickfeld. Ein Unterkonto darf also nicht ins
 * Nachbarkonto schreiben, auch wenn beide im selben Haushalt sind.
 *
 * Stand zuerst nur in routes/sets.ts. Teile und Minifiguren brauchen dieselbe
 * Auflösung — und drei Kopien einer Rechteprüfung sind die Sorte Doppelung,
 * bei der irgendwann eine davon grosszügiger ist als die anderen.
 *
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
 *
 * Beim Umhängen eines Kaufpreises ist die Zeilen-ID eindeutig — wem sie
 * gehört, weiss die Datenbank besser als jeder Dialog. Die Webapp schickte
 * hier den BETRACHTER als from_user_id mit (die Zeilen-Eigentümer standen nur
 * im Select der Anzeige): Zog das Hauptkonto die Zeile eines Unterkontos zu
 * sich, suchte der Server sie unter dem falschen Konto und antwortete 404.
 * Deshalb ermittelt der Server den Absender jetzt selbst; ein mitgeschickter
 * from_user_id wird ignoriert.
 *
 * Geprüft wird ausschliesslich die Schreib-Richtung (`canWriteFor`): eigene
 * Zeile immer, fremde nur als Hauptkonto für ein eigenes Unterkonto. Eine
 * Zeile ausserhalb dieser Menge antwortet 403 — nicht 404, denn ob es sie
 * gibt, geht den Anfragenden dann nichts an.
 *
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
