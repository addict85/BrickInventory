// ═══ MOBILE-VERHALTEN ═══════════════════════════════════════════════════════
//
// Ergänzt mobile.css um die zwei Dinge, die sich nicht rein deklarativ lösen
// lassen. Läuft auf jeder Bildschirmgrösse, tut aber nur auf schmalen etwas.
//
// 1. Tabellen-Beschriftungen
//    mobile.css verwandelt jede .dt-Tabelle unter 640px in eine Kartenliste.
//    Damit man dann noch weiss, welcher Wert wozu gehört, braucht jede <td>
//    die Beschriftung ihrer Spalte in data-label — das CSS blendet sie über
//    ::before ein.
//
//    Statt alle zehn Tabellen-Templates in sechs Dateien anzufassen (und
//    künftige zu vergessen), stempelt ein MutationObserver die Attribute
//    nachträglich. Er liest die <th>-Texte des zugehörigen <thead> und
//    verteilt sie spaltenweise. Neue Tabellen bekommen das Verhalten damit
//    automatisch, ohne dass jemand daran denken muss.
//
// 2. Aktiver Reiter im Blick
//    Die Navigation ist auf dem Telefon horizontal scrollbar. Nach einem
//    Tabwechsel — oder direkt nach dem Login, wenn ein hinterer Reiter aktiv
//    ist — steht der aktive Eintrag sonst ausserhalb des sichtbaren Bereichs.

(function () {
  'use strict';

  // ── 1. data-label auf Tabellenzellen ────────────────────────────────────

  /** Beschriftungen einer Tabelle aus ihrem <thead> übernehmen. */
  function labelTable(table) {
    if (!table || table.dataset.labelled === '1') return;
    const head = table.tHead;
    if (!head || !head.rows.length) return;

    // Nur die unterste Kopfzeile zählt — mehrzeilige Köpfe (Gruppenüberschrift
    // darüber) kommen in den Finanztabellen vor.
    const headRow = head.rows[head.rows.length - 1];
    // Nur sichtbarer Text: Ein Kopf, der bloss für Vorleser beschriftet ist (.vh), bleibt in der Karte leer.
    const labels = [...headRow.cells].map(th => { const k = th.cloneNode(true); k.querySelectorAll('.vh').forEach(v => v.remove()); return (k.textContent || '').trim(); });
    if (!labels.length) return;

    for (const body of table.tBodies) {
      for (const row of body.rows) {
        let col = 0;
        for (const cell of row.cells) {
          if (!cell.hasAttribute('data-label')) {
            cell.setAttribute('data-label', labels[col] || '');
          }
          // colspan berücksichtigen, sonst verrutschen alle folgenden Spalten
          col += cell.colSpan || 1;
        }
      }
    }
    table.dataset.labelled = '1';
  }

  /** Alle noch unbeschrifteten Tabellen unterhalb von root behandeln. */
  function labelAll(root) {
    const scope = root && root.querySelectorAll ? root : document;
    if (scope.matches && scope.matches('table.dt')) labelTable(scope);
    scope.querySelectorAll('table.dt:not([data-labelled])').forEach(labelTable);
  }

  // Die Listen werden per innerHTML gebaut, also beobachten wir Kindknoten.
  // characterData und attributes bewusst aus: Wir wollen nur neue Tabellen,
  // nicht jede Textänderung.
  const observer = new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) labelAll(node);
      }
    }
  });

  let started = false;
  function start() {
    if (started || !document.body) return;
    started = true;
    labelAll(document);
    observer.observe(document.body, { childList: true, subtree: true });
    bindNavAutoScroll();
  }

  // ── 2. Aktiven Reiter in den sichtbaren Bereich scrollen ────────────────

  function scrollActiveTabIntoView() {
    const nav = document.querySelector('nav');
    const active = /** @type {HTMLElement | null} */ (document.querySelector('.ntab.active'));
    if (!nav || !active) return;
    // Nur wenn die Leiste überhaupt scrollt — auf dem Desktop passiert nichts.
    if (nav.scrollWidth <= nav.clientWidth + 4) return;
    const target = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }

  function bindNavAutoScroll() {
    document.querySelectorAll('.ntab').forEach(tab => {
      if (tab._mobileScrollBound) return;
      tab._mobileScrollBound = true;
      // Nach dem bestehenden Klick-Handler laufen lassen, der .active setzt.
      tab.addEventListener('click', () => setTimeout(scrollActiveTabIntoView, 0));
    });
    // Beim Anzeigen der App (nach Login/Neuladen) einmal nachziehen.
    setTimeout(scrollActiveTabIntoView, 300);
  }

  // Bedingung ist das Vorhandensein von <body>, nicht der readyState: Das
  // Skript steht am Ende des Body, dort ist der Baum bereits da und die
  // Beschriftungen greifen noch vor dem ersten Paint. Auf DOMContentLoaded zu
  // warten wäre nicht nur unnötig spät — würde das Skript jemals NACH diesem
  // Ereignis geladen (nachträglich eingefügt, defer-Sonderfälle), liefe die
  // Initialisierung überhaupt nicht mehr an.
  start();
  if (!started) document.addEventListener('DOMContentLoaded', start);

  // ── 3. Rollende Abschnittsleiste der Einstellungen ──────────────────────
  // Am Telefon rollt sie seitwärts; ohne Hinweis am Rand sah niemand die
  // Abschnitte dahinter. data-mehr sagt dem CSS, auf welcher Seite noch etwas liegt.
  function randHinweis(nav) {
    const rechts = nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2;
    const links = nav.scrollLeft > 2;
    nav.dataset.mehr = (links ? 'l' : '') + (rechts ? 'r' : '');
  }
  const einstNav = document.querySelector('.einst-nav');
  if (einstNav) {
    einstNav.addEventListener('scroll', () => randHinweis(einstNav), { passive: true });
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => randHinweis(einstNav)).observe(einstNav);
  }

  // ── 4. Kopf beim Rollen nach unten ausblenden ───────────────────────────
  // Nur die Klasse; mobile.css blendet aus, und zwar nur bei geringer Höhe
  // (200 % Zoom, Querformat), wo Kopf, Band und Leiste fast die Hälfte belegen.
  // Rollen nach oben oder Fokus im Kopf holt ihn zurück.
  let letzteHoehe = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY, wurzel = document.documentElement;
    if (y < 60 || y < letzteHoehe - 4) wurzel.classList.remove('kopf-weg');
    else if (y > letzteHoehe + 4) wurzel.classList.add('kopf-weg');
    if (Math.abs(y - letzteHoehe) > 4) letzteHoehe = y;
  }, { passive: true });
  document.querySelector('header')?.addEventListener('focusin', () => document.documentElement.classList.remove('kopf-weg'));

  // Für Tests und für Code, der Tabellen ausserhalb des Observers erzeugt.
  window.__bimLabelTables = labelAll;
})();
