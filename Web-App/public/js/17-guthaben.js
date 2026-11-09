import { registerActions } from './00-registry.js';
import { tRaw } from '../i18n.js';
import { api } from './01-api.js';
import { G } from './01-dom.js';
import { fmtN } from './01-format.js';
import { toast } from './01-meldungen.js';
import { _gutscheine, ladeGutscheine } from './17-gutscheine.js';

// Guthaben bei LEGO auf Knopfdruck abfragen. Die Grenze (eine Anfrage je 30 s über alle Benutzer) setzt der
// Server; die Oberfläche befolgt sie: Bei 429 wartet sie wartenSek ab und fragt dieselbe Karte erneut. Eine
// Sammelroute hielte dafür Minuten eine Verbindung offen.
// Ausführlich: docs/begruendungen/public/js/17-guthaben.js.md#kannst-du-dies-bei-den-gutscheinen-einba

/** Höchstens so oft dieselbe Karte erneut versuchen, wenn die Schranke bremst. */
const ABSTAND_VERSUCHE = 4;

const _warte = (/** @type {number} */ ms) => new Promise(r => setTimeout(r, ms));

/**
 * Sekunden abwarten und dabei herunterzählen.
 *
 * Der Text nennt die Karte: Bei „alle abfragen" ist sonst nicht zu sehen, wofür gewartet wird.
 */
/** @param {number} sekunden @param {string} nummer */
async function warteSichtbar(sekunden, nummer) {
  const status = G('vouchers-balance-status');
  for (let rest = sekunden; rest > 0; rest--) {
    if (status) status.textContent = tRaw('vouchers.balance_wait', { sek: rest, nummer });
    await _warte(1000);
  }
}

/**
 * Eine Karte abfragen — ohne Takten, ohne Neuladen.
 *
 * Gibt zurück, was der Aufrufer wissen muss: ob es geklappt hat, und wenn nicht, ob es am Abstand lag (dann
 * lohnt Warten) oder am Bot-Schutz (dann wird AUFGEHÖRT — weiterzufragen ist genau das, was nicht sein soll).
 * @param {number | string} id
 * @returns {Promise<{ art: 'ok', antwort: import('../../frontend-typen/vertrag').GuthabenAntwort } | { art: 'abstand', wartenSek: number } | { art: 'botschutz' | 'fehler', fehler: string }>}
 */
async function eineAbfrage(id) {
  const d = await api('POST', `/v1/vouchers/${id}/guthaben`);
  if (d?.success) return { art: 'ok', antwort: d };
  if (d?.grund === 'abstand' && Number(d.wartenSek) > 0) {
    return { art: 'abstand', wartenSek: Number(d.wartenSek) };
  }
  if (d?.grund === 'botschutz' || d?.grund === 'konto') {
    return { art: 'botschutz', fehler: d.error || tRaw('settings.error') };
  }
  return { art: 'fehler', fehler: d?.error || tRaw('settings.error') };
}

/** Was eine erfolgreiche Abfrage dem Nutzer sagt. */
/** @param {import('../../frontend-typen/vertrag').GuthabenAntwort} antwort */
function meldeErfolg(antwort) {
  const v = antwort.voucher;
  if (!v) return;
  toast(
    tRaw('vouchers.balance_done', {
      nummer: v.number,
      betrag: antwort.angezeigt || fmtN(v.amount, v.currency),
    }),
    'success',
  );
  // Eine stillschweigend geänderte Währung wäre eine geänderte Summe ohne Hinweis — die Liste rechnet nur,
  // wenn alle Gutscheine dieselbe tragen.
  if (antwort.waehrung_geaendert) {
    toast(tRaw('vouchers.balance_currency', { waehrung: v.currency }), 'info');
  }
}

/** Eine Karte, auf Knopfdruck in ihrer Zeile. */
/** @param {string} id */
export async function guthabenAbfragen(id) {
  const status = G('vouchers-balance-status');
  const g = _gutscheine.find(x => String(x.id) === String(id));
  if (status) status.textContent = tRaw('vouchers.balance_running');
  for (let versuch = 1; ; versuch++) {
    const r = await eineAbfrage(id);
    if (r.art === 'ok') {
      if (status) status.textContent = '';
      meldeErfolg(r.antwort);
      await ladeGutscheine();
      return;
    }
    if (r.art === 'abstand' && versuch < ABSTAND_VERSUCHE) {
      await warteSichtbar(r.wartenSek, g ? g.number : '');
      continue;
    }
    if (status) status.textContent = '';
    // Auch der Abstand wird hier zur Fehlermeldung: Nach vier Versuchen ist die Auskunft „es ist belegt"
    // ehrlicher als weiteres Warten.
    toast(('fehler' in r && r.fehler) || tRaw('settings.error'), 'error');
    return;
  }
}

/** Alle Karten mit PIN, eine nach der anderen. */
export async function guthabenAlleAbfragen() {
  const status = G('vouchers-balance-status');
  const dran = _gutscheine.filter(g => g.pin);
  if (!dran.length) {
    toast(tRaw('vouchers.balance_keine'), 'info');
    return;
  }
  let fertig = 0,
    fehler = 0;
  for (const g of dran) {
    let erledigt = false;
    for (let versuch = 1; !erledigt && versuch <= ABSTAND_VERSUCHE; versuch++) {
      if (status) {
        status.textContent = tRaw('vouchers.balance_progress', {
          n: fertig + fehler + 1,
          total: dran.length,
          nummer: g.number,
        });
      }
      const r = await eineAbfrage(g.id);
      if (r.art === 'ok') {
        fertig++;
        meldeErfolg(r.antwort);
        erledigt = true;
        break;
      }
      if (r.art === 'abstand') {
        await warteSichtbar(r.wartenSek, g.number);
        continue;
      }
      fehler++;
      toast(r.fehler, 'error');
      erledigt = true;
      // Bot-Schutz: HIER wird abgebrochen, nicht nur diese Karte übersprungen. Die übrigen Karten liefen in
      // dieselbe Wand, und Marcos Vorgabe ist, dass dann „nicht mehr Aufrufe generiert werden".
      if (r.art === 'botschutz') {
        if (status) status.textContent = '';
        await ladeGutscheine();
        return;
      }
    }
    if (!erledigt) {
      fehler++;
      toast(tRaw('vouchers.balance_belegt'), 'error');
    }
  }
  if (status) status.textContent = '';
  toast(tRaw('vouchers.balance_alle_fertig', { fertig, fehler }), fehler ? 'info' : 'success');
  await ladeGutscheine();
}

// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  guthabenAbfragen,
  guthabenAlleAbfragen,
});
