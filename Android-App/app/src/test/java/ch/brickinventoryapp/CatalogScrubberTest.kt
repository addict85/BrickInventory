package ch.brickinventoryapp

import org.junit.Test

/**
 * Die Jahres-Leiste im Katalog SPRINGT, sie filtert nicht.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 * „Im Katalog die Zeitleiste rechts anpassen. Diese soll nicht ein Filter sein,
 * sondern zum Schnellscrollen verwendet werden können, analog wie es in der
 * Android-Galerie-Foto-App der Fall ist." Dazu sein Hinweis auf die Umsetzung:
 * „Kann nicht geprüft werden, wo man hinscrollt, und dieser Teil wird dann
 * geladen. So macht dies soweit ich sehe auch die Foto-App von Google."
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
 *   • Der Platzhalter hat eine feste Höhe — sonst springt die Liste, sobald
 *     die Seite eintrifft, und der Sprung landet daneben.
 *   • Welches Jahr an einer Stelle liegt, rechnet der SERVER.
 *
 * Der ausdrückliche Jahresfilter (Chip und Auswahlblatt) bleibt: Marco wollte
 * die LEISTE anders, nicht das Filtern abschaffen.
 */
class CatalogScrubberTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()

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
        // Die Zielseite muss mitgeladen werden, sonst stehen dort Platzhalter.
        assert(aufruf.contains("onEnsurePage(")) {
            "Beim Rollen wird die Zielseite nicht mitgeladen"
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
        // Vorlauf in BEIDE Richtungen: (von - 1) .. (bis + 1)
        assert(Regex("""\(von - 1\)\.\.\(bis \+ 1\)""").containsMatchIn(s)) {
            "Es wird nur in eine Richtung nachgeladen — nach einem Sprung fehlt " +
                "alles oberhalb der Sprungstelle"
        }
        assert(s.contains("CatalogPlaceholderCard()")) { "Der Platzhalter fehlt" }
        assert(Regex("""CatalogPlaceholderCard[\s\S]{0,400}\.height\(""").containsMatchIn(s)) {
            "Der Platzhalter hat keine feste Höhe — die Liste springt, sobald die " +
                "Seite eintrifft, und der Sprung landet daneben"
        }
    }

    @Test
    fun `die Jahresverteilung rechnet der Server`() {
        val f = code(read("ui/viewmodel/CatalogViewModel.kt"))
        // Die App kennt immer nur die geladenen Seiten. Welches Jahr an einer
        // Stelle liegt, weiss nur die Datenbank — und beide Oberflaechen sollen
        // dieselbe Antwort bekommen.
        assert(f.contains("repo.admin.getCatalogYearVerteilung(")) {
            "Die App schaetzt die Jahreslage selbst — genau daran stand in der " +
                "Webapp „1965\", waehrend Sets von 1999 erschienen"
        }
        // Mit denselben Filtern wie die Liste, sonst zeigt das Etikett daneben.
        val i = f.indexOf("repo.admin.getCatalogYearVerteilung(")
        val aufruf = f.substring(i, minOf(i + 300, f.length))
        for (teil in listOf("q =", "themeId =", "sort =")) {
            assert(aufruf.contains(teil)) {
                "Die Verteilung wird ohne $teil geholt — mit gesetztem Filter laege sie daneben"
            }
        }
        // Und zur richtigen Liste: Wechselt der Filter waehrend des Abrufs,
        // gehoert die Antwort zu einer Liste, die es nicht mehr gibt.
        val fn = Quellen.funktion(f, "fun ladeJahrVerteilung(")
        assert(fn.isNotEmpty()) { "ladeJahrVerteilung fehlt" }
        assert(fn.contains("gen != catalogGeneration")) {
            "Ohne Filter-Generation landet die Verteilung des ALTEN Filters in der neuen Liste"
        }
        // Das Rollziel muss wieder zurueckgesetzt werden.
        assert(f.contains("fun catalogScrollConsumed()")) {
            "Ohne Zuruecksetzen liesse sich dieselbe Stelle kein zweites Mal anfahren"
        }
    }

    @Test
    fun `eine Seite wird nicht mehrfach geladen`() {
        // Beim Scrollen kommt derselbe Bereich vielfach vorbei. Ohne diese
        // Prüfung löste jeder Schritt denselben Abruf erneut aus.
        val f = code(read("ui/viewmodel/CatalogViewModel.kt"))
        // Funktionsrumpf statt 700 fester Zeichen (Nachtrag 115) — siehe Quellen.kt.
        val fn = Quellen.funktion(f, "fun ensureCatalogPage(")
        assert(fn.isNotEmpty()) { "ensureCatalogPage fehlt" }
        assert(fn.contains("loadedPages.containsKey(seite)") && fn.contains("loadingPages.contains(seite)")) {
            "Bereits geladene oder ladende Seiten werden nicht übersprungen"
        }
        assert(fn.contains("catalogGeneration")) {
            "Ohne Filter-Generation landet eine späte Seite des ALTEN Filters in der neuen Liste"
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
        val u = code(read("ui/UiState.kt"))
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

        // Und beim FILTERWECHSEL muss sie zurückgesetzt werden: Die alte
        // Position zeigte sonst auf Sets, die es in der neuen Liste nicht gibt.
        val f = code(read("ui/viewmodel/CatalogViewModel.kt"))
        val block = Quellen.funktion(f, "fun loadCatalogSets(")
        assert(block.isNotEmpty()) { "loadCatalogSets fehlt" }
        assert(block.contains("scrollIndex = 0")) {
            "Beim Neuaufbau der Liste bleibt die alte Rollposition stehen"
        }
    }
}
