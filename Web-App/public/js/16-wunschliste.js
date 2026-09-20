import { registerActions } from './00-registry.js';
import { t, tRaw } from '../i18n.js';
import { G, api, esc, escJs, knopfBesetzt, thumbUrl, toast } from './01-core.js';
import { selectedOwner, loadGallery, loadStats } from './02-gallery.js';

// ═══ Wunschliste ═════════════════════════════════════════════════════════════
//
// ── Was sie ist, und was sie NICHT ist ──────────────────────────────────────
//
// Was man haben möchte — getrennt vom Besitz. Die Trennung ist der ganze
// Grund für eine eigene Tabelle (db/migrations/0021-wunschliste.sql): Stünde
// ein Wunsch in `sets`, zählte er in Galerie, Teileliste, Portfolio-Wert und
// Finanzansicht mit, und jede dieser Ansichten bräuchte ab dann einen Filter,
// den sie heute nicht hat.
//
// ── Warum der Zustand überall mitgeht ───────────────────────────────────────
//
// Neu und gebraucht sind zwei Wünsche mit zwei Schwellen — wer ein
// gebrauchtes zum Bauen und ein verpacktes zum Aufheben sucht, hat beide.
// Er steht deshalb im Schlüssel, genau wie beim Preisalarm seit 0019, und
// jeder Knopf hier trägt ihn mit.

/** Die zuletzt geladene Liste — für die Knöpfe, die auf eine Zeile zeigen. */
let _wuensche = [];

function zustandText(c) {
  return t(c === 'U' ? 'common.condition_used' : 'common.condition_new');
}

/**
 * Eine Zeile.
 *
 * Bewusst eine LISTE und keine Kachelwand wie die Galerie: Eine Wunschliste
 * wird gelesen und abgearbeitet, nicht bewundert. Die Notiz („Geschenk
 * Enkel") ist dabei so wichtig wie das Bild und hätte auf einer Kachel keinen
 * Platz.
 */
function zeile(w) {
  const bild = w.image_url
    ? `<img src="${esc(thumbUrl(w.image_url))}" alt="" loading="lazy" referrerpolicy="no-referrer"
            style="width:56px;height:56px;object-fit:contain;border-radius:6px;background:var(--bg)" />`
    : `<div style="width:56px;height:56px;border-radius:6px;background:var(--bg)"></div>`;

  // Kein Name heisst: rb_sets kennt das Set nicht. Der benannte Preis dafür,
  // dass hier keine zweite Kopie der Stammdaten liegt (siehe 0021) — sichtbar
  // und harmlos, statt eines Namens aus einer Quelle, die niemand nachführt.
  const titel = w.name ? esc(w.name) : esc(w.set_number);
  const unter = [
    esc(w.set_number),
    w.year ? String(w.year) : null,
    zustandText(w.condition),
  ].filter(Boolean).join(' · ');

  const alarm = w.alarm
    ? `<span style="background:var(--bg);border:1px solid var(--bdr)">
         ${w.alarm.ausgeloest ? '🔔' : '⏰'}
         ${esc(tRaw(w.alarm.richtung === 'ueber' ? 'detail.alert_above' : 'detail.alert_below'))}
         ${esc(String(w.alarm.schwelle))}
       </span>` : '';

  // „Habe ich das inzwischen?" ist die Frage, die in der Liste sofort
  // aufkommt — und sie meint das BLICKFELD: Beim Grossvater heisst „ich habe
  // es" auch „der Enkel hat es".
  const schon = w.owned
    ? `<span style="background:var(--ok-bg,var(--bg));border:1px solid var(--bdr)">${esc(tRaw('wishlist.owned'))}</span>`
    : '';

  const notiz = w.notiz
    ? `<div style="font-size:.78rem;color:var(--mut);margin-top:2px">${esc(w.notiz)}</div>` : '';

  const arg = escJs(`${w.set_number}|${w.condition}|${w.user_id}`);
  return `
    <div style="display:flex;gap:12px;align-items:center;padding:10px;border:1px solid var(--bdr);
                border-radius:var(--rad);background:var(--sur);margin-bottom:8px">
      ${bild}
      <div style="flex:1;min-width:0">
        <div style="font-weight:600">${titel}</div>
        <div style="font-size:.78rem;color:var(--mut)">${unter}</div>
        ${notiz}
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        ${alarm}${schon}
        <button class="btn bp btn-sm" data-click="wunschUebernehmen" data-arg="${arg}"
                data-i18n="wishlist.take">➕ In die Galerie</button>
        <button class="btn bs btn-sm" data-click="wunschLoeschen" data-arg="${arg}"
                data-i18n="confirm.delete_btn">Löschen</button>
      </div>
    </div>`;
}

/** Die Liste laden und zeichnen. */
export async function ladeWunschliste() {
  const ziel = G('wl-list');
  if (!ziel) return;
  const d = await api('GET', '/v1/wishlist').catch(() => null);
  _wuensche = d?.wuensche || [];
  ziel.innerHTML = _wuensche.length
    ? _wuensche.map(zeile).join('')
    : `<div style="padding:2rem;text-align:center;color:var(--mut)">${esc(tRaw('wishlist.empty'))}</div>`;
}

/**
 * Aus dem Formular des Reiters — „analog den Sets": dieselben Felder in
 * derselben Reihenfolge wie im Galerie-Kasten.
 */
export async function wunschHinzufuegen() {
  const num = (G('wl-num')?.value || '').trim();
  if (!num) { toast(tRaw('common.enter_set_number'), 'warn'); return; }
  await knopfBesetzt(G('wl-add'), async () => {
    const d = await api('POST', '/v1/wishlist', {
      set_number: num,
      condition:  G('wl-cond')?.value || 'N',
      notiz:      G('wl-note')?.value || '',
      owner_user_id: selectedOwner('wl-owner'),
    });
    if (!d?.success) return;
    // „war schon drauf" ist keine Fehlermeldung, aber auch kein Neuzugang —
    // wer zweimal auf denselben Knopf drückt, soll den Unterschied sehen.
    toast(tRaw(d.war_neu ? 'wishlist.added' : 'wishlist.already'), 'ok');
    G('wl-num').value = '';
    G('wl-note').value = '';
    await ladeWunschliste();
  });
}

/**
 * Aus dem Katalog-Detail — Marcos „inkl. Zustand und einem Preisalarm".
 *
 * Der Zustand kommt aus cat-m-cond, demselben Feld, das auch „In Galerie
 * aufnehmen" benutzt. Ein zweiter Zustandswähler nur für den Alarm wäre eine
 * Wahl, bei der man sich widersprechen kann.
 *
 * Der Alarm ist OPTIONAL: Ein Wunsch ohne Schwelle ist ein gültiger Wunsch.
 * Leer heisst „kein Alarm", nicht „Schwelle 0" — dieselbe Regel wie im
 * Set-Detail (07-admin.js).
 */
export async function katalogAufWunschliste() {
  const sn = G('cat-modal')?.dataset.setNumber;
  if (!sn) return;
  const zustand = G('cat-m-cond')?.value === 'U' ? 'U' : 'N';
  const owner   = selectedOwner('cat-m-owner');
  await knopfBesetzt(G('cat-m-wish'), async () => {
    const d = await api('POST', '/v1/wishlist',
      { set_number: sn, condition: zustand, owner_user_id: owner });
    if (!d?.success) return;

    // Der Alarm ist ein EIGENER Aufruf und nicht Teil des Wunsches: Er lebt
    // in price_alerts, gehört demselben Schlüssel und ist genau derselbe
    // Alarm, den das Set-Detail setzt. Ein zweiter Weg, eine Schwelle zu
    // speichern, wäre eine zweite Wahrheit.
    const roh = (G('cat-m-alert-val')?.value || '').trim();
    const schwelle = parseFloat(roh.replace(',', '.'));
    if (roh && !isNaN(schwelle) && schwelle > 0) {
      await api('PUT', `/v1/sets/${encodeURIComponent(sn)}/alert`, {
        richtung:  G('cat-m-alert-dir')?.value || 'unter',
        schwelle,
        condition: zustand,
      }).catch(() => null);
    }
    toast(tRaw(d.war_neu ? 'wishlist.added' : 'wishlist.already'), 'ok');
  });
}

/** setNumber|condition|user_id — der Schlüssel einer Zeile, wie ihn zeile() baut. */
function zerlege(arg) {
  const [set_number, condition, owner] = String(arg || '').split('|');
  return { set_number, condition, owner_user_id: parseInt(owner) };
}

export async function wunschLoeschen(arg) {
  const { set_number, condition, owner_user_id } = zerlege(arg);
  if (!set_number) return;
  const p = new URLSearchParams({ owner_user_id: String(owner_user_id) });
  const d = await api('DELETE',
    `/v1/wishlist/${encodeURIComponent(set_number)}/${encodeURIComponent(condition)}?${p}`);
  if (d?.success) { toast(tRaw('wishlist.deleted'), 'ok'); await ladeWunschliste(); }
}

/**
 * In die Galerie übernehmen.
 *
 * Die Regel steht am Server (utils/wunschliste.ts): Er ruft addSet() — die
 * eine Wahrheit fürs Erfassen — und räumt danach Eintrag UND Preisalarm weg.
 *
 * Danach werden Galerie und Kennzahlen neu geladen: Das Set ist jetzt dort,
 * und wer nach der Übernahme hinüberwechselt, soll es sehen und nicht eine
 * Ansicht von vorhin.
 */
export async function wunschUebernehmen(arg) {
  const { set_number, condition, owner_user_id } = zerlege(arg);
  if (!set_number) return;
  const d = await api('POST',
    `/v1/wishlist/${encodeURIComponent(set_number)}/${encodeURIComponent(condition)}/uebernehmen`,
    { owner_user_id });
  if (!d?.success) return;
  // 'exists' heisst: Das Set war schon im Blickfeld. Der Wunsch ist trotzdem
  // erfüllt und verschwindet — er stünde sonst für etwas, das man längst hat.
  toast(tRaw(d.action === 'exists' ? 'wishlist.taken_existing' : 'wishlist.taken'), 'ok');
  await ladeWunschliste();
  await loadGallery();
  await loadStats();
}

registerActions({ wunschHinzufuegen, katalogAufWunschliste, wunschLoeschen, wunschUebernehmen });
