import { registerActions } from './00-registry.js';
import { locale, t, tRaw } from '../i18n.js';
import { CURRENCY, G, api, esc, escJs, fmtN, fullUrl, knopfBesetzt, thumbUrl, toast } from './01-core.js';
import { detailZeile } from './01-bausteine.js';
import { alarmBlock, ladeAlarm, priceChartSVG, renderMarketRows, setzeAlarmFeld } from './07-admin.js';
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

/** Der Eintrag, ueber den der Uebernahme-Dialog gerade steht. */
let _uebernahme = null;

/** Der Eintrag, dessen Detail offen ist. */
let _detail = null;

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

  const arg = escJs(`${w.set_number}|${w.condition}|${w.user_id}`);
  return `
    <div style="display:flex;gap:12px;align-items:center;padding:10px;border:1px solid var(--bdr);
                border-radius:var(--rad);background:var(--sur);margin-bottom:8px">
      ${bild}
      <!-- Die Zeile selbst oeffnet das Detail — wie die Kachel in der Galerie.
           Nur der Textblock, nicht die ganze Zeile: Sonst laege der Knopf
           „Loeschen" auf einer Flaeche, die etwas anderes tut. -->
      <div style="flex:1;min-width:0;cursor:pointer" data-click="oeffneWunschDetail" data-arg="${arg}">
        <div style="font-weight:600">${titel}</div>
        <div style="font-size:.78rem;color:var(--mut)">${unter}</div>
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
      owner_user_id: selectedOwner('wl-owner'),
    });
    if (!d?.success) return;
    // „war schon drauf" ist keine Fehlermeldung, aber auch kein Neuzugang —
    // wer zweimal auf denselben Knopf drückt, soll den Unterschied sehen.
    toast(tRaw(d.war_neu ? 'wishlist.added' : 'wishlist.already'), 'ok');
    G('wl-num').value = '';
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
 * In die Galerie übernehmen — Schritt 1: fragen.
 *
 * Marcos Nachtrag: „gewisse Inhalte wie zB. Preis und Zustand, Anzahl müssen
 * beim Übernehmen angepasst werden." Vorher ging die Übernahme wortlos mit
 * Anzahl 1, ohne Kaufpreis und im Zustand des Wunsches durch — für ein Set,
 * das man gerade gekauft hat, ist keins davon zuverlässig richtig.
 *
 * Der Zustand ist mit dem des WUNSCHES vorbelegt, weil das der häufigste
 * Fall ist; änderbar, weil der zweithäufigste ist, dass man etwas anderes
 * gefunden hat.
 */
export function wunschUebernehmen(arg) {
  const { set_number, condition } = zerlege(arg);
  if (!set_number) return;
  _uebernahme = arg;
  const w = _wuensche.find(x => x.set_number === set_number && x.condition === condition);
  G('wl-take-tit').textContent = w?.name || set_number;
  G('wl-take-qty').value   = '1';
  G('wl-take-price').value = '';
  G('wl-take-cond').value  = condition === 'U' ? 'U' : 'N';
  G('wl-take-modal').classList.add('open');
}

export function schliesseUebernahme() {
  G('wl-take-modal').classList.remove('open');
  _uebernahme = null;
}

/**
 * Schritt 2: tun.
 *
 * Die Regel steht am Server (utils/wunschliste.ts): Er ruft addSet() — die
 * eine Wahrheit fürs Erfassen — und räumt danach Eintrag UND Preisalarm weg.
 *
 * Der ZUSTAND geht zweimal mit, und das ist Absicht: Im Pfad steht der des
 * Wunsches (die Zeile, die verschwindet), im Rumpf der, in dem erfasst wird.
 * Sie fallen auseinander, sobald jemand etwas anderes kauft, als er sich
 * gewünscht hat.
 *
 * Danach werden Galerie und Kennzahlen neu geladen: Das Set ist jetzt dort,
 * und wer hinüberwechselt, soll es sehen und nicht eine Ansicht von vorhin.
 */
export async function bestaetigeUebernahme() {
  if (!_uebernahme) return;
  const { set_number, condition, owner_user_id } = zerlege(_uebernahme);
  const roh = (G('wl-take-price').value || '').trim();
  const preis = parseFloat(roh.replace(',', '.'));
  await knopfBesetzt(G('wl-take-ok'), async () => {
    const d = await api('POST',
      `/v1/wishlist/${encodeURIComponent(set_number)}/${encodeURIComponent(condition)}/uebernehmen`,
      {
        owner_user_id,
        quantity:  parseInt(G('wl-take-qty').value) || 1,
        // Leer heisst „kein Kaufpreis" — der Server setzt dann den
        // Marktpreis ein, genau wie auf dem normalen Erfassungsweg.
        purchase_price: roh && !isNaN(preis) ? preis : undefined,
        condition: G('wl-take-cond').value,
      });
    if (!d?.success) return;
    schliesseUebernahme();
    // 'exists' heisst: Das Set war schon im Blickfeld. Der Wunsch ist
    // trotzdem erfüllt und verschwindet — er stünde sonst für etwas, das man
    // längst hat.
    toast(tRaw(d.action === 'exists' ? 'wishlist.taken_existing' : 'wishlist.taken'), 'ok');
    await ladeWunschliste();
    await loadGallery();
    await loadStats();
  });
}

/**
 * Das Detail eines Wunsches.
 *
 * ── Woher die Angaben kommen ────────────────────────────────────────────────
 *
 * Aus DREI Quellen, und keine davon ist neu:
 *
 *   * die Zeile selbst (Zustand, Notiz, Alarm, auf der Liste seit) — sie
 *     liegt bereits geladen vor, GET /wishlist bringt alles mit;
 *   * /catalog/sets/:sn für Thema, Teile, Minifiguren und die
 *     BrickLink-Adresse — derselbe Aufruf, den das Katalog-Detail macht;
 *   * /sets/:sn/price-history für Marktpreis UND Verlauf.
 *
 * Der dritte ist der interessante: Er verlangt KEINEN Besitz (die Route ruft
 * getSetPriceHistory ohne Besitzprüfung, und price_cache/price_history hängen
 * am Set, nicht am Konto). /sets/:sn/price dagegen antwortet mit 404, wenn
 * einem das Set nicht gehört — für einen Wunsch also unbrauchbar. Nachgesehen,
 * nicht vermutet.
 *
 * Damit braucht dieses Detail keinen einzigen neuen Endpunkt, und gezeichnet
 * wird es von denselben Funktionen wie der Set-Dialog.
 */
export async function oeffneWunschDetail(arg) {
  const { set_number, condition } = zerlege(arg);
  const w = _wuensche.find(x => x.set_number === set_number && x.condition === condition);
  if (!w) return;
  _detail = arg;

  G('wl-m-tit').textContent = w.name || w.set_number;
  G('wl-m-sub').textContent = [w.set_number, zustandText(w.condition)].join(' · ');
  const bild = w.image_url ? fullUrl(w.image_url) : '/assets/set-placeholder.svg';
  G('wl-m-img').src = bild;
  G('wl-m-img').dataset.orig = bild;
  G('wl-m-sparkline-content').innerHTML =
    `<span style="color:var(--mut);font-size:.78rem">${esc(tRaw('common.loading'))}</span>`;
  G('wl-m-market-rows').innerHTML = '';
  G('wl-m-det').innerHTML = zeilen(w);
  G('wl-m-bricklink').style.display = 'none';
  // Der Preisvergleich ist SOFORT da: Er hängt am Wunsch, nicht am Katalog
  // (utils/wunschliste.ts). Ein Set, das rb_sets nicht kennt, beantwortet
  // /catalog/sets/:nr mit 404 — dann blieb dieser Knopf aus, obwohl die
  // Adresse aus der Setnummer allein zu bilden ist.
  zeigeAdresse('wl-m-vergleich', w.preisvergleich_url);
  G('wl-detail-modal').classList.add('open');
  // Ab hier meinen die Alarm-Handler DIESEN Dialog.
  setzeAlarmFeld('wl-m');
  ladeAlarm(set_number).catch(() => {});

  // ── Der Preis, SOFORT ─────────────────────────────────────────────────
  //
  // Marcos Frage: „Wieso werden die Preise nicht sofort angezeigt?" Weil
  // /price-history nur den Cache LIEST und in den bis zu dieser Änderung
  // niemand für Wünsche schrieb. Diese Route holt ihn (mit TTL, also nicht
  // bei jedem Öffnen neu) und füllt den Cache gleich mit.
  api('GET', `/v1/wishlist/${encodeURIComponent(set_number)}/preise`).then(pr => {
    if (_detail !== arg || !pr?.success) return;
    // Dieselbe Form wie `current` in /price-history — deshalb genügt hier
    // dieselbe Zeichenfunktion.
    renderMarketRows({ by_condition: umAufAnzeige(pr.current) }, 'wl-m-market-rows');
  }).catch(() => {});

  // Katalog: Thema, Teile, Minifiguren, BrickLink. Schlägt er fehl (ein Set,
  // das rb_sets nicht kennt), bleibt der Block stehen, wie er ist — die
  // Angaben aus der Zeile sind dann alles, was es gibt.
  api('GET', `/v1/catalog/sets/${encodeURIComponent(set_number)}`).then(d => {
    if (_detail !== arg || !d?.success) return;
    katalogNachtragen(d.set, w);
    zeigeAdresse('wl-m-bricklink', d.set?.bricklink?.url);
    // Mit dem Katalognamen wird die Suche besser („LEGO 75192 Millennium
    // Falcon" statt nur der Nummer) — aber nur, wenn wirklich einer kam.
    zeigeAdresse('wl-m-vergleich', d.set?.preisvergleich_url || w.preisvergleich_url);
  }).catch(() => {});

  // Der VERLAUF — die Zeilen darüber stehen da schon. Er kommt aus
  // price_history, das der stündliche Preislauf füllt; für einen Wunsch seit
  // dieser Änderung ebenfalls (jobs/priceJob.ts). Ein frischer Wunsch hat
  // deshalb erst einen Punkt, und eine Linie braucht zwei — das ist kein
  // Fehler, sondern der Anfang.
  api('GET', `/v1/sets/${encodeURIComponent(set_number)}/price-history`).then(ph => {
    if (_detail !== arg) return;
    G('wl-m-sparkline-content').innerHTML = ph?.success
      ? priceChartSVG(ph, 'wl' + set_number.replace(/[^a-zA-Z0-9]/g, ''))
      : `<span style="color:var(--mut);font-size:.78rem">${esc(tRaw('detail.no_history'))}</span>`;
  }).catch(() => {});
}

/** Ein Knopf, der ins Leere führt, ist schlechter als keiner. */
function zeigeAdresse(id, url) {
  const el = G(id);
  if (!el) return;
  if (url) { el.href = url; el.style.display = ''; }
  else     { el.removeAttribute('href'); el.style.display = 'none'; }
}

const STRICH = '—';
const zahl = (n) => (n == null ? STRICH : Number(n).toLocaleString(locale()));

/**
 * Die Zeilen — dieselbe Auswahl und Reihenfolge wie im Set-Dialog, abzüglich
 * dessen, was einen Besitz voraussetzt.
 *
 * Sie werden GENAU EINMAL je Öffnen gebaut. Die drei Angaben, die erst der
 * Katalog liefert, tragen eine eigene Kennung und werden später an Ort und
 * Stelle nachgetragen (katalogNachtragen).
 *
 * ── Warum nicht einfach neu zeichnen ───────────────────────────────────────
 *
 * Genau das stand hier, und es war Marcos Befund „die Werte werden nicht
 * gespeichert": In dieser Zeilenliste steckt der ALARMBLOCK. Beim Öffnen lief
 * ladeAlarm() und füllte Richtung und Schwelle; kurz darauf kam die
 * Katalogantwort, zeichnete die Zeilen neu — und damit ein frisches, leeres
 * Alarmfeld. Der gespeicherte Wert war weg, und wer in dieser Sekunde schon
 * getippt hatte, verlor die Eingabe gleich mit.
 */
function zeilen(w) {
  return [
    ['detail.year',     w.year != null ? String(w.year) : STRICH, null],
    ['detail.theme',    STRICH, 'wl-m-theme'],
    ['detail.pieces',   zahl(w.num_parts), 'wl-m-pieces'],
    ['detail.minifigs', STRICH, 'wl-m-minifigs'],
    ['common.condition', esc(zustandText(w.condition)), null],
    ['wishlist.since',  w.created_at ? `📅 ${esc(new Date(w.created_at).toLocaleDateString(locale()))}` : STRICH, null],
    // Derselbe Block wie im Set-Dialog, nicht ein zweiter: Es ist derselbe
    // Eintrag in price_alerts, am selben Schlüssel (Konto, Set, Zustand).
    // Gefüllt wird er von ladeAlarm() beim Öffnen.
    ['detail.alert',    alarmBlock(w.set_number, 'wl-m'), null],
  ].map(([k, v, id]) => detailZeile(t(k), v, id ? { wertId: id } : {})).join('');
}

/**
 * Thema, Teile und Minifiguren nachtragen — als TEXT, nicht als neues Markup.
 *
 * textContent und nicht innerHTML: Der Themenname kommt aus dem Katalog und
 * ist damit fremder Text. So kann er gar nicht erst als Auszeichnung gelesen
 * werden, und es braucht kein esc() an einer weiteren Stelle.
 */
function katalogNachtragen(katalog, w) {
  const setze = (id, wert) => { const el = G(id); if (el) el.textContent = wert; };
  setze('wl-m-theme',    katalog?.theme_name || STRICH);
  setze('wl-m-pieces',   zahl(katalog?.num_parts ?? w.num_parts));
  setze('wl-m-minifigs', zahl(katalog?.minifigs));
}

export function schliesseWunschDetail() {
  G('wl-detail-modal').classList.remove('open');
  _detail = null;
}

/** Löschen und Übernehmen aus dem Detail — dieselben Wege wie aus der Liste. */
export async function wunschDetailLoeschen() {
  const arg = _detail;
  if (!arg) return;
  schliesseWunschDetail();
  await wunschLoeschen(arg);
}

export function wunschDetailUebernehmen() {
  const arg = _detail;
  if (!arg) return;
  schliesseWunschDetail();
  wunschUebernehmen(arg);
}

registerActions({ wunschHinzufuegen, katalogAufWunschliste, wunschLoeschen,
                  wunschUebernehmen, schliesseUebernahme, bestaetigeUebernahme,
                  oeffneWunschDetail, schliesseWunschDetail,
                  wunschDetailLoeschen, wunschDetailUebernehmen });

/**
 * `current` aus der Preis-Antwort in die Form, die renderMarketRows() liest.
 *
 * Die Zeichenfunktion erwartet `by_condition[c].market_price`; die
 * Preisantwort nennt es `avg_price` — dieselbe Zahl, anderer Name, weil die
 * eine aus dem Cache und die andere aus der Verlaufsrechnung kommt. Eine
 * Umbenennung am Server hiesse, an drei Stellen gleichzeitig zu ändern.
 *
 * `pnl_pct` bleibt leer: Es ist Gewinn gegen den Kaufpreis, und den hat ein
 * Wunsch nicht.
 */
function umAufAnzeige(current) {
  const raus = {};
  for (const c of ['N', 'U']) {
    const d = current?.[c];
    if (d) raus[c] = { market_price: d.avg_price, pnl_pct: null };
  }
  return raus;
}
