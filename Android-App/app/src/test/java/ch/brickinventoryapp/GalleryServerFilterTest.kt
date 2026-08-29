package ch.brickinventoryapp

import org.junit.Test

/**
 * Galerie: Suchen, Filtern, Sortieren und Blättern macht der SERVER.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 * „Beide Apps sollen den Filter auf dem Server anwenden. Passt zur vorherigen
 * Frage, dass Logiken immer zentral sein sollen und nicht doppelt
 * implementiert werden. UIs sollen nur das Rendering übernehmen."
 *
 * ── Was vorher war ──────────────────────────────────────────────────────────
 * Die App holte ALLE Sets und filterte im Gerät. Das war eine zweite Fassung
 * der Suche neben der des Servers — und sie konnte weniger:
 *
 *   • kein Jahr im Suchtext (die Webapp findet mit „2019" die Sets des Jahres)
 *   • gar keine Sortierung (die Webapp bietet neun Möglichkeiten)
 *   • die Themenliste entstand aus der GELADENEN Liste statt aus dem Bestand
 *
 * Der Test hält die Regel fest, nicht das Aussehen: Der Schirm bekommt Werte
 * und meldet Änderungen, er rechnet nicht. Das ist die Aussage, die beim
 * nächsten Umbau zählt — ein „schnelles" lokales Filtern wäre sofort wieder
 * die zweite Fassung.
 *
 * Gegenprobe (durchgeführt): in GalleryScreen wieder ein `sets.filter { … }`
 * eingesetzt → der erste Teilschritt wird rot.
 */
class GalleryServerFilterTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()

    /** Kommentare ausblenden — die Erklärtexte nennen die geprüften Muster selbst. */
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `der Schirm filtert und sortiert die Liste nicht selbst`() {
        val s = code(read("ui/screens/GalleryScreen.kt"))
        for (muster in listOf("sets.filter", "sets.sortedBy", "sets.sortedWith", "sets.mapNotNull")) {
            assert(!s.contains(muster)) {
                "GalleryScreen bearbeitet die Liste selbst ($muster) — damit gibt es " +
                    "wieder zwei Fassungen der Suche, und die hier kann weniger"
            }
        }
        assert(!s.contains("debouncedQuery")) {
            "Die Entprellung gehört ins ViewModel, wo auch der Abruf und die " +
                "Filter-Generation liegen — sonst filtert der Schirm doch wieder mit"
        }
    }

    @Test
    fun `Suchtext, Thema und Sortierung werden nach oben gemeldet`() {
        val s = code(read("ui/screens/GalleryScreen.kt"))
        for (r in listOf("onQueryChange", "onThemeChange", "onSortChange", "onLoadMore")) {
            assert(s.contains(r)) { "Rückruf $r fehlt — der Wert käme nie beim Server an" }
        }
        // Die Themen kommen vom Server, NICHT aus der geladenen Seite —
        // abgeleitet schrumpfte die Liste beim Blaettern.
        //
        // Frueher stand die Regel als Parameter `themes: List<String>` im
        // Bildschirm. Seit die Bildschirme ihren Zustand selbst abholen
        // (Nachtrag 96/115) ist es ein Feld: `state.galleryThemes`. Geprueft
        // wird deshalb die ABSICHT — Herkunft Zustand, keine eigene Ableitung
        // aus `sets` — statt der damaligen Schreibweise.
        assert(s.contains("state.galleryThemes")) {
            "Die Themenliste kommt nicht mehr aus dem Zustand (state.galleryThemes)"
        }
        assert(!Regex("""themes[^\n]*=[^\n]*\bsets\b""").containsMatchIn(s)) {
            "Die Themenliste wird aus `sets` abgeleitet — dann schrumpft sie beim Blättern"
        }
    }

    @Test
    fun `die Sortierwerte sind die des Servers`() {
        val s = code(read("ui/screens/GalleryScreen.kt"))
        // Genau die Schlüssel aus SET_SORTS (utils/handlers.ts). Ein Wert, den
        // der Server nicht kennt, fiele dort still auf die Vorgabe zurück —
        // die Sortierung sähe aus, als täte sie nichts.
        for (w in listOf("added_desc", "added_asc", "name_asc", "num_asc",
                         "year_desc", "price_desc", "price_asc", "qty_desc", "qty_asc")) {
            assert(s.contains("\"$w\"")) { "Sortierwert $w fehlt in der Auswahl" }
        }
    }

    @Test
    fun `das ViewModel schickt die Filter mit und blaettert seitenweise`() {
        val f = code(read("ui/GalleryFeature.kt"))
        assert(f.contains("search = ") && f.contains("theme = ") && f.contains("sort = ")) {
            "loadSets reicht die Filter nicht durch — der Server bekäme sie nie zu sehen"
        }
        assert(f.contains("loadMoreSets")) { "Endlos-Scroll fehlt" }
        // Generationszähler: Ohne ihn hängt eine späte Seite 2 des ALTEN
        // Filters an der neuen Liste — gemischter Inhalt und doppelte
        // Schlüssel im Raster. Dieselbe Falle wie im Katalog.
        assert(f.contains("galleryGeneration")) {
            "Ohne Filter-Generation landen Antworten eines alten Filters in der neuen Liste"
        }
        assert(f.contains("delay(350)")) {
            "Ohne Entprellung löst jeder Tastendruck eine Abfrage aus"
        }
    }

    @Test
    fun `der Ablage-Cache greift nur ungefiltert`() {
        // Sonst läge die Antwort eines Filters unter demselben Schlüssel wie
        // die volle Sicht, und nach einem Neustart erschiene der falsche
        // Bestand. Dieselbe Regel wie beim Kontofilter (Haushalt).
        val r = code(read("data/repository/BrickRepository.kt"))
        // Funktionsrumpf statt 1400 fester Zeichen (Nachtrag 115) — siehe Quellen.kt.
        val block = Quellen.funktion(r, "suspend fun getSets(")
        assert(block.isNotEmpty()) { "getSets fehlt" }
        assert(block.contains("cached(\"sets\"")) { "der Cache ist ganz weg" }
        assert(block.contains("ungefiltert")) {
            "Der Cache-Zweig prüft nicht mehr, ob überhaupt ungefiltert abgerufen wird"
        }
    }
}
