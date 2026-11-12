import { registerActions } from './registry.js';
import { colorName, locale, t, tRaw } from '../i18n.js';
import { escHex, esc, html, ungeprueft } from './escapen.js';
import { fehlerMeldung, api, apiRoh } from './api.js';
import { bildTag, platzhalterInhalt, imgUrl, thumbUrl } from './bilder.js';
import { leerZustand, ico, G, knopfBesetzt, alle, setzeHtml } from './dom.js';
import { feldFehler, istSetnummer } from './formular.js';
import { toast } from './meldungen.js';
import { baueWantedXmlStuecke } from './bricklink-xml.js';

// Auffangnetz für unbehandelte Fehler und die temporäre Teileliste. Gestartet wird die Anwendung von
// sitzung.js (startApp), nicht beim Laden dieses Moduls.

// ── TEILELISTE (temporary parts list, resets on page leave) ──────────────────
/**
 * @typedef {{ set_number: string, name: string, unbekannt?: boolean }} PlSet
 * @typedef {{ part_number: string, bl_part_number: string, part_name: string, color_name: string, color_hex: string | null,
 *   color_id: number, bl_color_id?: number | null, quantity: number, image_local?: string | null, image_url: string | null, is_fig?: boolean }} PlTeil
 * @typedef {{ type: string, part: string, color: number | null, colorName?: string, qty: number }} Fehlteil
 */
/** Die Sets der Teileliste; sie gilt nur bis zum Verlassen der Seite. @type {PlSet[]} */
let _plSets = [];
/** Die erzeugte Teileliste. @type {PlTeil[] | null} */
let _plParts = null;
/** Rebrickable- → BrickLink-Farbnummer. @type {Record<string, number>} */
let _rbToBlColor = {};

/** Zählt die Läufe von plGenerate: Ein schneller zweiter Zusatz überholt den ersten, und nur der letzte
 * zeichnet. */
let _plLauf = 0;

/** Hinzufügen rechnet die Liste gleich neu: Ein zweiter Schritt „Erstellen“ wurde regelmässig vergessen. */
async function plAddSet() {
  const raw = G('pl-setnr').value.trim();
  if (!raw) {
    feldFehler('pl-setnr', tRaw('common.enter_set_number'));
    return;
  }
  // Support comma-separated input
  const nrs = raw
    .split(',')
    .map(s => s.trim().replace(/\s/g, ''))
    .filter(Boolean);
  const falsch = nrs.filter(nr => !istSetnummer(nr));
  if (falsch.length) {
    feldFehler('pl-setnr', tRaw('gallery.add.number_invalid', { num: falsch.join(', ') }));
    return;
  }
  feldFehler('pl-setnr', '');
  const namen = nrs.map(nr => {
    const normalized = nr.includes('-') ? nr : nr + '-1';
    const eintrag = { set_number: normalized, name: normalized, unbekannt: false };
    _plSets.push(eintrag);
    // Name aus dem Katalog; kennt er die Nummer nicht, sagt es der Chip, statt sie still als Set ohne Teile
    // mitzuzählen.
    return api('GET', `/v1/sets/info/${normalized}`)
      .then(d => {
        if (!d.success) return;
        if (d.name && d.name !== normalized) eintrag.name = d.name;
        eintrag.unbekannt = d.im_katalog === false;
        plRenderSets();
      })
      .catch(() => {});
  });
  G('pl-setnr').value = '';
  G('pl-setnr').focus();
  plRenderSets();
  await Promise.all(namen);
  await plGenerate();
}

G('pl-setnr')?.addEventListener('keydown', e => e.key === 'Enter' && plAddSet());

/**
 * „Hinzufügen“ ist der eine Hauptknopf: Es rechnet die Liste gleich mit. „Neu berechnen“ bleibt für einen
 * zweiten Versuch; gesperrt nennt er den Grund sichtbar darunter und als Beschreibung, nicht nur durch Blässe.
 * @param {boolean} leer
 */
function plSchritt(leer) {
  const gen = G('btn-pl-gen'),
    hinweis = G('pl-gen-hinweis');
  if (!gen) return;
  if (leer) gen.setAttribute('aria-disabled', 'true');
  else gen.removeAttribute('aria-disabled');
  if (hinweis) hinweis.hidden = !leer;
  const beschreibung = (gen.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .filter(x => x && x !== 'pl-gen-hinweis');
  if (leer) beschreibung.unshift('pl-gen-hinweis');
  if (beschreibung.length) gen.setAttribute('aria-describedby', beschreibung.join(' '));
  else gen.removeAttribute('aria-describedby');
}

export function plRenderSets() {
  const c = G('pl-sets');
  if (!c) return;
  // Zurücksetzen hat erst etwas zu tun, wenn Sets oder eine fertige Liste da sind.
  G('btn-pl-reset').disabled = !_plSets.length && !_plParts;
  plSchritt(!_plSets.length);
  if (!_plSets.length) {
    setzeHtml(c, leerZustand({ ico: 'liste', titelKey: 'pl.no_sets', textKey: 'pl.no_sets_hint' }));
    return;
  }
  setzeHtml(
    c,
    _plSets.map(
      (s, i) => html`
    <div class="pl-chip${s.unbekannt ? ' unbekannt' : ''}">
      <span class="pl-chip-nr">${s.set_number}</span>
      <span class="pl-chip-name">${s.unbekannt ? html`${'— '}${tRaw('pl.nicht_im_katalog')}` : s.name !== s.set_number ? html`${'— '}${s.name}` : ''}</span>
      <button type="button" class="pl-chip-weg" data-click="plRemoveSet" data-arg="${i}" aria-label="${tRaw('pl.entfernen', { set: s.set_number })}">${ico('schliessen')}</button>
    </div>`,
    ),
  );
}
// Aufruf verschoben nach startApp() (js/init.js), das js/main.js NACH der Auswertung aller Module aufruft.
// Im Modulrumpf lief er zu früh: Bei gegenseitigen Importen ist das Übersetzungsobjekt aus i18n.js dann noch
// nicht initialisiert, und t() wirft.

/**
 * @param {number} i
 */
function plRemoveSet(i) {
  _plSets.splice(i, 1);
  _plParts = null;
  G('pl-result').replaceChildren();
  G('pl-status').textContent = '';
  plExportStand();
  plRenderSets();
  if (_plSets.length) plGenerate();
}

async function plGenerate() {
  // Eine getippte, noch nicht hinzugefügte Nummer gilt mit: „Erstellen“ soll nicht an einem vergessenen Klick scheitern.
  if (G('pl-setnr')?.value.trim()) {
    // plAddSet rechnet selbst; steht die Nummer danach noch im Feld, war sie ungültig (am Feld gesagt).
    await plAddSet();
    return;
  }
  if (!_plSets.length) {
    feldFehler('pl-setnr', tRaw('pl.erst_set'));
    return;
  }
  const lauf = ++_plLauf;
  G('pl-status').textContent = tRaw('pl.loading_lists');
  G('btn-pl-gen').disabled = true;
  G('pl-result').replaceChildren();
  _plParts = null;
  plExportStand();

  /** @type {Record<string, PlTeil>} Schlüssel „Teilnummer|Farbe“ bzw. „fig:Nummer“ */
  const combined = {};
  let errors = 0;

  // Load RB→BL color mapping from server (from rb_colors.bl_color_id)
  /** @type {Record<string, number>} */
  let rbToBlColor = {};
  try {
    const cm = await api('GET', '/v1/parts/bl-color-map');
    // Die Werte sind Farbnummern; der Vertrag nennt die Karte nur offen (Record<string, unknown>).
    if (cm?.success) rbToBlColor = /** @type {Record<string, number>} */ (cm.map);
  } catch (_) {}
  _rbToBlColor = rbToBlColor;

  const bekannt = _plSets.filter(s => !s.unbekannt),
    unbekannt = _plSets.filter(s => s.unbekannt);
  for (const s of bekannt) {
    G('pl-status').textContent = tRaw('pl.loading_set', { set: s.set_number });
    // Use user-independent CSV endpoints (work for all users regardless of import history)
    try {
      const d = await api('GET', `/v1/sets/${encodeURIComponent(s.set_number)}/parts-list`);
      if (d.success && d.parts?.length) {
        for (const p of d.parts) {
          const blNum = p.bl_part_number || p.part_number;
          // Zusammengefasst wird nach der Rebrickable-Nummer, weil der Bestand danach nachgefragt wird:
          // Mehrere Formvarianten teilen eine BrickLink-Nummer, und nach ihr zusammengelegt zählte der Bedarf
          // doppelt, der Bestand einfach.
          const key = `${p.part_number}|${p.color_id || 0}`;
          if (combined[key]) {
            combined[key].quantity += parseInt(String(p.total_quantity || p.quantity || 1), 10);
          } else {
            combined[key] = {
              part_number: p.part_number,
              bl_part_number: blNum,
              part_name: p.part_name || p.part_number,
              color_name: p.color_name || '–',
              color_hex: p.color_hex || null,
              color_id: p.color_id || 0,
              bl_color_id: p.bl_color_id ?? rbToBlColor[p.color_id] ?? null,
              quantity: parseInt(String(p.total_quantity || p.quantity || 1), 10),
              image_local: p.image_local || null,
              image_url: p.image_url || null,
            };
          }
        }
      } else if (!d.success) {
        errors++;
      }
    } catch (e) {
      console.error('plGenerate parts error for', s.set_number, e);
      errors++;
    }

    // Fetch minifigures from CSV (user-independent)
    try {
      const dm = await api('GET', `/v1/sets/${encodeURIComponent(s.set_number)}/minifigs-list`);
      if (dm?.success && dm.figs?.length) {
        for (const f of dm.figs) {
          const figQty = parseInt(String(f.quantity || 1), 10);
          const key = `fig:${esc(f.fig_number)}`;
          if (combined[key]) {
            combined[key].quantity += figQty;
          } else {
            combined[key] = {
              part_number: f.fig_number,
              bl_part_number: f.fig_number,
              part_name: f.fig_name || f.fig_number,
              color_name: tRaw('detail.minifigs'),
              color_hex: 'f5a800',
              color_id: 0,
              quantity: figQty,
              image_url: f.image_url || null,
              is_fig: true,
            };
          }
        }
      }
    } catch (e) {
      console.error('plGenerate figs error for', s.set_number, e);
    }
  }

  if (lauf !== _plLauf) return;
  _plParts = Object.values(combined);
  G('pl-status').textContent =
    `${tRaw('pl.summary_teile', { n: _plParts.length, teile: _plParts.reduce((s, x) => s + (Number(x.quantity) || 0), 0).toLocaleString(locale()) })} ${tRaw('pl.summary_sets', { n: bekannt.length })}` +
    (errors ? ` (${tRaw('monitor.errors_n', { n: errors })})` : '') +
    (unbekannt.length
      ? ` · ${tRaw('pl.unbekannt_n', { n: unbekannt.length, nummern: unbekannt.map(s => s.set_number).join(', ') })}`
      : '');
  G('btn-pl-gen').disabled = false;
  plRenderTable(errors);
  plExportStand();
}

/**
 * „Kann ich das bauen?“ füllt die vorhandene Spalte „Vorhanden“ aus dem Bestand statt einer zweiten Ansicht:
 * Zwei Tabellen wären zwei Orte, an denen die Rechnung auseinanderläuft. Die Zahl überschreibt Handeingaben.
 */
async function plFuelleBestand() {
  const felder = /** @type {HTMLInputElement[]} */ (alle('.pl-have-input'));
  if (!felder.length) return;
  const nurLose = !!G('pl-bestand-lose')?.checked;

  // `data-key` ist `<rbPartNum>__<rbColorId>` — die Rebrickable-Schreibweise.
  // Genau die steht auch in der eigenen Teile-Tabelle; die BrickLink-Nummer daneben ist nur für den Export da
  // und taugt für den Abgleich nicht.
  const teile = felder
    .map(el => {
      const [num, farbe] = String(el.dataset.key || '').split('__');
      return { part_number: num, color_id: parseInt(farbe, 10) || 0 };
    })
    .filter(t => t.part_number);

  const b = G('btn-pl-bestand');
  const frei = knopfBesetzt(b);
  // Das Blickfeld kommt aus DIESER Ansicht, nicht mehr aus dem Teile-Reiter.
  // `own` und `all` sind die Namen, die der Server ohnehin kennt
  // (src/haushalt/haushalt.ts, parseScopeMode) — die Wahl ist also nur eine andere Bedienung derselben Sache,
  // kein zweiter Begriff daneben.
  const mitSubs = !!G('pl-bestand-subs')?.checked;
  const d = await api('POST', `/v1/parts/owned${mitSubs ? '' : '?accounts=own'}`, { teile }).catch(() => null);
  frei();
  if (!d?.success) {
    toast(d?.error || t('settings.error'), 'error');
    return;
  }

  let getroffen = 0,
    fehlend = 0,
    fehlendeArten = 0;
  for (const el of felder) {
    const [num, farbe] = String(el.dataset.key || '').split('__');
    const eintrag = d.bestand?.[`${num}|${parseInt(farbe, 10) || 0}`];
    const habe = (eintrag ? (nurLose ? eintrag.lose : eintrag.gesamt) : 0) ?? 0;
    el.value = String(habe);
    if (habe > 0) getroffen++;
    const braucht = parseInt(el.dataset.need ?? '', 10) || 0;
    if (habe < braucht) {
      fehlend += braucht - habe;
      fehlendeArten++;
    }
  }

  const status = G('pl-status');
  if (!status) return;
  if (!getroffen) status.textContent = tRaw('pl.owned_none');
  else if (!fehlendeArten) status.textContent = tRaw('pl.owned_complete');
  else
    status.textContent =
      tRaw('pl.owned_filled', { n: getroffen, m: felder.length }) +
      ' ' +
      tRaw('pl.owned_missing', { n: fehlend, m: fehlendeArten });
}

/** Export und Bestand erst, wenn die Liste Teile hat: Eine leere Datei hilft niemandem.
 * Am Telefon beim ersten Mal zugeklappt, damit das Ergebnis vorn steht. */
function plExportStand() {
  const box = G('pl-export'),
    optionen = /** @type {HTMLDetailsElement | null} */ (document.getElementById('pl-optionen'));
  if (!box) return;
  const leer = !_plParts?.length;
  box.hidden = leer;
  if (optionen) {
    optionen.hidden = leer;
    if (!leer && !optionen.dataset.entschieden) {
      optionen.dataset.entschieden = '1';
      optionen.open = !window.matchMedia?.('(max-width: 640px)').matches;
    }
  }
  for (const id of ['btn-pl-pdf', 'btn-pl-bl', 'pl-bl-condition']) G(id).disabled = leer;
}

function plRenderTable(fehler = 0) {
  if (!_plParts?.length) {
    // Die Ursache nennen: Fehlende Teilelisten kommen aus dem Rebrickable-Katalog, nicht aus der Eingabe.
    setzeHtml(
      G('pl-result'),
      leerZustand({
        ico: 'warnung',
        titelKey: fehler ? 'pl.leer_fehler_titel' : 'pl.leer_titel',
        textKey: fehler ? 'pl.leer_fehler_text' : 'pl.leer_text',
        knopf: { textKey: 'liste.erneut', click: 'plGenerate', ico: 'aktualisieren', art: 'bs' },
      }),
    );
    return;
  }

  // Group by color
  /** @type {Record<string, { color_name: string, color_hex: string | null, parts: PlTeil[] }>} */
  const byColor = {};
  for (const p of _plParts) {
    const k = p.color_name;
    if (!byColor[k]) byColor[k] = { color_name: p.color_name, color_hex: p.color_hex, parts: [] };
    byColor[k].parts.push(p);
  }
  const sorted = Object.values(byColor).sort((a, b) => a.color_name.localeCompare(b.color_name));

  let markup = html``;
  for (const grp of sorted) {
    const colorDot = grp.color_hex
      ? html`<span data-stil="display:inline-block;width:14px;height:14px;border-radius:50%;border:1px solid rgba(0,0,0,.15);vertical-align:middle;margin-right:6px" data-farbe="${escHex(grp.color_hex, 'var(--s300)')}"></span>`
      : '';
    markup = html`${markup}${html`<div data-stil="margin-bottom:1.5rem"><div data-stil="font-weight:700;font-size:var(--fs-4);padding:6px 0;border-bottom:2px solid var(--b200);margin-bottom:.5rem;color:var(--b700)">${colorDot}${colorName(grp.color_name)} <span data-stil="font-weight:400;color:var(--mut);font-size:var(--fs-3)">${tRaw('pl.types', { n: grp.parts.length })}</span></div><div>`}`;
    markup = html`${markup}${html`<div data-stil="display:flex;align-items:center;gap:10px;padding:3px 4px;font-size:var(--fs-0);font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:.4px;border-bottom:1.5px solid var(--b200)"><span data-stil="width:44px;flex-shrink:0"></span><span data-stil="min-width:65px;flex-shrink:0">${tRaw('col.nr')}</span><span data-stil="flex:1">${tRaw('pl.col_name')}</span><span data-stil="width:6.5em;text-align:right;flex-shrink:0;white-space:nowrap">${tRaw('pl.col_needed')}</span><span data-stil="width:6.5em;padding-left:6px;flex-shrink:0;white-space:nowrap">${tRaw('pl.col_have')}</span></div>`}`;
    for (const p of grp.parts.sort((a, b) =>
      (a.bl_part_number || a.part_number).localeCompare(b.bl_part_number || b.part_number, undefined, {
        numeric: true,
      }),
    )) {
      // Build image source: prefer local cached file, then stored URL, then Rebrickable CDN
      const imgSrc = p.image_url || '';
      const img = imgSrc
        ? bildTag({ src: imgUrl(thumbUrl(imgSrc) || imgSrc, true), alt: '', klasse: 'bild-44', ph: 'teil' })
        : html`<span class="bild-ph bild-44" aria-hidden="true">${platzhalterInhalt('teil')}</span>`;
      const pkey = `${p.part_number}__${p.color_id || 0}`;
      // Kein Rückfall auf die Rebrickable-Farbnummer: Das ergäbe eine gültige Datei mit der falschen Farbe.
      // Leer heisst unbekannt; plExportBricklink lässt solche Posten weg und nennt sie.
      const blColorId = p.bl_color_id ?? _rbToBlColor[p.color_id] ?? '';
      markup = html`${markup}${html`<div data-stil="display:flex;align-items:center;gap:10px;padding:5px 4px;border-bottom:1px solid var(--bdr)">${img}<span data-stil="font-family:monospace;font-size:var(--fs-2);color:var(--b600);min-width:65px;flex-shrink:0" title="Rebrickable: ${p.part_number}">${p.bl_part_number || p.part_number}</span><span data-stil="flex:1;font-size:var(--fs-3)">${p.part_name}</span><span data-stil="font-weight:700;font-size:var(--fs-3);width:6.5em;text-align:right;flex-shrink:0">×${ungeprueft(p.quantity.toLocaleString(locale()))}</span><span data-stil="width:6.5em;flex-shrink:0;padding-left:6px"><input inputmode="numeric" type="number" min="0" value="0" data-key="${pkey}" data-need="${p.quantity}" data-part="${p.bl_part_number || p.part_number}" data-color="${blColorId}" data-rb-color="${p.color_id || 0}" data-color-name="${p.color_name || ''}" data-type="${(p.bl_part_number || p.part_number || 'P').startsWith('fig-') ? 'M' : 'P'}" class="pl-have-input" aria-label="${tRaw('pl.col_have')}: ${p.bl_part_number || p.part_number} ${p.color_name || ''}" data-stil="width:58px;height:28px;border:1px solid var(--feldrand);border-radius:5px;padding:0 6px;font-size:var(--fs-2);text-align:center" /></span></div>`}`;
    }
    markup = html`${markup}</div></div>`;
  }
  // Summary shown in status bar above table
  setzeHtml(G('pl-result'), markup);
}

async function plExportPdf() {
  if (!_plParts?.length) return;
  const btn = G('btn-pl-pdf');
  // Die Freigabe merkt sich die Beschriftung, statt sie am Ende neu zu setzen: Hier stand '📄 PDF' als
  // Literal, obwohl der Knopf im Markup ein data-i18n trägt.
  const frei = btn ? knopfBesetzt(btn, tRaw('pdf.creating')) : () => {};
  try {
    const pdfParts = _plParts.map(p => ({
      part_number: p.part_number,
      bl_part_number: p.bl_part_number || p.part_number,
      part_name: p.part_name,
      color_name: p.color_name,
      color_hex: p.color_hex,
      color_id: p.color_id,
      quantity: p.quantity,
      image_url: p.image_url,
      image_local: p.image_local || null,
      is_fig: p.is_fig || false,
    }));

    // Step 1: Async PDF-Job starten
    const startResp = await apiRoh('POST', '/v1/sets/partslist-pdf', { body: { sets: _plSets, parts: pdfParts } });
    if (!startResp.ok) throw new Error(`HTTP ${startResp.status}`);
    const { jobId } = await startResp.json();
    if (!jobId) throw new Error(tRaw('pdf.no_job_id'));

    // Step 2: SSE statt Polling — Ergebnis kommt sofort wenn fertig. Fallback auf Polling falls EventSource
    // nicht verfügbar.
    if (btn) btn.textContent = tRaw('pdf.loading_images');
    await /** @type {Promise<void>} */ (
      new Promise((resolve, reject) => {
        let settled = false;
        // Countdown der geschätzten Restzeit (aus etaSeconds vom Server).
        /** @type {number | null} */
        let etaTimer = null;
        /** @type {number} */
        let etaRemaining = 0;
        const stopEta = () => {
          if (etaTimer) {
            clearInterval(etaTimer);
            etaTimer = null;
          }
        };
        const startEta = (/** @type {number} */ sec) => {
          if (etaTimer || !sec || sec <= 0) return;
          etaRemaining = sec;
          const tick = () => {
            if (btn)
              btn.textContent = etaRemaining > 0 ? tRaw('pdf.eta', { sec: etaRemaining }) : tRaw('pdf.almost_done');
            if (etaRemaining > 0) etaRemaining--;
          };
          tick();
          etaTimer = setInterval(tick, 1000);
        };
        const finish = (/** @type {string | null} */ err) => {
          stopEta();
          if (!settled) {
            settled = true;
            err ? reject(new Error(err)) : resolve();
          }
        };

        const trySSE = () => {
          if (typeof EventSource === 'undefined') {
            pollPdfStatus(jobId, btn, finish, startEta);
            return;
          }
          const es = new EventSource(`/api/v1/sets/partslist-pdf/stream/${jobId}`, { withCredentials: true });
          es.onmessage = e => {
            try {
              const { status, error, etaSeconds } = JSON.parse(e.data);
              if (status === 'running' && etaSeconds != null) startEta(etaSeconds);
              if (status === 'done') {
                es.close();
                finish(null);
              } else if (status === 'error') {
                es.close();
                finish(error || t('pdf.server_error'));
              }
            } catch (_) {}
          };
          es.onerror = () => {
            es.close();
            if (!settled) pollPdfStatus(jobId, btn, finish, startEta);
          };
        };
        trySSE();
      })
    );

    // Step 3: Download
    const dlResp = await apiRoh('GET', `/v1/sets/partslist-pdf/download/${jobId}`);
    if (!dlResp.ok) throw new Error(tRaw('pdf.download_error', { status: dlResp.status }));
    const blob = await dlResp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'teileliste.pdf';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(tRaw('pdf.created'), 'success');
  } catch (e) {
    console.error('PDF error:', e);
    toast(tRaw('pdf.error_prefix') + ' ' + fehlerMeldung(e), 'error');
  } finally {
    frei();
  }
}

// Polling-Fallback für PDF-Export (nur wenn EventSource nicht verfügbar).
/**
 * @param {string} jobId @param {HTMLElement | null} _btn
 * @param {(err: string | null) => void} finish @param {(sec: number) => void} startEta
 */
async function pollPdfStatus(jobId, _btn, finish, startEta) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const r = await apiRoh('GET', `/v1/sets/partslist-pdf/status/${jobId}`);
      // Ein Fehlerstatus (Auftrag unbekannt, Server weg) beendet das Warten gleich.
      if (!r.ok) {
        finish(tRaw('pdf.server_error'));
        return;
      }
      const { status, error, etaSeconds } = await r.json();
      if (status === 'running' && etaSeconds != null && startEta) startEta(etaSeconds);
      if (status === 'done') {
        finish(null);
        return;
      }
      if (status === 'error') {
        finish(error || t('pdf.server_error'));
        return;
      }
    } catch (e) {
      finish(fehlerMeldung(e));
      return;
    }
  }
  finish(tRaw('pdf.timeout'));
}

export function plInit() {
  // Capture server origin for local image paths
  window._plServerUrl = window.location.origin;
  plRenderSets();
}

/** Was laut Tabelle fehlt (Bedarf minus vorhanden), mit BrickLink-Farbe. */
function fehlendeTeile() {
  // Alle Felder „vorhanden“ aus der Tabelle einsammeln
  const inputs = /** @type {HTMLInputElement[]} */ (alle('.pl-have-input'));
  /** @type {Fehlteil[]} */
  const missing = [];
  inputs.forEach(inp => {
    const need = parseInt(inp.dataset.need ?? '', 10) || 0;
    const have = parseInt(inp.value, 10) || 0;
    const diff = need - have;
    if (diff > 0) {
      const rbColor = parseInt(inp.dataset.rbColor ?? '', 10) || 0;
      // `data-color` ist leer, wenn der Katalog keine BrickLink-Farbe kennt
      // (siehe plRenderTable). Die Karte wird noch einmal befragt, weil sie beim Zeichnen der Tabelle
      // vielleicht noch nicht geladen war.
      const roh = inp.dataset.color;
      const ausKarte = _rbToBlColor[rbColor];
      const blColor = ausKarte ?? (roh === '' || roh === undefined ? null : parseInt(roh, 10));
      missing.push({
        type: inp.dataset.type || 'P',
        part: inp.dataset.part ?? '',
        color: blColor != null && Number.isFinite(blColor) ? blColor : null,
        colorName: inp.dataset.colorName || '',
        qty: diff,
      });
    }
  });
  return missing;
}

/** Figuren in ihre Teile auflösen und gleiche BrickLink-Nummer+Farbe zusammenzählen.
 * @param {Fehlteil[]} missing @returns {Promise<Fehlteil[]>} */
async function figurenAufloesen(missing) {
  // Expand minifigs into individual parts and deduplicate by BL-ID + color
  /** @type {Record<string, Fehlteil>} Schlüssel „Art|Teilnummer|Farbe“ */
  const blMap = {};
  for (const m of missing) {
    if (m.type === 'M') {
      try {
        const dp = await api('GET', `/v1/minifigs/${encodeURIComponent(m.part)}/parts`);
        if (dp?.success && dp.parts?.length) {
          // FigurTeile nennt die Felder einer Zeile nicht; so liefert sie src/figuren.
          const teile =
            /** @type {{ part_number: string, bl_part_number?: string | null, color_id: number, bl_color_id?: number | null, quantity?: number }[]} */ (
              dp.parts
            );
          for (const p of teile) {
            const blNum = p.bl_part_number || p.part_number;
            // Dieselbe Regel wie in der Tabelle: keine Zuordnung heisst UNBEKANNT, nicht „nimm die
            // Rebrickable-Nummer".
            const blColId = p.bl_color_id ?? _rbToBlColor[p.color_id] ?? null;
            const key = `P|${blNum}|${blColId}`;
            const qty = parseInt(String(p.quantity || 1), 10) * m.qty;
            if (blMap[key]) blMap[key].qty += qty;
            else blMap[key] = { type: 'P', part: blNum, color: blColId, qty };
          }
          continue;
        }
      } catch (_) {}
      // Fallback: add whole minifig
      const key = `M|${m.part}|0`;
      if (blMap[key]) blMap[key].qty += m.qty;
      else blMap[key] = { type: 'M', part: m.part, color: 0, qty: m.qty };
    } else {
      const key = `P|${m.part}|${m.color || 0}`;
      if (blMap[key]) blMap[key].qty += m.qty;
      else blMap[key] = { ...m };
    }
  }
  return Object.values(blMap);
}

/** Ein Stück im neuen Tab (zum Kopieren), mehrere als Downloads. @param {string[]} stuecke */
function wantedXmlAusliefern(stuecke) {
  if (stuecke.length === 1) {
    const blob = new Blob([stuecke[0]], { type: 'text/plain; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const tab = window.open(url, '_blank');
    if (!tab) {
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bricklink-wanted.xml';
      a.click();
      toast(tRaw('pdf.popup_blocked'), 'info');
    } else {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  } else {
    for (const [i, teil] of stuecke.entries()) {
      const url = URL.createObjectURL(new Blob([teil], { type: 'text/plain; charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `bricklink-wanted-${i + 1}.xml`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }
}

async function plExportBricklink() {
  // Ensure BL color mapping is loaded (may be empty if plGenerate was called before sync)
  if (!Object.keys(_rbToBlColor).length) {
    try {
      const cm = await api('GET', '/v1/parts/bl-color-map');
      if (cm?.success && cm.map) _rbToBlColor = /** @type {Record<string, number>} */ (cm.map);
    } catch (_) {}
  }
  const condition = G('pl-bl-condition')?.value || 'X';
  const missing = fehlendeTeile();
  if (!missing.length) {
    toast(tRaw('pl.none_missing'), 'info');
    return;
  }

  const expanded = await figurenAufloesen(missing);

  // Posten ohne bekannte BrickLink-Farbe gehen nicht mit, sie werden genannt: Eine geratene Farbe bestellt
  // das falsche Teil, und das merkt man erst am Paket. Figuren (Typ M) haben keine Farbe und sind nie
  // betroffen.
  const ohneFarbe = expanded.filter(m => m.type !== 'M' && (m.color === null || m.color === undefined));
  const exportierbar = expanded.filter(m => !ohneFarbe.includes(m));

  const stuecke = baueWantedXmlStuecke(exportierbar.map(m => ({ ...m, condition })));

  // BrickLink weist eine Datei über BL_UPLOAD_MAX_BYTES ganz ab. Ein Stück öffnet wie bisher im Tab zum
  // Kopieren; mehrere werden heruntergeladen — ein Tab je Stück wäre ein Popup-Gewitter.
  wantedXmlAusliefern(stuecke);

  toast(tRaw('pl.bl_exported', { n: exportierbar.length }), 'success');
  if (stuecke.length > 1) toast(tRaw('pl.bl_split', { n: stuecke.length }), 'info');
  // Zuletzt und als eigene Meldung, damit sie nicht neben der Erfolgsmeldung untergeht: Was fehlt, muss man
  // lesen.
  if (ohneFarbe.length) {
    toast(
      tRaw('pl.bl_no_color', {
        n: ohneFarbe.length,
        liste:
          ohneFarbe
            .slice(0, 5)
            .map(m => (m.colorName ? `${m.part} (${m.colorName})` : m.part))
            .join(', ') + (ohneFarbe.length > 5 ? ' …' : ''),
      }),
      'error',
    );
  }
}

function plReset() {
  _plSets = [];
  _plParts = null;
  G('pl-result').replaceChildren();
  G('pl-status').textContent = '';
  plExportStand();
  plRenderSets();
}

// ── Handler beim Dispatcher anmelden (siehe js/registry.js) ──────────────
/**
 * Ansichtswahl Karten/Tabelle bei Teilen und Minifiguren: dieselben Knöpfe wie bei den Sets. Der Wert liegt
 * weiter im (versteckten) Auswahlfeld, an dem die Lade- und Zeichenlogik hängt.
 * @param {string} id
 * @param {string} wert
 */
function ansichtWaehlen(id, wert) {
  const feld = G(id);
  if (!feld || feld.value === wert) return;
  feld.value = wert;
  alle(`[data-click="ansichtWaehlen"][data-arg="${id}"]`).forEach(b => {
    const an = b.dataset.arg2 === wert;
    b.classList.toggle('active', an);
    b.setAttribute('aria-pressed', String(an));
  });
  feld.dispatchEvent(new Event('change', { bubbles: true }));
}

registerActions({
  ansichtWaehlen,
  plAddSet,
  plExportBricklink,
  plExportPdf,
  plFuelleBestand,
  plGenerate,
  plRemoveSet,
  plReset,
});

/**
 * Teileliste-Zustand zurücksetzen (beim Abmelden).
 *
 * Importierte Bindungen sind in ES-Modulen schreibgeschützt. Die Funktion hält das Wissen, was "leer" für
 * diesen Zustand heisst, dort wo der Zustand definiert ist.
 */
export function resetPartsList() {
  _plParts = null;
  _plSets = [];
}
