import { registerActions } from './00-registry.js';
import { LANG, t, tRaw } from '../i18n.js';
import { fehlerMeldung, api, apiDaten } from './01-api.js';
import { G } from './01-dom.js';
import { fmtPct } from './01-format.js';
import { toast } from './01-meldungen.js';
import { gibStart, importZaehler, protokollZeile, csvPollAktiv, addCsvLog, hideProgress, setProgBar, showProgress, setzeCsvPollAktiv } from './01-fortschritt.js';
import { _lastImportAt, _pnlCache } from './00-zustand.js';
import { confirmDelete } from './01-rueckfrage.js';
import { loadGallery } from './02-gallery.js';

// Set-CSV-Import aus der Galerie: Vorab-Prüfung, Strom des Auftrags und Abfrage, wenn der Strom abreisst.
// CSV import via SSE stream — Datei-Auswahl startet den Import direkt (analog Teile-Import)
async function startSetCsvImport(){
  const fi=G('csv-file'); const datei = fi.files?.[0]; if(!datei){toast(tRaw('csv.select_file'),'error');return;}
  const formular = () => { const fd=new FormData(); fd.append('file', datei); return fd; };
  // Erst lesen lassen, dann fragen: Der Import erhöht bei vorhandenen Sets die Menge, das Einzel-Erfassen
  // lehnt dasselbe Set ab. Wer eine Datei zweimal wählt, soll das vorher erfahren.
  const vorab = await api('POST', '/v1/sets/import/csv?pruefen=1', formular());
  if(!vorab.success){ toast(vorab.error||tRaw('settings.error'),'error'); fi.value=''; return; }
  if((vorab.vorhanden ?? 0) > 0 && !await confirmDelete(tRaw('csv.vorhanden_titel'),
    tRaw('csv.vorhanden_text', { n: vorab.vorhanden ?? 0, nummern: (vorab.vorhanden_nummern || []).slice(0, 5).join(', ') }),
    'import', { knopf: 'csv.vorhanden_knopf', art: 'bp' })){ fi.value=''; return; }
  showProgress(tRaw('csv.import_title'), true);
  try{
    // Start import job (returns immediately)
    const startData = await api('POST', '/v1/sets/import/csv', formular());
    if(!startData.success){ hideProgress(); toast(startData.error||t('settings.error'),'error'); return; }
    const total = startData.total;
    // Übersprungene Zeilen nennen — der Import läuft trotzdem weiter, aber wer 500 Zeilen schickt und 498
    // importiert bekommt, soll es erfahren.
    if (startData.skipped_hint) toast(startData.skipped_hint, 'info');
    G('prog-footer').textContent=tRaw('csv.items_progress',{done:0,total});
    G('prog-set-name').textContent=tRaw('csv.wartet');

    setzeCsvPollAktiv(true);
    gibStart(); // globalen Balken zeigen (dieses + andere Fenster)
    G('btn-cancel-import').style.display='inline-flex';

    // Fortschritt bevorzugt über SSE; nur bei Ausfall Polling-Fallback.
    const ctx = { total: total ?? 0, prevDone: /** @type {number | null | undefined} */ (-1), prevResultCount:0 };
    // Ohne `?token=`: Das Cookie trägt den Kanal, der Token in der Adresse wäre nur der Sitzungstoken im
    // Protokoll.
    const url = `/api/v1/sets/import/csv/stream?sprache=${encodeURIComponent(LANG)}`;

    await /** @type {Promise<void>} */ (new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };

      if (typeof EventSource !== 'undefined') {
        try {
          const es = new EventSource(url, { withCredentials: true });
          es.onmessage = (e) => {
            let s; try { s = JSON.parse(e.data); } catch(_) { return; }
            const finished = csvApplyOverlayStatus(s, ctx, fi);
            if (finished) { es.close(); finish(); }
          };
          es.onerror = () => {
            es.close();
            if (!settled) {
              // SSE weg → auf Polling zurückfallen
              csvPollLoop(ctx, fi).then(finish);
            }
          };
        } catch(_) {
          csvPollLoop(ctx, fi).then(finish);
        }
      } else {
        csvPollLoop(ctx, fi).then(finish);
      }
    }));
  }catch(e){ hideProgress(); toast(fehlerMeldung(e),'error'); }
}

// Verarbeitet ein CSV-Status-Objekt fürs Overlay des startenden Fensters. Gibt true zurück, wenn der Import
// abgeschlossen ist.
/**
 * @param {import('./01-fortschritt.js').ImportStand} s
 * @param {{ total: number, prevDone: number | null | undefined, prevResultCount: number }} ctx
 * @param {HTMLInputElement | null} fi
 */
function csvApplyOverlayStatus(s, ctx, fi){
  if(!s.success) return true;
  const total = ctx.total;
  if(s.done !== ctx.prevDone){
    ctx.prevDone = s.done;
    const done = s.done ?? 0;
    const pct = total>0 ? (done/total)*95 : 0;
    setProgBar(pct);
    G('prog-footer').textContent=`${tRaw('csv.items_progress',{done,total})} (${importZaehler(s)})`;
    G('prog-set-name').textContent = s.current ? tRaw('csv.verarbeite', { set: s.current, done, total })
      : done === 0 && s.status === 'running' ? tRaw('csv.wartet') : '';
    // Fortschrittsbalken im Kopf direkt nachführen
    { const _p=total>0?Math.round(done/total*100):0; const _b=G('global-import-bar'); if(_b){_b.style.display='flex';G('gib-fill').style.width=_p+'%';G('gib-text').textContent=done+'/'+total+' ('+fmtPct(_p,{vorzeichen:false,stellen:0})+')';} }
    // Show live results as they come in
    if(s.results && s.results.length > ctx.prevResultCount) {
      const newResults = s.results.slice(ctx.prevResultCount);
      newResults.forEach(r => {
        // Derselbe Bauer wie in 01-fortschritt.js — die Begruendung steht dort.
        const z = protokollZeile(r);
        if (z) addCsvLog(z.text, z.art);
      });
      ctx.prevResultCount = s.results.length;
    }
  }
  if(s.status==='done'||s.status==='cancelled'||s.status==='error'){
    setzeCsvPollAktiv(false);
    G('btn-cancel-import').style.display='none';
    setProgBar(100);
    if(s.status==='error'){ hideProgress(); toast(s.error||t('csv.import_error'),'error'); }
    else{
      // Add any remaining results not yet shown in live log
      if(s.results) {
        const remaining = s.results.slice(ctx.prevResultCount);
        remaining.forEach(r=>{
          // Derselbe Zeilenbauer wie in 01-fortschritt.js. Ohne esc(), weil addCsvLog textContent setzt; der
          // Hinweis auf Zeitüberschreitung gilt nur hier.
          // Ausführlich: docs/begruendungen/public/js/02-set-csv-import.js.md#derselbe-zeilenbauer-wie-in-01
          const z = protokollZeile(r, tRaw('csv.timeout_retry'));
          if (z) addCsvLog(z.text, z.art);
        });
        ctx.prevResultCount = s.results.length;
      }
      if((s.err ?? 0)>0){
        const errSets = (s.results||[]).filter(r=>!r.success);
        const errList = errSets.map(r=>r.set_number+': '+(r.error||'?')).join('; ');
        console.warn('[CSV Import] Fehler: '+errList);
      }
      const zaehler = importZaehler(s, 'csv.warnings_n');
      G('prog-footer').textContent=`${tRaw('csv.zeilen_gelesen', { n: s.total ?? 0 })} · ${zaehler}`;
      const btnClose = G('btn-close-import');
      if (btnClose) btnClose.style.display = '';
      loadGallery();
      toast(tRaw('csv.import_meldung', { ergebnis: zaehler }),s.err?'error':s.warn?'info':'success');
      if(fi) fi.value='';
    }
    return true;
  }
  return false;
}

// Polling-Fallback für das startende Fenster (nur wenn SSE nicht verfügbar).
/**
 * @param {{ total: number, prevDone: number | null | undefined, prevResultCount: number }} ctx
 * @param {HTMLInputElement | null} fi
 */
async function csvPollLoop(ctx, fi){
  while(csvPollAktiv()){
    await new Promise(r=>setTimeout(r,1500));
    if(!csvPollAktiv()) break;
    try{
      // apiDaten statt api: api() überschriebe das Feld `status` mit dem HTTP-Status, die Schleife endete nie.
      const s = await apiDaten('GET','/v1/sets/import/csv/status');
      if(s && csvApplyOverlayStatus(/** @type {import('./01-fortschritt.js').ImportStand} */ (s), ctx, fi)) break;
    }catch(e){ console.warn('Poll error:',e); }
  }
}

// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  startSetCsvImport,
});
