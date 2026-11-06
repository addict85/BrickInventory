package ch.brickinventoryapp

import org.junit.Test
import java.io.File

/**
 * Die Jahres-Leiste im Katalog SPRINGT, sie filtert nicht.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 * „Im Katalog die Zeitleiste rechts anpassen. Diese soll nicht ein Filter sein,
 * sondern zum Schnellscrollen verwendet werden können, analog wie es in der
 * Android-Galerie-Foto-App der Fall ist." Dazu sein Hinweis auf die Umsetzung:
 *
 * ── Warum das die Liste umbaut ──────────────────────────────────────────────
 * Vorher hing die Liste am Endlos-Scroll: Seite 1, 2, 3 … angehängt. Wer auf
 * Jahr 2005 springt, landet mitten im Bestand — und mit einer angehängten Liste
 * gibt es dort schlicht nichts, weder davor noch danach.
 *
 * Die Ansicht führt deshalb ALLE `total` Plätze und lädt die Seite, auf der ein
 * sichtbar gewordener Platz liegt — vorwärts, rückwärts und nach einem Sprung.
 * Was noch nicht da ist, steht als Platzhalter.
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 * Die REGELN, nicht das Aussehen:
 *   • Die Leiste rollt die Liste, sie filtert nicht.
 *   • Die Liste zählt über `total`, nicht über die geladene Teilmenge.
 *   • Geladen wird in BEIDE Richtungen.
 *
 * Der ausdrückliche Jahresfilter (Chip und Auswahlblatt) bleibt: Marco wollte
 * die LEISTE anders, nicht das Filtern abschaffen.
 */
class CatalogScrubberTest {

    private fun read(rel: String) =
        File(Quellen.wurzel, "$rel").readText()

    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `die Leiste rollt, statt zu filtern`() {
        val s = code(read("ui/screens/CatalogScreen.kt"))
        val i = s.indexOf("YearScrubber(")
        assert(i > 0) { "die Leiste fehlt ganz" }
        val aufruf = s.substring(i, minOf(i + 700, s.length))
        // Seit Marcos Vorgabe „die gleiche Leiste wie die Webapp" rollt sie an
        // eine STELLE, statt auf das erste Set eines Jahres zu springen. Der
        // Unterschied zum Filter bleibt derselbe: Ein Filter wirft die anderen
        // Jahre weg, ein Rollen laesst sie stehen.
        assert(aufruf.contains("onScrollTo = ")) {
            "Die Leiste rollt die Liste nicht — dann ist sie wieder ein Filter " +
                "oder ein Sprung, aber nicht die Leiste der Webapp"
        }
        assert(!aufruf.contains("onYearSelected") && !aufruf.contains("selectedYear")) {
            "Die Leiste haengt wieder am Jahr statt an der Stelle in der Liste"
        }
        // Was an der neuen Stelle gebraucht wird, holt der Sichtfenster-Lader.
        //
        // Hier stand zuerst `onEnsurePage(` — der Abruf also unmittelbar im
        // Rueckruf der Leiste, der bei JEDEM Beruehrungspunkt laeuft. Danach
        // stand hier `zielSeite =`, ein gemerktes Sprungziel mit eigenem,
        // entprelltem Abruf. Auch das war die falsche Schicht: Die Leiste
        // rollt die Liste wirklich an jede Zwischenposition, und der
        // Sichtfenster-Lader forderte dort unveraendert weiter Seiten an.
        //
        // Jetzt reicht der Rueckruf nur noch die Stelle weiter, und die Ruhe
        // steht im Sichtfenster-Lader — dort enden beide Wege. Die Regel dazu
        // steht MIT der Messung in KatalogSprungEntprelltTest, nicht hier noch
        // einmal; an dieser Stelle bleibt nur, dass hier NICHT geladen wird.
        assert(!aufruf.contains("onEnsurePage")) {
            "Die Leiste laedt wieder selbst — das ist ein Abruf je " +
                "Beruehrungspunkt, siehe KatalogSprungEntprelltTest"
        }
        // Der ausdrückliche Filter bleibt.
        assert(s.contains("onYearChange")) {
            "Der Jahresfilter (Chip und Auswahlblatt) darf nicht mit verschwunden sein"
        }
    }

    @Test
    fun `die Liste fuehrt alle Plaetze und laedt in beide Richtungen`() {
        val s = code(read("ui/screens/CatalogScreen.kt"))
        assert(s.contains("items(count = state.total")) {
            "Die Liste zählt über die geladene Teilmenge statt über das ganze Ergebnis — " +
                "dann gibt es an der Sprungstelle nichts"
        }
        assert(s.contains("state.loadedPages[seite]")) {
            "Die Plätze werden nicht aus den geladenen Seiten bedient"
        }
        // Den Vorlauf in beide Richtungen prüft KatalogSprungEntprelltTest ausgeführt
        // am Sichtfensterlader (Seiten 99..102 für das Fenster 100..101).
        assert(s.contains("CatalogPlaceholderCard()")) { "Der Platzhalter fehlt" }
        assert(Regex("""CatalogPlaceholderCard[\s\S]{0,400}\.height\(""").containsMatchIn(s)) {
            "Der Platzhalter hat keine feste Höhe — die Liste springt, sobald die " +
                "Seite eintrifft, und der Sprung landet daneben"
        }
    }

    @Test
    fun `die Rollposition ueberlebt den Wechsel zur Detailseite`() {
        // ── Marcos Befund ───────────────────────────────────────────────────
        // „Wenn im Katalog eine Detailseite aufgerufen und wieder geschlossen
        // wird, ist der Scrollbalken ganz zuoberst und nicht an der Stelle von
        // vor dem Aufruf."
        //
        // Die Position lag im LazyGridState des Bildschirms. Die Detailseite
        // ist ein EIGENER Navigationspunkt — beim Wechsel verlässt die Liste
        // die Komposition. Bei einer Liste, deren Länge (`total`) und Inhalt
        // (`loadedPages`) erst nachträglich eintreffen, hilft auch Compose'
        // Wiederherstellung nicht: Sind im Moment der Wiederherstellung noch
        // keine Plätze da, gibt es keine Stelle, an die gesprungen werden
        // könnte.
        //
        // Deshalb liegt sie im ZUSTAND — der lebt im ViewModel und überlebt
        // jeden Wechsel des Bildschirms.
        val u = code(read("ui/ZustandKatalog.kt"))
        assert(u.contains("val scrollIndex: Int = 0") && u.contains("val scrollOffset: Int = 0")) {
            "Der Katalog-Zustand merkt sich die Rollposition nicht"
        }

        val s = code(read("ui/screens/CatalogScreen.kt"))
        // Laufend melden …
        assert(s.contains("gridState.firstVisibleItemIndex to gridState.firstVisibleItemScrollOffset")) {
            "Die Ansicht meldet ihre Rollposition nicht"
        }
        assert(s.contains("onScrollPos(index, offset)")) { "Die Meldung erreicht das ViewModel nicht" }
        // … und beim Betreten EINMAL zurückspringen, sobald die Länge da ist.
        assert(Regex("""LaunchedEffect\(state\.total\)""").containsMatchIn(s)) {
            "Die Wiederherstellung hängt nicht an state.total — vor dem Eintreffen " +
                "der Länge gibt es keine Stelle, an die gesprungen werden könnte"
        }
        assert(s.contains("wiederhergestellt")) {
            "Ohne Merker würde bei jeder Änderung von total erneut gesprungen — " +
                "auch mitten im Scrollen"
        }
        // Das Zurücksetzen beim Filterwechsel und „jede Seite einmal“ prüft
        // CatalogViewModelTest (feature-katalog) am ausgeführten ViewModel.
    }
}
