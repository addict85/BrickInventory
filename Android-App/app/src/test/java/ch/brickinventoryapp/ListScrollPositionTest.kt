package ch.brickinventoryapp

import org.junit.Test

/**
 * Der Scroll-Zustand einer Liste überlebt den Abstecher in eine Detailansicht.
 *
 * ── Marcos Bericht (Nachtrag 92) ────────────────────────────────────────────
 * „In der Android-App springt der Scrollbalken immer ganz nach oben, wenn man
 * die Detailseite eines Sets öffnet und wieder schliesst. Der Scrollbalken
 * sollte aber an der Position verbleiben, wo er vorher war."
 *
 * Die Detailansicht ist ein eigenes Navigationsziel. Beim Wechsel verlässt die
 * darunterliegende Liste die Komposition, und ein `rememberLazyGridState()`
 * INNERHALB des Ziels beginnt bei der Rückkehr wieder bei null.
 *
 * ── Warum das ein Familienfehler war ────────────────────────────────────────
 * Für die FINANZ-Liste war es längst gelöst: `financeListState` liegt oberhalb
 * des NavHost und wird durchgereicht, samt Begründung im Code. Der KATALOG hat
 * es auf einem eigenen Weg gelöst — er meldet die Position laufend ins
 * ViewModel und springt einmal zurück, sobald die Liste ihre Länge hat (nötig,
 * weil er seitenweise nachlädt und die Länge erst später eintrifft).
 *
 * Galerie, Teile und Minifiguren führen genauso in eine Detailansicht, hatten
 * aber weder das eine noch das andere — bei den Minifiguren gab es nicht
 * einmal einen benannten Zustand, `LazyVerticalGrid` legte sich intern selbst
 * einen an.
 *
 * Wieder das Muster dieses Projekts: eine Regel fehlt am zweiten Weg. Dieser
 * Test prüft deshalb nicht die eine gemeldete Stelle, sondern ALLE Listen, die
 * in ein Detail führen — die nächste neue soll hier auffallen.
 *
 * Gegenproben (durchgeführt): `gridState`-Parameter aus GalleryScreen entfernt
 * und wieder lokal angelegt → erster Teilschritt rot; die Übergabe in
 * CollectionGraph gestrichen → zweiter Teilschritt rot.
 */
class ListScrollPositionTest {

    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /**
     * Kommentare ausblenden. Ohne das hält der eigene Erklärtext die Prüfung
     * grün — die Begründungen oben nennen `rememberLazyGridState()` mehrfach
     * beim Namen, genau das Muster, nach dem hier gesucht wird.
     */
    private fun code(src: String) = src.lines()
        .joinToString("\n") { val t = it.trim(); if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else it }

    /** Raster-Reiter, die den Zustand von aussen bekommen. */
    private val raster = listOf(
        "ui/screens/GalleryScreen.kt",
        "ui/screens/PartsScreen.kt",
        "ui/screens/MinifigsScreen.kt",
    )

    /** Listen-Reiter, dasselbe mit LazyColumn. */
    private val spalten = listOf(
        "ui/screens/FinanceScreen.kt",
        "ui/screens/PartsListScreen.kt",
    )

    @Test
    fun `keine Liste legt ihren Scroll-Zustand selbst an`() {
        for (datei in raster) {
            val src = code(read(datei))
            assert(!src.contains("val gridState = rememberLazyGridState()")) {
                "$datei legt den Scroll-Zustand im Ziel selbst an. Beim Öffnen der " +
                    "Detailansicht wird das Ziel verworfen — bei der Rückkehr springt " +
                    "die Liste dann nach oben. Der Zustand gehört oberhalb des NavHost."
            }
            assert(src.contains("gridState: LazyGridState = rememberLazyGridState()")) {
                "$datei nimmt keinen Scroll-Zustand von aussen entgegen"
            }
        }
    }

    @Test
    fun `das Raster benutzt den uebergebenen Zustand auch`() {
        // Ein Parameter, der nirgends ankommt, ist schlimmer als keiner: Die
        // Signatur verspricht dann etwas, das nicht passiert. Bei den
        // Minifiguren war genau das der Ausgangszustand — dort stand am
        // LazyVerticalGrid gar kein `state`.
        for (datei in raster) {
            val src = code(read(datei))
            assert(src.contains("state = gridState")) {
                "$datei reicht den Zustand nicht an sein LazyVerticalGrid durch"
            }
        }
    }

    @Test
    fun `auch die Listen-Reiter bekommen ihren Zustand von aussen`() {
        // Finanzen hatte es seit jeher, die Teileliste nicht — dort führt der
        // Weg zum Barcode-Scanner aus dem Bildschirm HERAUS. Dass dieser
        // Bildschirm dabei verlassen wird, war seit Nachtrag 64 bekannt (damals
        // verschwanden die gesammelten Sets); nur die Rollposition hatte
        // niemand nachgezogen.
        for (datei in spalten) {
            val src = code(read(datei))
            assert(!src.contains("val listState = rememberLazyListState()")) {
                "$datei legt den Scroll-Zustand im Ziel selbst an"
            }
            assert(src.contains("listState: LazyListState = rememberLazyListState()")) {
                "$datei nimmt keinen Scroll-Zustand von aussen entgegen"
            }
            assert(src.contains("state = listState")) {
                "$datei reicht den Zustand nicht an seine LazyColumn durch"
            }
        }
    }

    @Test
    fun `jeder Reiter mit Rollbereich ist abgedeckt`() {
        // ── Warum diese Prüfung existiert (Nachtrag 94) ─────────────────────
        //
        // Marco musste dreimal melden: erst die Galerie, dann der Katalog, dann
        // „bei ALLEN Reitern". Jedes Mal hatte ich genau das repariert, was
        // gemeldet war, statt die Reiter einmal durchzuzählen.
        //
        // Diese Prüfung zählt sie. Kommt ein Reiter dazu, der scrollt und in
        // eine Detailansicht führt, wird sie rot, bis er hier eingetragen ist.
        val abgedeckt = raster + spalten + listOf("ui/screens/CatalogScreen.kt")
        val ohneRollbereich = listOf("ui/screens/ComparisonScreen.kt")

        val alleReiter = abgedeckt + ohneRollbereich
        assert(alleReiter.size == 7) {
            "Die App hat sieben Reiter; hier stehen ${alleReiter.size}. Wurde einer " +
                "hinzugefügt, gehört er in `abgedeckt` — oder, wenn er nichts zu " +
                "rollen hat, in `ohneRollbereich`."
        }

        // Wer in `ohneRollbereich` steht, darf auch wirklich keinen haben.
        for (datei in ohneRollbereich) {
            val src = code(read(datei))
            assert(!src.contains("LazyColumn") && !src.contains("LazyVerticalGrid") &&
                   !src.contains("verticalScroll")) {
                "$datei hat inzwischen einen Rollbereich und gehört zu den abgedeckten"
            }
        }
    }

    @Test
    fun `die Zustaende liegen oberhalb des NavHost und werden durchgereicht`() {
        val nav = code(read("AppNavigation.kt"))
        for (name in listOf("galleryGridState", "partsGridState", "minifigsGridState")) {
            assert(nav.contains("val $name")) {
                "$name wird nicht oberhalb des NavHost angelegt — dort ist die einzige " +
                    "Ebene, die beim Navigieren nicht verlassen wird"
            }
        }
        val graph = code(read("nav/CollectionGraph.kt"))
        for (paar in listOf(
            "gridState = galleryGridState",
            "gridState = partsGridState",
            "gridState = minifigsGridState",
        )) {
            assert(graph.contains(paar)) { "CollectionGraph übergibt `$paar` nicht" }
        }

        for (name in listOf("financeListState", "partsListState")) {
            assert(nav.contains("val $name")) { "$name wird nicht oberhalb des NavHost angelegt" }
        }
        val tools = code(read("nav/ToolsGraph.kt"))
        for (paar in listOf("listState = financeListState", "listState = partsListState")) {
            assert(tools.contains(paar)) { "ToolsGraph übergibt `$paar` nicht" }
        }
    }

    @Test
    fun `jeder Reiter stellt seine Position ausdruecklich wieder her`() {
        // ── Warum das hochgezogene Objekt nicht reichte (Nachtrag 95) ───────
        //
        // In 92/94 lag der Zustand oberhalb des NavHost — das Objekt überlebt
        // den Ausflug, also sollte auch die Position überleben. Marcos Befund
        // war ein anderer: „in der Galerie ist sie verschoben" — nicht oben,
        // aber auch nicht dort, wo sie war. Der Zustand überlebt, nur misst das
        // Raster beim Wiederanhängen nicht dieselbe Stelle heraus.
        //
        // Nachweislich richtig landet der Weg des Katalogs: mitschreiben und
        // beim Betreten ausdrücklich scrollToItem() rufen („im Katalog ist sie
        // auf der korrekten Zeile"). Den nimmt jetzt jeder Reiter — einmal
        // umgesetzt in ScrollMemory.kt statt dreimal abgeschrieben.
        val col = code(read("nav/CollectionGraph.kt"))
        val tools = code(read("nav/ToolsGraph.kt"))
        for (schluessel in listOf("\"gallery\"", "\"parts\"", "\"minifigs\"")) {
            assert(col.contains("ScrollPositionKeeper(") && col.contains(schluessel)) {
                "Für $schluessel wird die Position nicht ausdrücklich wiederhergestellt"
            }
        }
        assert(tools.contains("ScrollPositionKeeper(") && tools.contains("\"finance\"")) {
            "Die Finanz-Liste stellt ihre Position nicht ausdrücklich wieder her"
        }

        // Und die beiden Fallen aus Nachtrag 93 dürfen im gemeinsamen Helfer
        // nicht wieder auftauchen.
        val helfer = code(read("ui/ScrollMemory.kt"))
        assert(!helfer.contains("rememberSaveable")) {
            "Der Merker im Helfer ist `rememberSaveable` — dann überlebt er den " +
                "Ausflug und schaltet die Wiederherstellung dauerhaft ab"
        }
        assert(helfer.contains("if (!wiederhergestellt) return@LaunchedEffect")) {
            "Der Melder läuft los, bevor zurückgesprungen wurde — er überschreibt " +
                "dann die gemerkte Position mit der Null des frischen Zustands"
        }
        val ersterSprung = helfer.indexOf("scrollToItem")
        val ersterMerker = helfer.indexOf("wiederhergestellt = true")
        assert(ersterSprung in 0 until ersterMerker) {
            "Der Merker steht vor dem Sprung statt danach"
        }

        // Ein Filterwechsel muss die gemerkte Stelle verwerfen: Sie zeigt sonst
        // auf Sets, die in der neuen Liste woanders oder gar nicht stehen.
        val gal = code(read("ui/GalleryFeature.kt"))
        for (fn in listOf("setGalleryQuery", "setGalleryTheme", "setGallerySort")) {
            // Funktionsrumpf statt eines festen Zeichenfensters (Nachtrag
            // 115): Ein Absatz Erklärung mehr über der Fundstelle schob die
            // gesuchte Zeile sonst aus dem Fenster. Siehe Quellen.kt.
            val rumpf = Quellen.funktion(gal, "fun MainViewModel.$fn(")
            assert(rumpf.isNotEmpty()) { "$fn fehlt" }
            assert(rumpf.contains("scrollMemory.vergiss")) {
                "$fn verwirft die gemerkte Rollposition nicht"
            }
        }
    }

    @Test
    fun `der Griff der Jahresleiste folgt der Liste`() {
        // Marcos Befund: „im Katalog ist sie auf der korrekten Zeile, aber die
        // Scrollbar zeigt an, dass man sich zuoberst befindet."
        //
        // Der Griff folgte NIE der Liste, sondern nur dem eigenen Ziehen:
        // previewYear startete auf yearMax, und thumbOffset(yearMax) ist genau
        // null — also ganz oben. Auch beim Rollen mit dem Finger blieb er
        // stehen; aufgefallen ist es erst nach der Detailseite, weil dort die
        // Komposition neu beginnt und ein gezogenes Jahr verlorengeht.
        //
        // Seit die Leiste dieselbe ist wie in der Webapp, haengt sie nicht mehr
        // am JAHR, sondern an der STELLE in der Liste. Die Aussage bleibt: ohne
        // Ziehen zeigt der Griff, wo man IST.
        val katalog = code(read("ui/screens/CatalogScreen.kt"))
        assert(katalog.contains("if (dragging) ziehAnteil else CatalogYearMath.anteilAusNummer(listenNummer, total)")) {
            "Der Griff zeigt weiterhin nur die gezogene Stelle — ohne Ziehen bliebe " +
                "er dort stehen, wo zuletzt gezogen wurde"
        }
        assert(katalog.contains("listenNummer = gridState.firstVisibleItemIndex")) {
            "Die Jahresleiste bekommt die Stelle der Liste gar nicht zu sehen"
        }
    }

    @Test
    fun `der Katalog springt nach der Rueckkehr wirklich zurueck`() {
        // ── Warum diese Prüfung schärfer ist als die alte (Nachtrag 93) ─────
        //
        // In Nachtrag 92 stand hier nur, dass `onScrollPos` und `scrollToItem`
        // im Katalog VORKOMMEN. Beides tat es — und die Mechanik war trotzdem
        // abgeschaltet. Marco musste den Fehler erneut melden, und mein Test
        // hatte ihn festgeschrieben. Dieselbe Sorte Test, die schon einmal eine
        // Sicherheitslücke konserviert hat: Er prüfte die ANWESENHEIT von
        // Bauteilen statt die Regel, auf die es ankommt.
        //
        // Die Regel heisst: erst zurückspringen, DANN wieder melden.
        val katalog = code(read("ui/screens/CatalogScreen.kt"))

        assert(katalog.contains("onScrollPos") && katalog.contains("scrollToItem")) {
            "Der Katalog merkt sich die Rollposition gar nicht mehr"
        }

        // 1. Der Merker darf den Ausflug in die Detailseite NICHT überleben.
        //    Als `rememberSaveable` tat er es — und schaltete die
        //    Wiederherstellung nach dem allerersten Betreten für immer ab.
        assert(!Regex("""wiederhergestellt by rememberSaveable""").containsMatchIn(katalog)) {
            "Der Merker ist wieder `rememberSaveable`. Dann gilt die Liste nach dem " +
                "ersten Betreten für immer als wiederhergestellt, und die Rückkehr " +
                "aus der Detailseite springt nie mehr zurück."
        }
        assert(Regex("""wiederhergestellt by remember \{""").containsMatchIn(katalog)) {
            "Ohne Merker je Komposition würde bei jeder Änderung von total erneut " +
                "gesprungen — auch mitten im Scrollen"
        }

        // 2. Der Melder darf nicht loslaufen, bevor zurückgesprungen wurde.
        //    Ein frischer LazyGridState steht auf null; snapshotFlow gibt diesen
        //    Wert sofort heraus und überschrieb damit die gemerkte Position.
        assert(katalog.contains("LaunchedEffect(gridState, wiederhergestellt)")) {
            "Der Melder hängt nicht am Merker — dann meldet er die Null des frischen " +
                "Zustands und löscht die gemerkte Position, bevor sie jemand liest"
        }
        assert(katalog.contains("if (!wiederhergestellt) return@LaunchedEffect")) {
            "Der Melder läuft ungebremst los"
        }

        // 3. Und der Merker wird erst NACH dem Sprung gesetzt: scrollToItem
        //    unterbricht, ein vorher gesetzter Merker liesse den Melder
        //    mitten im Sprung anlaufen.
        val block = katalog.substring(katalog.indexOf("LaunchedEffect(state.total)"))
        val sprung  = block.indexOf("scrollToItem")
        val merker  = block.indexOf("wiederhergestellt = true")
        assert(sprung in 0 until merker) {
            "Der Merker steht vor dem Sprung statt danach"
        }
    }
}
