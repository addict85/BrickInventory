import { echt, registerActions } from './registry.js';
import { locale, t, tRaw } from '../i18n.js';
import { esc, html, ungeprueft, verbinde } from './escapen.js';
import { api } from './api.js';
import { bildTag, platzhalterInhalt, fullUrl, imgUrl, thumbUrl, setzeDialogbild } from './bilder.js';
import {
  leerZustand,
  meldeTreffer,
  ico,
  G,
  TRASH_ICON_SVG,
  knopfBesetzt,
  zuruecksetzenKnopf,
  setzeHtml,
} from './dom.js';
import { fmtDatum, fmtN, leseBetrag } from './format.js';
import { setnummerFeldGueltig, betragAusFeld, mengeAusFeld } from './formular.js';
import { toast } from './meldungen.js';
import { detailZeile, kachelName, listeLadefehler, skelettZeilen, csvHochladen } from './bausteine.js';
import { loadGallery, loadStats } from './gallery.js';
import { addScopeParam } from './scope.js';
import { CURRENCY } from './zustand.js';
import { alarmBlock, ladeAlarm, setzeAlarmFeld } from './detailfelder.js';
import { diagrammBreite, priceChartSVG, renderMarketRows } from './diagramme.js';
import { leereLagerortFeld, selectedOwner, selectedStorage, haushaltsKonten } from './konten-orte.js';

// Was man haben möchte, getrennt vom Besitz, deshalb eine eigene Tabelle: In `sets` zählte ein Merkposten in
// Galerie, Teilen, Portfolio und Finanzen mit, und jede Ansicht bräuchte einen Filter.

/** Die zuletzt geladene Liste — für die Knöpfe, die auf eine Zeile zeigen. */
/** @typedef {import('../../frontend-typen/vertrag').Merkposten} Merkposten */
/** @type {Merkposten[]} */
let _merkposten = [];

/** Der Eintrag, ueber den der Uebernahme-Dialog gerade steht. */
/** @type {string | null} */
let _uebernahme = null;

/**
 * Der Eintrag, dessen Detail offen ist.
 * @type {string | null}
 */
let _detail = null;

/**
 * @param {string} c
 */
function zustandText(c) {
  return t(c === 'U' ? 'common.condition_used' : 'common.condition_new');
}

/**
 * Eine Zeile.
 *
 * Bewusst eine LISTE und keine Kachelwand wie die Galerie: Eine Merkliste wird gelesen und abgearbeitet,
 * nicht bewundert. Die Notiz („Geschenk Enkel") ist dabei so wichtig wie das Bild und hätte auf einer Kachel
 * keinen Platz.
 */
/** @param {Merkposten} w */
function zeile(w) {
  // Bild über imgUrl(), nicht thumbUrl() allein: thumbUrl() reicht fremde Adressen unverändert durch, der
  // Browser rief das CDN direkt, und die Sicherheitsrichtlinie blockte es.
  const roh = w.image_local || w.image_url;
  const bild = roh
    ? bildTag({ src: imgUrl(thumbUrl(roh) || roh, 'nur'), alt: '', klasse: 'bild-56', ph: 'set' })
    : html`<span class="bild-ph bild-56" aria-hidden="true">${platzhalterInhalt('set')}</span>`;

  // Kein Name heisst: rb_sets kennt das Set nicht. Der benannte Preis dafür, dass hier keine zweite Kopie der
  // Stammdaten liegt (siehe 0021) — sichtbar und harmlos, statt eines Namens aus einer Quelle, die niemand
  // nachführt.
  const titel = w.name ? esc(w.name) : esc(w.set_number);
  // Ohne Namen steht die Nummer schon als Titel — nicht noch einmal darunter.
  const unter = [
    w.name ? esc(w.set_number) : esc(tRaw('wanted.unbekannt_kurz')),
    w.year ? String(w.year) : null,
    zustandText(w.condition),
  ]
    .filter(Boolean)
    .join(' · ');

  const alarm = w.alarm
    ? html`<span class="mk-etikett">
         ${ico(w.alarm.ausgeloest ? 'alarm' : 'uhr')}
         ${tRaw(w.alarm.richtung === 'ueber' ? 'detail.alert_above' : 'detail.alert_below')}
         ${fmtN(Number(w.alarm.schwelle), CURRENCY)}
       </span>`
    : '';

  // „Habe ich das inzwischen?" ist die Frage, die in der Liste sofort aufkommt — und sie meint das BLICKFELD:
  // Beim Grossvater heisst „ich habe es" auch „der Enkel hat es".
  const schon = w.owned ? html`<span class="mk-etikett mk-etikett-ok">${tRaw('wanted.owned')}</span>` : '';

  // In der Zeile steht der Marktpreis, nicht „In die Galerie“: Übernehmen gibt es weiter im Detail, wo
  // Anzahl, Preis und Zustand ohnehin abgefragt werden.
  const preis =
    w.marktpreis != null
      ? html`<span title="${tRaw('detail.market_price')}" class="preis mk-preis">${fmtN(w.marktpreis, w.waehrung || CURRENCY)}</span>`
      : html`<span class="mk-preis text-mut mk-preis-offen" title="${tRaw('wanted.preis_offen_hint')}">${tRaw('wanted.preis_offen')}</span>`;

  const arg = `${w.set_number}|${w.condition}|${w.user_id}`;
  const k = kachelName(2);
  // Die ganze Zeile öffnet das Detail; der Papierkorb oben rechts hält seinen Klick an, wie auf der Set-Kachel.
  // Kein HTML-Kommentar im Template: Er landete in jedem DOM.
  return html`
    <div class="mk-zeile" tabindex="0" role="button"${k.attr} aria-keyshortcuts="Delete" data-click="oeffneMerkpostenDetail" data-arg="${arg}">
      <div class="ca"><span class="delbtn" data-click="merkpostenLoeschenStop"${echt()} aria-hidden="true" data-arg="${arg}"
           title="${tRaw('wanted.remove')}">${TRASH_ICON_SVG}</span></div>
      ${bild}
      <div class="mk-text">
        <div class="mk-titel">${ungeprueft(titel)}</div>
        <div class="mk-unter"${k.teil(0)}>${ungeprueft(unter)}</div>
      </div>
      <div class="mk-rechts"${k.teil(1)}>
        ${alarm}${schon}${preis}
      </div>
    </div>`;
}

/**
 * Suche, Zustand, Sortierung und Inhaber als Anfrageparameter, in derselben Form wie galleryParams() — ohne
 * Seite (die Liste blättert nicht) und ohne Lagerort (ein Merkposten liegt nirgends). Gefiltert wird am
 * Server.
 */
function merklisteParams() {
  const p = new URLSearchParams();
  const q = G('mks')?.value?.trim();
  if (q) p.set('search', q);
  const c = G('mkcond')?.value;
  if (c) p.set('condition', c);
  const so = G('mksort')?.value;
  if (so) p.set('sort', so);
  addScopeParam(p, 'merkliste');
  return p.toString();
}

/** Suche und Zustand leeren; die Sortierung ist kein Filter und bleibt. */
export function merklisteZuruecksetzen() {
  if (G('mks')) G('mks').value = '';
  if (G('mkcond')) G('mkcond').value = '';
  ladeMerkliste();
}

/** Die Liste laden und zeichnen. */
export async function ladeMerkliste() {
  const ziel = G('mk-list');
  if (!ziel) return;
  // Das Fragezeichen steht HIER und nicht in merklisteParams(): Dieselbe Schreibweise wie bei der Galerie,
  // und test/frontend-api-paths.test.js liest den Pfad aus genau dieser Zeile — mit dem Fragezeichen im
  // Rueckgabe-wert las sie „/v1/wanted:x" und meldete eine Route, die es nicht gibt.
  // Ein Fehlerzustand trägt auch .leer; er weicht dem Gerüst, sonst sähe der neue Versuch wie der alte Fehler aus.
  if (!_merkposten.length && !ziel.querySelector('.mk-zeile, .leer:not(.fehler-zustand)'))
    setzeHtml(ziel, skelettZeilen(4, tRaw('common.loading')));
  const d = await api('GET', `/v1/wanted?${merklisteParams()}`);
  const kasten = /** @type {HTMLDetailsElement | null} */ (document.getElementById('mk-kasten'));
  if (listeLadefehler(ziel, d, { erneut: 'ladeMerkliste', behalten: _merkposten.length > 0 })) {
    // Das offene Formular schob die Fehlermeldung unter die Falz.
    if (kasten && !kasten.dataset.entschieden) kasten.open = false;
    return;
  }
  _merkposten = d.merkposten || [];
  // Einmal je Laden der Seite: Am Telefon mit Einträgen zugeklappt, damit die Liste im ersten Bild steht;
  // danach bleibt, was der Nutzer gewählt hat.
  if (kasten && !kasten.dataset.entschieden) {
    kasten.dataset.entschieden = '1';
    kasten.open = !(_merkposten.length && window.matchMedia?.('(max-width: 640px)').matches);
  }
  // Zwei Leermeldungen: „Noch keine Merkposten“ sagt etwas über die Liste, „Nichts gefunden“ über den Filter
  // — sonst sähe eine erfolglose Suche wie eine geleerte Liste aus. Die Sortierung zählt nicht als Filter.
  const filter = new URLSearchParams(merklisteParams());
  filter.delete('sort');
  const gefiltert = !!filter.toString();
  if (gefiltert)
    meldeTreffer(
      _merkposten.length
        ? tRaw('treffer.merkliste', { n: _merkposten.length })
        : G('mks')?.value.trim()
          ? tRaw('common.no_hits', { query: G('mks').value.trim() })
          : tRaw('wanted.no_results'),
    );
  setzeHtml(
    ziel,
    _merkposten.length
      ? verbinde(_merkposten.map(zeile))
      : gefiltert
        ? leerZustand({
            ico: 'suche',
            titel: G('mks')?.value.trim()
              ? tRaw('common.no_hits', { query: G('mks').value.trim() })
              : tRaw('wanted.no_results'),
            knopf: zuruecksetzenKnopf('merkliste'),
          })
        : leerZustand({
            ico: 'merkliste',
            titel: tRaw('wanted.empty'),
            text: tRaw('wanted.empty_hint'),
            knopf: { text: tRaw('wanted.erster'), click: 'feldFokussieren', arg: 'mk-num', art: 'bs' },
          }),
  );
}

/**
 * Aus dem Formular des Reiters — „analog den Sets": dieselben Felder in derselben Reihenfolge wie im
 * Galerie-Kasten.
 */
export async function merkpostenHinzufuegen() {
  const num = (G('mk-num')?.value || '').trim();
  if (!setnummerFeldGueltig('mk-num', num)) return;
  const frei = knopfBesetzt(G('mk-add'));
  try {
    const d = await api('POST', '/v1/wanted', {
      set_number: num,
      condition: G('mk-cond')?.value || 'N',
      owner_user_id: selectedOwner('mk-owner'),
    });
    if (!d?.success) {
      toast(d?.error || tRaw('settings.error'), 'error');
      return;
    }
    // „war schon drauf" ist keine Fehlermeldung, aber auch kein Neuzugang — wer zweimal auf denselben Knopf
    // drückt, soll den Unterschied sehen.
    await merkMeldung(d.war_neu, num);
    G('mk-num').value = '';
    await ladeMerkliste();
  } finally {
    frei();
  }
}

/**
 * Aus dem Katalog-Detail auf die Merkliste, mit Zustand aus cat-m-cond (ein zweiter Wähler könnte
 * widersprechen). Der Alarm ist freiwillig; leer heisst kein Alarm, nicht Schwelle 0.
 */
export async function katalogAufMerkliste() {
  const sn = G('cat-modal')?.dataset.setNumber;
  if (!sn) return;
  const zustand = G('cat-m-cond')?.value === 'U' ? 'U' : 'N';
  const owner = selectedOwner('cat-m-owner');
  const frei = knopfBesetzt(G('cat-m-wish'));
  try {
    const d = await api('POST', '/v1/wanted', { set_number: sn, condition: zustand, owner_user_id: owner });
    if (!d?.success) return;

    // Der Alarm ist ein EIGENER Aufruf und nicht Teil des Merkpostens: Er lebt in price_alerts, gehört
    // demselben Schlüssel und ist genau derselbe Alarm, den das Set-Detail setzt. Ein zweiter Weg, eine
    // Schwelle zu speichern, wäre eine zweite Wahrheit.
    const schwelle = leseBetrag(G('cat-m-alert-val')?.value);
    if (schwelle != null && schwelle > 0) {
      await api('PUT', `/v1/sets/${encodeURIComponent(sn)}/alert`, {
        richtung: G('cat-m-alert-dir')?.value || 'unter',
        schwelle,
        condition: zustand,
      }).catch(() => null);
    }
    await merkMeldung(d.war_neu, sn);
  } finally {
    frei();
  }
}

/**
 * Rückmeldung nach dem Merken. Steht das Set schon in der Sammlung, sagt es der Toast: Das Abzeichen
 * „schon vorhanden“ sah man erst in der Liste.
 * @param {boolean | undefined} neu @param {string} num
 */
async function merkMeldung(neu, num) {
  const nr = /-\d+$/.test(num) ? num : num + '-1';
  const eigen = neu ? await api('GET', `/v1/sets/${encodeURIComponent(nr)}`).catch(() => null) : null;
  const vorhanden = eigen?.success && eigen.set ? eigen.set : null;
  toast(
    vorhanden
      ? tRaw('wanted.added_schon_da', { n: vorhanden.quantity || 1 })
      : tRaw(neu ? 'wanted.added' : 'wanted.already'),
    'success',
  );
}

/** setNumber|condition|user_id — der Schlüssel einer Zeile, wie ihn zeile() baut. */
/** @param {string | null | undefined} arg */
function zerlege(arg) {
  const [set_number, condition, owner] = String(arg || '').split('|');
  return { set_number, condition, owner_user_id: parseInt(owner, 10) };
}

/** @param {string} arg */
export async function merkpostenLoeschen(arg) {
  const { set_number, condition, owner_user_id } = zerlege(arg);
  if (!set_number) return;
  const p = new URLSearchParams({ owner_user_id: String(owner_user_id) });
  const d = await api('DELETE', `/v1/wanted/${encodeURIComponent(set_number)}/${encodeURIComponent(condition)}?${p}`);
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  // Rückgängig legt den Posten neu an; er hat ausser Nummer, Zustand und Inhaber nichts Eigenes.
  toast(tRaw('wanted.deleted'), 'success', {
    text: tRaw('trash.undo'),
    bleibt: true,
    fn: async () => {
      const r = await api('POST', '/v1/wanted', { set_number, condition, owner_user_id });
      if (!r?.success) {
        toast(r?.error || tRaw('settings.error'), 'error');
        return;
      }
      toast(tRaw('trash.restored'), 'success');
      await ladeMerkliste();
    },
  });
  await ladeMerkliste();
}

/**
 * In die Galerie übernehmen, Schritt 1: fragen. Anzahl, Kaufpreis und Zustand sind beim Kauf selten die des
 * Merkpostens; der Zustand ist vorbelegt, bleibt aber änderbar.
 */
/** @param {string} arg */
export function merkpostenUebernehmen(arg) {
  const { set_number, condition } = zerlege(arg);
  if (!set_number) return;
  _uebernahme = arg;
  const w = _merkposten.find(x => x.set_number === set_number && x.condition === condition);
  G('mk-take-tit').textContent = w?.name || set_number;
  G('mk-take-qty').value = '1';
  G('mk-take-price').value = '';
  G('mk-take-cond').value = condition === 'U' ? 'U' : 'N';
  leereLagerortFeld('mk-take-storage');
  G('mk-take-modal').classList.add('open');
}

export function schliesseUebernahme() {
  G('mk-take-modal').classList.remove('open');
  _uebernahme = null;
}

/**
 * Schritt 2: tun. Die Regel liegt am Server (addSet, dann Merkposten und Alarm weg). Der Zustand geht zweimal
 * mit — im Pfad der des Merkpostens, im Rumpf der erfasste —, weil man anderes kaufen kann als gewünscht.
 */
export async function bestaetigeUebernahme() {
  if (!_uebernahme) return;
  const { set_number, condition, owner_user_id } = zerlege(_uebernahme);
  const preis = betragAusFeld('mk-take-price');
  const menge = mengeAusFeld('mk-take-qty');
  if (!preis.ok || !menge.ok) return;
  const frei = knopfBesetzt(G('mk-take-ok'));
  try {
    const d = await api(
      'POST',
      `/v1/wanted/${encodeURIComponent(set_number)}/${encodeURIComponent(condition)}/uebernehmen`,
      {
        owner_user_id,
        quantity: menge.wert,
        // Leer heisst „kein Kaufpreis" — der Server setzt dann den Marktpreis ein, genau wie auf dem normalen
        // Erfassungsweg.
        purchase_price: preis.wert ?? undefined,
        condition: G('mk-take-cond').value,
        storage: selectedStorage('mk-take-storage'),
      },
    );
    if (!d?.success) return;
    schliesseUebernahme();
    // 'exists' heisst: Das Set war schon im Blickfeld. Der Merkposten ist trotzdem erfüllt und verschwindet —
    // er stünde sonst für etwas, das man längst hat.
    toast(tRaw(d.action === 'exists' ? 'wanted.taken_existing' : 'wanted.taken'), 'success');
    await ladeMerkliste();
    await loadGallery();
    await loadStats();
  } finally {
    frei();
  }
}

/**
 * Das Detail eines Merkpostens aus drei bestehenden Quellen: der geladenen Zeile, dem Katalog-Detail und dem
 * Preisverlauf. Kein neuer Endpunkt, damit die Angaben dieselben sind wie an den anderen Stellen.
 * @param {string} arg
 */
export async function oeffneMerkpostenDetail(arg) {
  const { set_number, condition } = zerlege(arg);
  const w = _merkposten.find(x => x.set_number === set_number && x.condition === condition);
  if (!w) return;
  _detail = arg;

  G('mk-m-tit').textContent = w.name || w.set_number;
  // Ohne Namen steht die Nummer schon im Titel.
  G('mk-m-sub').textContent = [w.name ? w.set_number : '', zustandText(w.condition)].filter(Boolean).join(' · ');
  // Volle Aufloesung, aber ebenfalls ueber den eigenen Server: fullUrl() schickt eine absolute CDN-Adresse
  // durch den Bild-Proxy (bilder.js). Das lokale Bild hat Vorrang — es liegt schon da.
  const bild = w.image_local || w.image_url ? fullUrl(w.image_local || w.image_url) : '/assets/set-placeholder.svg';
  setzeDialogbild(G('mk-m-img'), bild, bild);
  setzeHtml(G('mk-m-sparkline-content'), html`<span class="text-mut schrift-1">${tRaw('common.loading')}</span>`);
  G('mk-m-market-rows').replaceChildren();
  setzeHtml(G('mk-m-det'), ungeprueft(zeilen(w)));
  G('mk-m-bricklink').style.display = 'none';
  // Der Preisvergleich ist SOFORT da: Er hängt am Merkposten, nicht am Katalog (src/merkliste/merkliste.ts).
  // Ein Set, das rb_sets nicht kennt, beantwortet /catalog/sets/:nr mit 404 — dann blieb dieser Knopf aus,
  // obwohl die Adresse aus der Setnummer allein zu bilden ist.
  zeigeAdresse('mk-m-vergleich', w.preisvergleich_url);
  document.querySelector('#mk-detail-modal .mehr-menue')?.removeAttribute('open');
  G('mk-detail-modal').classList.add('open');
  // Ab hier meinen die Alarm-Handler DIESEN Dialog.
  setzeAlarmFeld('mk-m');
  ladeAlarm(set_number).catch(() => {});

  // ── Der Preis, SOFORT ─────────────────────────────────────────────────
  //
  // Marcos Frage: „Wieso werden die Preise nicht sofort angezeigt?" Weil /price-history nur den Cache LIEST
  // und in den bis zu dieser Änderung niemand für Merkposten schrieb. Diese Route holt ihn (mit TTL, also
  // nicht bei jedem Öffnen neu) und füllt den Cache gleich mit.
  api('GET', `/v1/wanted/${encodeURIComponent(set_number)}/preise`)
    .then(pr => {
      if (_detail !== arg || !pr?.success) return;
      // Dieselbe Form wie `current` in /price-history — deshalb genügt hier dieselbe Zeichenfunktion.
      renderMarketRows({ by_condition: umAufAnzeige(pr.current) }, 'mk-m-market-rows');
    })
    .catch(() => {});

  // Katalog: Thema, Teile, Minifiguren, BrickLink. Schlägt er fehl (ein Set, das rb_sets nicht kennt), bleibt
  // der Block stehen, wie er ist — die Angaben aus der Zeile sind dann alles, was es gibt.
  // Ohne Namen kennt der Katalog das Set nicht (siehe zeile()); die Anfrage endete nur mit einer 404 in der
  // Konsole.
  if (w.name)
    api('GET', `/v1/catalog/sets/${encodeURIComponent(set_number)}`)
      .then(d => {
        if (_detail !== arg || !d?.success) return;
        katalogNachtragen(d.set, w);
        zeigeAdresse('mk-m-bricklink', d.set?.bricklink?.url);
        // Mit dem Katalognamen wird die Suche besser („LEGO 75192 Millennium Falcon" statt nur der Nummer) — aber
        // nur, wenn wirklich einer kam.
        zeigeAdresse('mk-m-vergleich', d.set?.preisvergleich_url || w.preisvergleich_url);
      })
      .catch(() => {});

  // Der VERLAUF — die Zeilen darüber stehen da schon. Er kommt aus price_history, das der stündliche
  // Preislauf füllt; für einen Merkposten seit dieser Änderung ebenfalls (src/finanzen/preisLauf.ts). Ein frischer
  // Merkposten hat deshalb erst einen Punkt, und eine Linie braucht zwei — das ist kein Fehler, sondern der
  // Anfang.
  api('GET', `/v1/sets/${encodeURIComponent(set_number)}/price-history`)
    .then(ph => {
      if (_detail !== arg) return;
      setzeHtml(
        G('mk-m-sparkline-content'),
        ph?.success
          ? priceChartSVG(
              ph,
              'wl' + set_number.replace(/[^a-zA-Z0-9]/g, ''),
              diagrammBreite(G('mk-m-sparkline-content')),
            )
          : html`<span class="text-mut schrift-1">${tRaw(ph?.networkError ? 'chart.offline' : 'detail.no_history')}</span>`,
      );
    })
    .catch(() => {});
}

/**
 * Ein Knopf, der ins Leere führt, ist schlechter als keiner.
 * @param {string} id
 * @param {string | null | undefined} url
 */
function zeigeAdresse(id, url) {
  const el = G(id);
  if (!el) return;
  if (url) {
    el.href = url;
    el.style.display = '';
  } else {
    el.removeAttribute('href');
    el.style.display = 'none';
  }
}

const STRICH = '—';
const zahl = (/** @type {unknown} */ n) => (n == null ? STRICH : Number(n).toLocaleString(locale()));

/**
 * Die Zeilen wie im Set-Dialog, ohne was Besitz voraussetzt. Genau einmal je Öffnen gebaut, Katalogangaben
 * werden an Ort und Stelle nachgetragen: Neu gezeichnet verlor der Alarm eine laufende Eingabe.
 */
/** @param {Merkposten} w */
function zeilen(w) {
  // Kennt der Katalog das Set nicht, sagt eine Zeile das, statt vier Striche bei Jahr, Thema, Teilen, Figuren.
  /** @type {[string, string | import('./escapen.js').SicheresHtml, string | null][]} */
  const katalog = w.name
    ? [
        ['detail.year', w.year != null ? String(w.year) : STRICH, null],
        ['detail.theme', STRICH, 'mk-m-theme'],
        ['detail.pieces', zahl(w.num_parts), 'mk-m-pieces'],
        ['detail.minifigs', STRICH, 'mk-m-minifigs'],
      ]
    : [['nav.catalog', esc(tRaw('wanted.unbekannt')), null]];
  /** @type {[string, string | import('./escapen.js').SicheresHtml, string | null][]} */
  const z = [
    ...katalog,
    ['common.condition', esc(zustandText(w.condition)), null],
    ['household.for_account', inhaberWahl(w), null],
    ['wanted.since', w.created_at ? `${ico('kalender')} ${esc(fmtDatum(w.created_at))}` : STRICH, null],
    // Derselbe Block wie im Set-Dialog, nicht ein zweiter: Es ist derselbe Eintrag in price_alerts, am selben
    // Schlüssel (Konto, Set, Zustand). Gefüllt wird er von ladeAlarm() beim Öffnen.
    ['detail.alert', alarmBlock(w.set_number, 'mk-m'), null],
  ];
  return z.map(([k, v, id]) => detailZeile(t(k), v, id ? { wertId: id } : {})).join('');
}

/**
 * Der Inhaber als Auswahlfeld: Wer sich beim Erfassen vertan hatte, musste löschen und verlor Alarm und
 * Datum. Bei einem einzigen Konto bleibt die Zeile leer — wie bei den Erfassungsmasken.
 */
/** @param {Merkposten} w */
function inhaberWahl(w) {
  const konten = haushaltsKonten();
  if (konten.length < 2) return '';
  return html`${html`<select id="mk-m-owner" class="alarm-feld" aria-label="${tRaw('household.for_account')}"
                  data-change="merkpostenInhaberGewaehlt" data-arg="${`${w.set_number}|${w.condition}|${w.user_id}`}">`}${konten.map(k => html`${html`<option value="${k.id}"${k.id === w.user_id ? ' selected' : ''}>`}${html`${k.username}${k.is_self ? html`${' '}${tRaw('household.ich')}` : ''}</option>`}`)}${html`</select>`}`;
}

/**
 * Den Merkposten einem anderen Konto geben.
 *
 * Der Schlüssel im data-arg trägt den ALTEN Inhaber — der Server muss wissen, WOHER er umhängt, und die
 * Auswahl kennt nur das Ziel.
 */
/** @param {string} arg */
export async function merkpostenInhaberGewaehlt(arg) {
  const { set_number, condition, owner_user_id } = zerlege(arg);
  const sel = G('mk-m-owner');
  const neu = parseInt(sel?.value || '', 10);
  if (!Number.isFinite(neu) || neu === owner_user_id) return;
  const d = await api('PUT', `/v1/wanted/${encodeURIComponent(set_number)}/${encodeURIComponent(condition)}/inhaber`, {
    owner_user_id,
    neuer_inhaber: neu,
  });
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  // „stand dort schon" ist kein Fehler, aber auch kein Umzug — wie beim Eintragen unterscheidet die Meldung
  // die beiden Fälle. settings.saved statt eines neuen Textes: „Gespeichert" steht schon in der Sprachdatei,
  // und zwei gleichlautende Eintraege laufen beim naechsten Feinschliff auseinander.
  toast(tRaw(d.zusammengefuehrt ? 'wanted.already' : 'settings.saved'), 'success');
  await ladeMerkliste();
  // Das Detail hängt am alten Schlüssel (er trägt den Inhaber) — mit dem neuen wieder öffnen, sonst zeigt es
  // einen Eintrag, den es so nicht mehr gibt.
  if (d.zusammengefuehrt) schliesseMerkpostenDetail();
  else await oeffneMerkpostenDetail(`${set_number}|${condition}|${neu}`);
}

/**
 * Thema, Teile und Minifiguren nachtragen — als TEXT, nicht als neues Markup.
 *
 * textContent und nicht innerHTML: Der Themenname kommt aus dem Katalog und ist damit fremder Text. So kann
 * er gar nicht erst als Auszeichnung gelesen werden, und es braucht kein esc() an einer weiteren Stelle.
 */
/** @param {import('../../frontend-typen/vertrag').CatalogSetDetail | null | undefined} katalog @param {Merkposten} w */
function katalogNachtragen(katalog, w) {
  const setze = (/** @type {string} */ id, /** @type {string} */ wert) => {
    const el = G(id);
    if (el) el.textContent = wert;
  };
  setze('mk-m-theme', katalog?.theme_name || STRICH);
  setze('mk-m-pieces', zahl(katalog?.num_parts ?? w.num_parts));
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

// Suche entprellt (250 ms wie Galerie und Teile), sonst ein Abruf je Taste. Der Wächter `?.`, weil die Datei
// in den Tests auch ohne DOM geladen wird.
G('mks')?.addEventListener('input', () => {
  clearTimeout(G('mks')._t);
  G('mks')._t = setTimeout(ladeMerkliste, 250);
});

/**
 * Eine Merkliste aus einer CSV einlesen, wie importFigsCsv(): Beide werten dieselbe Serverantwort aus
 * (csvImportAntwort) und nutzen dieselben Texte — eine zweite Fassung derselben Aussage würde
 * auseinanderlaufen.
 */
async function importMerklisteCsv() {
  const owner = selectedOwner('mk-owner');
  const status = G('mk-status');
  const d = await csvHochladen({
    feld: 'mk-csv-file',
    pfad: '/v1/wanted/import/csv',
    felder: owner ? { owner_user_id: String(owner) } : {},
    zeige: l => {
      if (status) status.textContent = l ? tRaw('import.running') : '';
    },
  });
  if (d) ladeMerkliste();
}

registerActions({
  ladeMerkliste,
  merkpostenHinzufuegen,
  katalogAufMerkliste,
  merkpostenLoeschen,
  merkpostenUebernehmen,
  schliesseUebernahme,
  bestaetigeUebernahme,
  oeffneMerkpostenDetail,
  schliesseMerkpostenDetail,
  merkpostenDetailLoeschen,
  merkpostenDetailUebernehmen,
  merkpostenInhaberGewaehlt,
  importMerklisteCsv,
});

/**
 * `current` der Preisantwort in die Form von renderMarketRows() bringen: Dieselbe Zahl heisst dort
 * avg_price. pnl_pct bleibt leer, weil ein Merkposten keinen Kaufpreis hat.
 */
/** @param {import('../../frontend-typen/vertrag').CurrentByCondition | null | undefined} current */
function umAufAnzeige(current) {
  /** @type {Record<string, { market_price: number | null | undefined, pnl_pct: null }>} */
  const raus = {};
  for (const c of /** @type {const} */ (['N', 'U'])) {
    const d = current?.[c];
    if (d) raus[c] = { market_price: d.avg_price, pnl_pct: null };
  }
  return raus;
}
