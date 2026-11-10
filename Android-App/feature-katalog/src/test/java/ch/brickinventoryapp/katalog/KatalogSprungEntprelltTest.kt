package ch.brickinventoryapp.katalog

import ch.brickinventoryapp.katalog.ui.CatalogYearMath
import ch.brickinventoryapp.data.repository.CATALOG_PAGE_SIZE
import ch.brickinventoryapp.katalog.ui.viewmodel.SICHTFENSTER_RUHE_MS
import ch.brickinventoryapp.katalog.ui.viewmodel.Sichtfensterlader
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

/**
 * Ein Zug an der Jahresleiste holt EINE Seite, nicht hundert.
 *
 * ── Was gemessen wurde, bevor etwas geaendert wurde ─────────────────────────
 * Zuerst war die Datenbank verdaechtig — ein `ORDER BY year DESC … LIMIT 60
 * OFFSET <gross>` wird bei grossen Spruengen teuer. An 25'000 Sets mit
 * realistischer Jahresverteilung nachgemessen: Seite 1 braucht 1,0 ms, die
 * Mitte 9,2 ms, das Ende 19,9 ms, der COUNT(*) je Seite 1,8 ms. Selbst der
 * schlechteste Fall bleibt weit unter einer Sekunde. Die Sekunden kommen NICHT
 * von dort — und die Webapp springt mit derselben Datenbank sofort.
 *
 * ── Die Ursache, und mein eigener Fehlgriff dabei ───────────────────────────
 * Es gibt ZWEI Wege, auf denen eine Seite angefordert wird:
 *
 *   1. der Rueckruf der Leiste (`onScrollTo`) — er laeuft bei jedem
 *      Beruehrungspunkt;
 *   2. der Sichtfenster-Lader — er laeuft, wann immer sich das sichtbare
 *      Fenster aendert.
 *
 * Beide Wege werden entprellt, auch Weg 2: Die Leiste ROLLT die Liste wirklich
 * an jede Zwischenposition (ihr Rueckruf setzt ueber `state.scrollTo` ein
 * `gridState.scrollToItem`). Weg 2 sah damit jeden einzelnen Punkt des Zuges
 * und forderte dort sonst drei Seiten an.
 *
 * Die Ruhe steht jetzt im Sichtfenster-Lader. Sie deckt beide Wege ab, denn
 * beide enden dort. Genau so macht es die Webapp seit jeher
 * (js/09-catalog.js, `_ladeSichtbareSeiten`, 150 ms) — und genau deshalb ist
 * die Webapp schnell.
 *
 * ── Wie geprueft wird ───────────────────────────────────────────────────────
 * Die Ruhe steht seit arch14 (M1) im ViewModel (Sichtfensterlader) und laeuft
 * hier mit StandardTestDispatcher: ein Zug mit hundert Fenstern, virtuelle Zeit,
 * gezaehlte Abrufe. Dass die Leiste selbst nicht laedt, bleibt am Quelltext.
 *
 * Gegenproben:
 *   A  `collectLatest` durch `collect` ersetzt
 *      (gegenproben/sichtfenster-ohne-entprellung.patch) → rot „der
 *      Sichtfenster-Lader wartet …“ (jedes Fenster des Zuges wird geladen)
 *   B  `delay(ruheMs)` entfernt → rot, derselbe Fall (laedt vor der Ruhe)
 *   C  den Vorlauf `(von - 1)..(bis + 1)` auf `von..bis` verkuerzt → rot, derselbe Fall
 */
class KatalogSprungEntprelltTest {

    @Test
    fun `ein Zug ueber die Leiste beruehrt sehr viele Seiten`() {
        // Ein gewoehnliches Telefon: Leiste ueber die volle Hoehe, Griff 36dp
        // bei dreifacher Dichte. Der Katalog hat rund 25'000 Sets.
        val hoehe = 1800
        val griff = 108
        val total = 25_000

        // Jeder Pixel, den der Finger auf dem Weg von oben nach unten
        // ueberstreicht — genau die Punkte, an denen die Liste weitergerollt
        // wird und der Sichtfenster-Lader ein neues Fenster sieht.
        val seiten = (0..hoehe).map { y ->
            val anteil = CatalogYearMath.anteilAus(y.toFloat(), hoehe, griff)
            CatalogYearMath.nummerAus(anteil, total) / CATALOG_PAGE_SIZE + 1
        }.toSet()

        // GEMESSEN, nicht behauptet: Der Weg beruehrt JEDE Seite des Katalogs
        // — 417 von 417. Auf 1692 Pixeln Spur liegen 25'000 Sets, also rund
        // 15 je Pixel; eine Seitengrenze wird demnach alle vier Pixel
        // ueberschritten.
        //
        // Wie viele Abrufe daraus WERDEN, entscheidet die Zahl der
        // Beruehrungspunkte: Zwei aufeinanderfolgende liegen bei jeder
        // gewoehnlichen Zuggeschwindigkeit weiter als vier Pixel auseinander,
        // also trifft praktisch jeder eine andere Seite. Bei 60 bis 120
        // Punkten je Sekunde sind das ueber hundert Abrufe fuer einen Zug —
        // jeder ueber 60 Sets, keiner abgebrochen, und der API-Client laesst
        // nur eine Handvoll gleichzeitig zu. Die Zielseite steht dann hinter
        // allen anderen in der Schlange: drei bis fünf Sekunden.
        val gesamtSeiten = (total - 1) / CATALOG_PAGE_SIZE + 1
        assert(seiten.size >= gesamtSeiten - 1) {
            "Der Weg beruehrt nur ${seiten.size} von $gesamtSeiten Seiten. Dann " +
                "waere die Entprellung die falsche Behebung, und die Ursache laege " +
                "woanders — nachrechnen, bevor hier eine Zahl angepasst wird."
        }
        assert(gesamtSeiten > 100) { "Katalog zu klein fuer diese Aussage — Rechnung veraltet?" }
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `der Sichtfenster-Lader wartet, bis die Liste ruhig steht`() = runTest {
        val geladen = mutableListOf<Int>()
        val bereich = CoroutineScope(StandardTestDispatcher(testScheduler))
        val lader = Sichtfensterlader(bereich, SICHTFENSTER_RUHE_MS) { geladen += it }
        // Ein Zug ueber die Leiste: hundert Fenster, alle 10 ms eines, Seite fuer Seite.
        for (seite in 1..100) {
            lader.sichtbar(seite, seite + 1)
            advanceTimeBy(10)
        }
        assertEquals("Waehrend des Zuges wird nichts geladen", emptyList<Int>(), geladen)
        advanceUntilIdle()
        assertEquals("Nur das letzte Fenster, mit einer Seite Vorlauf in beide Richtungen",
            listOf(99, 100, 101, 102), geladen)
        // Seite 1 hat keinen Vorgaenger: kein Abruf fuer Seite 0.
        geladen.clear()
        lader.sichtbar(1, 1)
        advanceUntilIdle()
        assertEquals(listOf(1, 2), geladen)
        bereich.cancel()
    }

    @Test
    fun `die Leiste rollt nur und laedt nicht selbst`() {
        val src = Quellen.ohneKommentare(Quellen.bildschirm("katalog/ui/screens/CatalogScreen.kt"))

        val ab = src.indexOf("onScrollTo = ")
        assert(ab > 0) { "Der Rueckruf der Jahresleiste ist nicht mehr zu finden" }
        val rueckruf = src.substring(ab, minOf(ab + 200, src.length))
        assert(!rueckruf.contains("onEnsurePage")) {
            "Die Leiste laedt wieder bei JEDEM Beruehrungspunkt. Das sind ueber " +
                "hundert Abrufe je Zug (siehe die Messung im ersten Test)."
        }

        // Und kein zweiter, eigener Sprung-Abruf daneben: Der stand hier
        // einmal (`zielSeite` samt eigenem LaunchedEffect) und war die
        // Behebung an der falschen Schicht — er nahm dem Rueckruf seinen
        // Abruf, liess den Sichtfenster-Lader aber unveraendert weiterlaufen.
        // Zwei Fassungen derselben Regel laufen ausserdem auseinander.
        assert(!src.contains("zielSeite")) {
            "Der eigene Sprung-Abruf ist wieder da. Er ist ueberfluessig, seit die " +
                "Ruhe im Sichtfenster-Lader steht — dort enden BEIDE Wege."
        }
    }
}
