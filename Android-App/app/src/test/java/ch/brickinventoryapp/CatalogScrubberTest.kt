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
 *   • Die Leiste ruft den Sprung auf, nicht den Jahresfilter.
 *   • Die Liste zählt über `total`, nicht über die geladene Teilmenge.
 *   • Geladen wird in BEIDE Richtungen.
 *   • Der Platzhalter hat eine feste Höhe — sonst springt die Liste, sobald
 *     die Seite eintrifft, und der Sprung landet daneben.
 *   • Wohin gesprungen wird, rechnet der SERVER.
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
    fun `die Leiste springt, statt zu filtern`() {
        val s = code(read("ui/screens/CatalogScreen.kt"))
        val i = s.indexOf("YearScrubber(")
        assert(i > 0) { "die Leiste fehlt ganz" }
        val aufruf = s.substring(i, minOf(i + 400, s.length))
        assert(aufruf.contains("onYearSelected = onJumpToYear")) {
            "Die Leiste ruft weiter den Jahresfilter — dann wirft sie die anderen " +
                "Jahre weg, statt nur hinzuspringen"
        }
        assert(!aufruf.contains("selectedYear")) {
            "Ein dauerhaft markiertes Jahr gibt es nicht mehr — die Leiste filtert nicht"
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
    fun `das Sprungziel rechnet der Server`() {
        val f = code(read("ui/viewmodel/CatalogViewModel.kt"))
        assert(f.contains("repo.admin.getCatalogYearOffset(")) {
            "Die App rechnet das Sprungziel selbst — sie kennt aber nur die " +
                "geladenen Seiten und kann es gar nicht wissen"
        }
        // Mit denselben Filtern wie die Liste, sonst zielt der Sprung daneben.
        val i = f.indexOf("repo.admin.getCatalogYearOffset(")
        val aufruf = f.substring(i, minOf(i + 300, f.length))
        for (teil in listOf("q =", "themeId =", "sort =")) {
            assert(aufruf.contains(teil)) {
                "Der Sprung rechnet ohne $teil — mit gesetztem Filter läge er daneben"
            }
        }
        // Zielseite gleich mitladen, sonst stehen an der Sprungstelle Platzhalter.
        assert(f.contains("ensureCatalogPage(r.data.page)")) {
            "Die Zielseite wird nicht vorgeladen"
        }
        // Und das Ziel muss wieder zurückgesetzt werden.
        assert(f.contains("fun catalogScrollConsumed()")) {
            "Ohne Zurücksetzen liesse sich dasselbe Jahr kein zweites Mal anspringen"
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
