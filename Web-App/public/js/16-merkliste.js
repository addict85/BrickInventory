import { registerActions } from './00-registry.js';
import { locale, t, tRaw } from '../i18n.js';
import { CURRENCY, G, api, esc, escJs, escUrl, fmtN, fullUrl, imgUrl, knopfBesetzt, thumbUrl, toast } from './01-core.js';
import { detailZeile } from './01-bausteine.js';
import { alarmBlock, ladeAlarm, priceChartSVG, renderMarketRows, setzeAlarmFeld } from './07-admin.js';
import { selectedOwner, haushaltsKonten, loadGallery, loadStats } from './02-gallery.js';

// ═══ Merkliste ═════════════════════════════════════════════════════════════
//
// ── Was sie ist, und was sie NICHT ist ──────────────────────────────────────
//
// Was man haben möchte — getrennt vom Besitz. Die Trennung ist der ganze
// Grund für eine eigene Tabelle (db/migrations/0021-merkliste.sql): Stünde
// ein Merkposten in `sets`, zählte er in Galerie, Teileliste, Portfolio-Wert und
// Finanzansicht mit, und jede dieser Ansichten bräuchte ab dann einen Filter,
// den sie heute nicht hat.
//
// ── Warum der Zustand überall mitgeht ───────────────────────────────────────
//
// Neu und gebraucht sind zwei Merkposten mit zwei Schwellen — wer ein
// gebrauchtes zum Bauen und ein verpacktes zum Aufheben sucht, hat beide.
// Er steht deshalb im Schlüssel, genau wie beim Preisalarm seit 0019, und
// jeder Knopf hier trägt ihn mit.

/** Die zuletzt geladene Liste — für die Knöpfe, die auf eine Zeile zeigen. */
let _merkposten = [];

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
 * Bewusst eine LISTE und keine Kachelwand wie die Galerie: Eine Merkliste
 * wird gelesen und abgearbeitet, nicht bewundert. Die Notiz („Geschenk
 * Enkel") ist dabei so wichtig wie das Bild und hätte auf einer Kachel keinen
 * Platz.
 */
function zeile(w) {
  // ── Warum imgUrl() und nicht die Adresse selbst ─────────────────────────
  //
  // Marcos Befund: „Die Bilder in der Merkliste werden nicht geladen.
  // Anscheinend wird direkt das CDN aufgerufen." Genau so war es: Hier stand
  // `thumbUrl(w.image_url)`, und thumbUrl() reicht seine Eingabe unveraendert
  // durch (01-core.js) — gedacht fuer LOKALE Pfade. Fuer eine CDN-Adresse
  // kommt sie unveraendert wieder heraus, der Browser ruft cdn.rebrickable.com
  // direkt auf, und die Sicherheitsrichtlinie der Seite blockt das:
  //
  //     img-src 'self' data: blob:
  //
  // Jede andere Liste schreibt deshalb imgUrl(thumbUrl(lokal || cdn), …) —
  // erst das nimmt den Weg ueber den eigenen Server.
  //
  // 'nur' und nicht `true`: Dieselbe Wahl wie im Katalog. Sie NUTZT eine
  // Vorschau, laesst aber keine erzeugen — und hinterlaesst dabei die Notiz,
  // an der jobs/imageQueue.ts das Bild ueberhaupt erst lokal ablegt
  // (routes/imgProxy.ts, notiere()). Sobald es liegt, kommt es als
  // image_local mit und der Proxy ist ganz aus dem Weg.
  const roh = w.image_local || w.image_url;
  const bild = roh
    ? `<img src="${escUrl(imgUrl(thumbUrl(roh) || roh, 'nur'))}" alt="" loading="lazy" decoding="async"
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
    ? `<span style="background:var(--ok-bg,var(--bg));border:1px solid var(--bdr)">${esc(tRaw('wanted.owned'))}</span>`
    : '';

  const arg = escJs(`${w.set_number}|${w.condition}|${w.user_id}`);
  return `
    <div style="display:flex;gap:12px;align-items:center;padding:10px;border:1px solid var(--bdr);
                border-radius:var(--rad);background:var(--sur);margin-bottom:8px">
      ${bild}
      <!-- Die Zeile selbst oeffnet das Detail — wie die Kachel in der Galerie.
           Nur der Textblock, nicht die ganze Zeile: Sonst laege der Knopf
           „Loeschen" auf einer Flaeche, die etwas anderes tut. -->
      <div style="flex:1;min-width:0;cursor:pointer" data-click="oeffneMerkpostenDetail" data-arg="${arg}">
        <div style="font-weight:600">${titel}</div>
        <div style="font-size:.78rem;color:var(--mut)">${unter}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        ${alarm}${schon}
        <button class="btn bp btn-sm" data-click="merkpostenUebernehmen" data-arg="${arg}"
                data-i18n="wanted.take">➕ In die Galerie</button>
        <button class="btn bs btn-sm" data-click="merkpostenLoeschen" data-arg="${arg}"
                data-i18n="confirm.delete_btn">Löschen</button>
      </div>
    </div>`;
}

/** Die Liste laden und zeichnen. */
export async function ladeMerkliste() {
  const ziel = G('mk-list');
  if (!ziel) return;
  const d = await api('GET', '/v1/wanted').catch(() => null);
  _merkposten = d?.merkposten || [];
  ziel.innerHTML = _merkposten.length
    ? _merkposten.map(zeile).join('')
    : `<div style="padding:2rem;text-align:center;color:var(--mut)">${esc(tRaw('wanted.empty'))}</div>`;
}

/**
 * Aus dem Formular des Reiters — „analog den Sets": dieselben Felder in
 * derselben Reihenfolge wie im Galerie-Kasten.
 */
export async function merkpostenHinzufuegen() {
  const num = (G('mk-num')?.value || '').trim();
  if (!num) { toast(tRaw('common.enter_set_number'), 'warn'); return; }
  const frei = knopfBesetzt(G('mk-add'));
  try {
    const d = await api('POST', '/v1/wanted', {
      set_number: num,
      condition:  G('mk-cond')?.value || 'N',
      owner_user_id: selectedOwner('mk-owner'),
    });
    if (!d?.success) return;
    // „war schon drauf" ist keine Fehlermeldung, aber auch kein Neuzugang —
    // wer zweimal auf denselben Knopf drückt, soll den Unterschied sehen.
    toast(tRaw(d.war_neu ? 'wanted.added' : 'wanted.already'), 'ok');
    G('mk-num').value = '';
    await ladeMerkliste();
  } finally { frei(); }
}

/**
 * Aus dem Katalog-Detail — Marcos „inkl. Zustand und einem Preisalarm".
 *
 * Der Zustand kommt aus cat-m-cond, demselben Feld, das auch „In Galerie
 * aufnehmen" benutzt. Ein zweiter Zustandswähler nur für den Alarm wäre eine
 * Wahl, bei der man sich widersprechen kann.
 *
 * Der Alarm ist OPTIONAL: Ein Merkposten ohne Schwelle ist ein gültiger Merkposten.
 * Leer heisst „kein Alarm", nicht „Schwelle 0" — dieselbe Regel wie im
 * Set-Detail (07-admin.js).
 */
export async function katalogAufMerkliste() {
  const sn = G('cat-modal')?.dataset.setNumber;
  if (!sn) return;
  const zustand = G('cat-m-cond')?.value === 'U' ? 'U' : 'N';
  const owner   = selectedOwner('cat-m-owner');
  const frei = knopfBesetzt(G('cat-m-wish'));
  try {
    const d = await api('POST', '/v1/wanted',
      { set_number: sn, condition: zustand, owner_user_id: owner });
    if (!d?.success) return;

    // Der Alarm ist ein EIGENER Aufruf und nicht Teil des Merkpostens: Er lebt
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
    toast(tRaw(d.war_neu ? 'wanted.added' : 'wanted.already'), 'ok');
  } finally { frei(); }
}

/** setNumber|condition|user_id — der Schlüssel einer Zeile, wie ihn zeile() baut. */
function zerlege(arg) {
  const [set_number, condition, owner] = String(arg || '').split('|');
  return { set_number, condition, owner_user_id: parseInt(owner) };
}

export async function merkpostenLoeschen(arg) {
  const { set_number, condition, owner_user_id } = zerlege(arg);
  if (!set_number) return;
  const p = new URLSearchParams({ owner_user_id: String(owner_user_id) });
  const d = await api('DELETE',
    `/v1/wanted/${encodeURIComponent(set_number)}/${encodeURIComponent(condition)}?${p}`);
  if (d?.success) { toast(tRaw('wanted.deleted'), 'ok'); await ladeMerkliste(); }
}

/**
 * In die Galerie übernehmen — Schritt 1: fragen.
 *
 * Marcos Nachtrag: „gewisse Inhalte wie zB. Preis und Zustand, Anzahl müssen
 * beim Übernehmen angepasst werden." Vorher ging die Übernahme wortlos mit
 * Anzahl 1, ohne Kaufpreis und im Zustand des Merkpostens durch — für ein Set,
 * das man gerade gekauft hat, ist keins davon zuverlässig richtig.
 *
 * Der Zustand ist mit dem des MERKPOSTENS vorbelegt, weil das der häufigste
 * Fall ist; änderbar, weil der zweithäufigste ist, dass man etwas anderes
 * gefunden hat.
 */
export function merkpostenUebernehmen(arg) {
  const { set_number, condition } = zerlege(arg);
  if (!set_number) return;
  _uebernahme = arg;
  const w = _merkposten.find(x => x.set_number === set_number && x.condition === condition);
  G('mk-take-tit').textContent = w?.name || set_number;
  G('mk-take-qty').value   = '1';
  G('mk-take-price').value = '';
  G('mk-take-cond').value  = condition === 'U' ? 'U' : 'N';
  G('mk-take-modal').classList.add('open');
}

export function schliesseUebernahme() {
  G('mk-take-modal').classList.remove('open');
  _uebernahme = null;
}

/**
 * Schritt 2: tun.
 *
 * Die Regel steht am Server (utils/merkliste.ts): Er ruft addSet() — die
 * eine Wahrheit fürs Erfassen — und räumt danach Eintrag UND Preisalarm weg.
 *
 * Der ZUSTAND geht zweimal mit, und das ist Absicht: Im Pfad steht der des
 * Merkpostens (die Zeile, die verschwindet), im Rumpf der, in dem erfasst wird.
 * Sie fallen auseinander, sobald jemand etwas anderes kauft, als er sich
 * gewünscht hat.
 *
 * Danach werden Galerie und Kennzahlen neu geladen: Das Set ist jetzt dort,
 * und wer hinüberwechselt, soll es sehen und nicht eine Ansicht von vorhin.
 */
export async function bestaetigeUebernahme() {
  if (!_uebernahme) return;
  const { set_number, condition, owner_user_id } = zerlege(_uebernahme);
  const roh = (G('mk-take-price').value || '').trim();
  const preis = parseFloat(roh.replace(',', '.'));
  const frei = knopfBesetzt(G('mk-take-ok'));
  try {
    const d = await api('POST',
      `/v1/wanted/${encodeURIComponent(set_number)}/${encodeURIComponent(condition)}/uebernehmen`,
      {
        owner_user_id,
        quantity:  parseInt(G('mk-take-qty').value) || 1,
        // Leer heisst „kein Kaufpreis" — der Server setzt dann den
        // Marktpreis ein, genau wie auf dem normalen Erfassungsweg.
        purchase_price: roh && !isNaN(preis) ? preis : undefined,
        condition: G('mk-take-cond').value,
      });
    if (!d?.success) return;
    schliesseUebernahme();
    // 'exists' heisst: Das Set war schon im Blickfeld. Der Merkposten ist
    // trotzdem erfüllt und verschwindet — er stünde sonst für etwas, das man
    // längst hat.
    toast(tRaw(d.action === 'exists' ? 'wanted.taken_existing' : 'wanted.taken'), 'ok');
    await ladeMerkliste();
    await loadGallery();
    await loadStats();
  } finally { frei(); }
}

/**
 * Das Detail eines Merkpostens.
 *
 * ── Woher die Angaben kommen ────────────────────────────────────────────────
 *
 * Aus DREI Quellen, und keine davon ist neu:
 *
 *   * die Zeile selbst (Zustand, Notiz, Alarm, auf der Liste seit) — sie
 *     liegt bereits geladen vor, GET /wanted bringt alles mit;
 *   * /catalog/sets/:sn für Thema, Teile, Minifiguren und die
 *     BrickLink-Adresse — derselbe Aufruf, den das Katalog-Detail macht;
 *   * /sets/:sn/price-history für Marktpreis UND Verlauf.
 *
 * Der dritte ist der interessante: Er verlangt KEINEN Besitz (die Route ruft
 * getSetPriceHistory ohne Besitzprüfung, und price_cache/price_history hängen
 * am Set, nicht am Konto). /sets/:sn/price dagegen antwortet mit 404, wenn
 * einem das Set nicht gehört — für einen Merkposten also unbrauchbar. Nachgesehen,
 * nicht vermutet.
 *
 * Damit braucht dieses Detail keinen einzigen neuen Endpunkt, und gezeichnet
 * wird es von denselben Funktionen wie der Set-Dialog.
 */
export async function oeffneMerkpostenDetail(arg) {
  const { set_number, condition } = zerlege(arg);
  const w = _merkposten.find(x => x.set_number === set_number && x.condition === condition);
  if (!w) return;
  _detail = arg;

  G('mk-m-tit').textContent = w.name || w.set_number;
  G('mk-m-sub').textContent = [w.set_number, zustandText(w.condition)].join(' · ');
  // Volle Aufloesung, aber ebenfalls ueber den eigenen Server: fullUrl()
  // schickt eine absolute CDN-Adresse durch den Bild-Proxy (01-core.js).
  // Das lokale Bild hat Vorrang — es liegt schon da.
  const bild = (w.image_local || w.image_url)
    ? fullUrl(w.image_local || w.image_url) : '/assets/set-placeholder.svg';
  G('mk-m-img').src = bild;
  G('mk-m-img').dataset.orig = bild;
  G('mk-m-sparkline-content').innerHTML =
    `<span style="color:var(--mut);font-size:.78rem">${esc(tRaw('common.loading'))}</span>`;
  G('mk-m-market-rows').innerHTML = '';
  G('mk-m-det').innerHTML = zeilen(w);
  G('mk-m-bricklink').style.display = 'none';
  // Der Preisvergleich ist SOFORT da: Er hängt am Merkposten, nicht am Katalog
  // (utils/merkliste.ts). Ein Set, das rb_sets nicht kennt, beantwortet
  // /catalog/sets/:nr mit 404 — dann blieb dieser Knopf aus, obwohl die
  // Adresse aus der Setnummer allein zu bilden ist.
  zeigeAdresse('mk-m-vergleich', w.preisvergleich_url);
  G('mk-detail-modal').classList.add('open');
  // Ab hier meinen die Alarm-Handler DIESEN Dialog.
  setzeAlarmFeld('mk-m');
  ladeAlarm(set_number).catch(() => {});

  // ── Der Preis, SOFORT ─────────────────────────────────────────────────
  //
  // Marcos Frage: „Wieso werden die Preise nicht sofort angezeigt?" Weil
  // /price-history nur den Cache LIEST und in den bis zu dieser Änderung
  // niemand für Merkposten schrieb. Diese Route holt ihn (mit TTL, also nicht
  // bei jedem Öffnen neu) und füllt den Cache gleich mit.
  api('GET', `/v1/wanted/${encodeURIComponent(set_number)}/preise`).then(pr => {
    if (_detail !== arg || !pr?.success) return;
    // Dieselbe Form wie `current` in /price-history — deshalb genügt hier
    // dieselbe Zeichenfunktion.
    renderMarketRows({ by_condition: umAufAnzeige(pr.current) }, 'mk-m-market-rows');
  }).catch(() => {});

  // Katalog: Thema, Teile, Minifiguren, BrickLink. Schlägt er fehl (ein Set,
  // das rb_sets nicht kennt), bleibt der Block stehen, wie er ist — die
  // Angaben aus der Zeile sind dann alles, was es gibt.
  api('GET', `/v1/catalog/sets/${encodeURIComponent(set_number)}`).then(d => {
    if (_detail !== arg || !d?.success) return;
    katalogNachtragen(d.set, w);
    zeigeAdresse('mk-m-bricklink', d.set?.bricklink?.url);
    // Mit dem Katalognamen wird die Suche besser („LEGO 75192 Millennium
    // Falcon" statt nur der Nummer) — aber nur, wenn wirklich einer kam.
    zeigeAdresse('mk-m-vergleich', d.set?.preisvergleich_url || w.preisvergleich_url);
  }).catch(() => {});

  // Der VERLAUF — die Zeilen darüber stehen da schon. Er kommt aus
  // price_history, das der stündliche Preislauf füllt; für einen Merkposten seit
  // dieser Änderung ebenfalls (jobs/priceJob.ts). Ein frischer Merkposten hat
  // deshalb erst einen Punkt, und eine Linie braucht zwei — das ist kein
  // Fehler, sondern der Anfang.
  api('GET', `/v1/sets/${encodeURIComponent(set_number)}/price-history`).then(ph => {
    if (_detail !== arg) return;
    G('mk-m-sparkline-content').innerHTML = ph?.success
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
    ['detail.theme',    STRICH, 'mk-m-theme'],
    ['detail.pieces',   zahl(w.num_parts), 'mk-m-pieces'],
    ['detail.minifigs', STRICH, 'mk-m-minifigs'],
    ['common.condition', esc(zustandText(w.condition)), null],
    ['household.for_account', inhaberWahl(w), null],
    ['wanted.since',  w.created_at ? `📅 ${esc(new Date(w.created_at).toLocaleDateString(locale()))}` : STRICH, null],
    // Derselbe Block wie im Set-Dialog, nicht ein zweiter: Es ist derselbe
    // Eintrag in price_alerts, am selben Schlüssel (Konto, Set, Zustand).
    // Gefüllt wird er von ladeAlarm() beim Öffnen.
    ['detail.alert',    alarmBlock(w.set_number, 'mk-m'), null],
  ].map(([k, v, id]) => detailZeile(t(k), v, id ? { wertId: id } : {})).join('');
}

/**
 * Der Inhaber — als AUSWAHLFELD, nicht als Text.
 *
 * ── Marcos Befund ──────────────────────────────────────────────────────────
 *
 * „Auf dem Detail-Dialog der Merkliste kann der Inhaber nicht geändert
 * werden." Wählbar war er nur beim Erfassen; wer sich vertippt hatte, musste
 * löschen und neu anlegen — und verlor dabei Preisalarm und Aufnahmedatum.
 *
 * Bei EINEM Konto bleibt die Zeile leer: „gehört mir" an jeder Zeile ist
 * keine Auskunft. Dieselbe Regel wie bei den Erfassungsmasken
 * (02-gallery.js: `if (members.length < 2)`).
 */
function inhaberWahl(w) {
  const konten = haushaltsKonten();
  if (konten.length < 2) return '';
  return `<select id="mk-m-owner" class="alarm-feld"
                  data-change="merkpostenInhaberGewaehlt" data-arg="${escJs(`${w.set_number}|${w.condition}|${w.user_id}`)}">`
    + konten.map(k => `<option value="${k.id}"${k.id === w.user_id ? ' selected' : ''}>`
                    + `${esc(k.username)}${k.is_self ? ' (ich)' : ''}</option>`).join('')
    + '</select>';
}

/**
 * Den Merkposten einem anderen Konto geben.
 *
 * Der Schlüssel im data-arg trägt den ALTEN Inhaber — der Server muss wissen,
 * WOHER er umhängt, und die Auswahl kennt nur das Ziel.
 */
export async function merkpostenInhaberGewaehlt(arg) {
  const { set_number, condition, owner_user_id } = zerlege(arg);
  const sel = G('mk-m-owner');
  const neu = parseInt(sel?.value || '');
  if (!Number.isFinite(neu) || neu === owner_user_id) return;
  const d = await api('PUT',
    `/v1/wanted/${encodeURIComponent(set_number)}/${encodeURIComponent(condition)}/inhaber`,
    { owner_user_id, neuer_inhaber: neu });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  // „stand dort schon" ist kein Fehler, aber auch kein Umzug — wie beim
  // Eintragen unterscheidet die Meldung die beiden Fälle.
  // settings.saved statt eines neuen Textes: „Gespeichert" steht schon in der
  // Sprachdatei, und zwei gleichlautende Eintraege laufen beim naechsten
  // Feinschliff auseinander.
  toast(tRaw(d.zusammengefuehrt ? 'wanted.already' : 'settings.saved'), 'ok');
  await ladeMerkliste();
  // Das Detail hängt am alten Schlüssel (er trägt den Inhaber) — mit dem
  // neuen wieder öffnen, sonst zeigt es einen Eintrag, den es so nicht mehr
  // gibt.
  if (d.zusammengefuehrt) schliesseMerkpostenDetail();
  else await oeffneMerkpostenDetail(`${set_number}|${condition}|${neu}`);
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
  setze('mk-m-theme',    katalog?.theme_name || STRICH);
  setze('mk-m-pieces',   zahl(katalog?.num_parts ?? w.num_parts));
  setze('mk-m-minifigs', zahl(katalog?.minifigs));
}

export function schliesseMerkpostenDetail() {
  G('mk-detail-modal').classList.remove('open');
  _detail = null;
}

/** Löschen und Übernehmen aus dem Detail — dieselben Wege wie aus der Liste. */
export async function merkpostenDetailLoeschen() {
  const arg = _detail;
  if (!arg) return;
  schliesseMerkpostenDetail();
  await merkpostenLoeschen(arg);
}

export function merkpostenDetailUebernehmen() {
  const arg = _detail;
  if (!arg) return;
  schliesseMerkpostenDetail();
  merkpostenUebernehmen(arg);
}

registerActions({ merkpostenHinzufuegen, katalogAufMerkliste, merkpostenLoeschen,
                  merkpostenUebernehmen, schliesseUebernahme, bestaetigeUebernahme,
                  oeffneMerkpostenDetail, schliesseMerkpostenDetail,
                  merkpostenDetailLoeschen, merkpostenDetailUebernehmen,
                  merkpostenInhaberGewaehlt });

/**
 * `current` aus der Preis-Antwort in die Form, die renderMarketRows() liest.
 *
 * Die Zeichenfunktion erwartet `by_condition[c].market_price`; die
 * Preisantwort nennt es `avg_price` — dieselbe Zahl, anderer Name, weil die
 * eine aus dem Cache und die andere aus der Verlaufsrechnung kommt. Eine
 * Umbenennung am Server hiesse, an drei Stellen gleichzeitig zu ändern.
 *
 * `pnl_pct` bleibt leer: Es ist Gewinn gegen den Kaufpreis, und den hat ein
 * Merkposten nicht.
 */
function umAufAnzeige(current) {
  const raus = {};
  for (const c of ['N', 'U']) {
    const d = current?.[c];
    if (d) raus[c] = { market_price: d.avg_price, pnl_pct: null };
  }
  return raus;
}
