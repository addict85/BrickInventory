package ch.brickinventoryapp

import org.junit.Test

/**
 * Katalog-Bilder nutzen die vom Server ermittelte, nutzerunabhängige lokale
 * Datei, statt sie hart auf null zu setzen.
 *
 * Vorher übergab CatalogScreen.kt/CatalogDetailScreen.kt immer `null` als
 * imageLocal an resolveThumbUrl()/resolveFullUrl() — mit der Begründung, der
 * Katalog kenne keine lokalen Bilder. Das war nur zur Hälfte richtig: Ein
 * ANDERER Nutzer (oder derselbe bei einem früheren Set) kann dieselbe
 * Bilddatei bereits heruntergeladen haben, weil sie nach der Setnummer
 * benannt und nutzerunabhängig ist. Der Server prüft das jetzt und liefert
 * `image_local`, wenn die Datei existiert.
 */
class CatalogUsesLocalImagesTest {

    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    private fun code(src: String) = src.lines().joinToString("\n") { line ->
        if (line.trim().startsWith("//")) "" else line
    }

    @Test
    fun `Katalog-Modelle kennen image_local`() {
        val src = read("data/model/Models.kt")
        assert(src.contains("data class CatalogSetItem")) { "CatalogSetItem fehlt" }
        // Fester Zeichen-Ausschnitt statt naiver Klammersuche: Das erste ")"
        // nach dem Klassennamen gehört zur ERSTEN @SerialName-Annotation, nicht
        // zum Ende der Klasse — eine Klammersuche träfe viel zu früh ab.
        val itemStart = src.indexOf("data class CatalogSetItem")
        val item = src.substring(itemStart, itemStart + 800)
        assert(item.contains("""@SerialName("image_local")""")) {
            "CatalogSetItem muss image_local kennen"
        }

        val detailStart = src.indexOf("data class CatalogSetDetail")
        val detail = src.substring(detailStart, detailStart + 500)
        assert(detail.contains("""@SerialName("image_local")""")) {
            "CatalogSetDetail muss image_local kennen"
        }
    }

    @Test
    fun `Katalog-Bildschirme reichen das Feld durch, statt null zu erzwingen`() {
        val list = code(read("ui/screens/CatalogScreen.kt"))
        // rememberTileImageWithFallback(...) zählt ebenfalls (Nachtrag 42):
        // Der Helfer in util/ImageUrls.kt ruft intern resolveThumbUrl() auf und
        // ergänzt den Rückfall auf die volle Auflösung. Entscheidend ist, dass
        // set.imageLocal WEITERGEREICHT wird — nicht, über welchen der beiden
        // Wege. Der wörtliche Aufruf allein beanstandete sonst Bildschirme, die
        // gerade den besseren Weg gehen (dieselbe Korrektur wie in
        // NoDirectCdnAccessTest).
        assert(list.contains("resolveThumbUrl(serverUrl, set.imageLocal, set.imageUrl)") ||
               list.contains("rememberTileImageWithFallback(serverUrl, set.imageLocal, set.imageUrl)")) {
            "Die Katalog-Liste muss set.imageLocal durchreichen, nicht null"
        }
        assert(!list.contains("resolveThumbUrl(serverUrl, null, set.imageUrl)")) {
            "Ein hart verdrahtetes null verhindert die Nutzung bereits vorhandener Dateien"
        }

        val detail = code(read("ui/screens/CatalogDetailScreen.kt"))
        assert(detail.contains("resolveFullUrl(serverUrl, detail.imageLocal, detail.imageUrl)")) {
            "Der Katalog-Detail-Dialog muss detail.imageLocal an resolveFullUrl() übergeben"
        }
        assert(!detail.contains("resolveFullUrl(serverUrl, null, detail.imageUrl)")) {
            "Ein hart verdrahtetes null verhindert die Nutzung bereits vorhandener Dateien"
        }
    }

    @Test
    fun `CatalogDetailScreen deklariert und bekommt serverUrl`() {
        // Regression: resolveFullUrl() wurde eingebaut, ohne dass die
        // Funktion serverUrl überhaupt als Parameter kannte — Compile-Fehler
        // "Unresolved reference 'serverUrl'". Jetzt in der Signatur UND am
        // einzigen Aufrufort mit state.serverUrl versorgt.
        val screenSrc = read("ui/screens/CatalogDetailScreen.kt").replace("\n", " ")
        assert(Regex("""fun CatalogDetailScreen\([^)]*serverUrl: String""").containsMatchIn(screenSrc)) {
            "serverUrl fehlt in der Funktionssignatur"
        }
        val graphSrc = code(read("nav/CatalogGraph.kt"))
        assert(graphSrc.contains("serverUrl = state.serverUrl")) {
            "Der Aufrufer in CatalogGraph.kt muss serverUrl übergeben"
        }
    }

    @Test
    fun `CatalogSetCard wird mit serverUrl aufgerufen`() {
        // Die generische Prüfung oben deckt die SIGNATUR ab; hier zusätzlich
        // der konkrete Aufruf, der beim gemeldeten Fehler tatsächlich fehlte.
        val src = read("ui/screens/CatalogScreen.kt")
        assert(src.contains("CatalogSetCard(set, imageLoader, serverUrl, onSetClick)")) {
            "Der Aufruf muss serverUrl an dritter Stelle übergeben"
        }
        assert(!src.contains("CatalogSetCard(set, imageLoader, onSetClick)")) {
            "Der alte Aufruf ohne serverUrl darf nicht mehr vorkommen"
        }
    }

    @Test
    fun `jede Funktion mit resolveThumbUrl-fullUrl-Aufruf deklariert serverUrl selbst`() {
        // Generische Absicherung gegen genau diese Fehlerklasse: zweimal in
        // Folge wurde resolveThumbUrl()/resolveFullUrl() in eine Funktion
        // eingebaut, ohne zu prüfen, ob SIE SELBST (nicht nur eine
        // umgebende Datei) serverUrl als Parameter führt — Compile-Fehler
        // "Unresolved reference 'serverUrl'", einmal bei CatalogDetailScreen,
        // einmal bei CatalogSetCard.
        //
        // Prüfung: Für jede Top-Level-Funktionsdefinition, deren Rumpf einen
        // resolve*Url(serverUrl, …)-Aufruf enthält, muss "serverUrl: String"
        // in DERSELBEN Signatur stehen.
        val screensToCheck = listOf(
            "ui/screens/GalleryScreen.kt",
            "ui/screens/SetDetailScreen.kt",
            "ui/screens/PartsScreen.kt",
            "ui/screens/FinanceScreen.kt",
            "ui/screens/MinifigsScreen.kt",
            "ui/screens/CatalogScreen.kt",
            "ui/screens/CatalogDetailScreen.kt",
        )
        for (rel in screensToCheck) {
            val raw = read(rel)
            // Nur Funktionsdefinitionen auf oberster Ebene (Spalte 0) zählen.
            // Lokale, eingerückte "fun"-Deklarationen innerhalb eines
            // Composable-Körpers (z. B. fmtDate/fmtPrice in SetDetailScreen.kt
            // bzw. FinanceScreen.kt) sind keine eigenen Scopes für diese
            // Prüfung — eine erste Fassung ohne diese Einschränkung hielt sie
            // fälschlich für den umschliessenden Aufrufer und schlug fehl.
            val funcStarts = Regex("""^fun (\w+)\(""", RegexOption.MULTILINE)
                .findAll(raw).map { it.range.first to it.groupValues[1] }.toList()
            val useIdxs = Regex("""(resolve(Thumb|Full)Url|rememberTileImageWithFallback)\(serverUrl""")
                .findAll(raw).map { it.range.first }.toList()
            for (u in useIdxs) {
                var owner: Pair<Int, String>? = null
                for ((start, name) in funcStarts) {
                    if (start > u) break
                    owner = start to name
                }
                assert(owner != null) { "$rel: keine umschliessende Top-Level-Funktion gefunden" }
                val (start, name) = owner!!
                val sigWindow = raw.substring(start, minOf(start + 600, raw.length)).replace("\n", " ")
                assert(sigWindow.contains("serverUrl: String")) {
                    "$rel: Funktion '$name' benutzt resolveThumbUrl()/resolveFullUrl() mit serverUrl, " +
                    "deklariert es aber nicht selbst als Parameter"
                }
            }
        }
    }

    @Test
    fun `Teile, Minifiguren und Katalog benutzen denselben Rückfall wie die Galerie`() {
        // Auf Nutzerwunsch auf dasselbe Muster umgestellt wie GalleryScreen.kt:
        // resolveThumbUrl() allein reicht nicht, wenn die Vorschau (noch)
        // fehlt — rememberTileImageWithFallback() wechselt bei einem
        // Ladefehler auf die volle Auflösung.
        val expectations = mapOf(
            "ui/screens/PartsScreen.kt" to 2,      // ManualPartTile, PartCard
            "ui/screens/MinifigsScreen.kt" to 2,   // ManualFigTile, MinifigCard
            "ui/screens/CatalogScreen.kt" to 1,     // CatalogSetCard
        )
        for ((rel, expectedCount) in expectations) {
            val src = read(rel)
            val count = Regex("""rememberTileImageWithFallback\(serverUrl""").findAll(src).count()
            assert(count == expectedCount) {
                "$rel: $count statt $expectedCount Verwendungen von rememberTileImageWithFallback()"
            }
            assert(!Regex("""[^.]resolveThumbUrl\(serverUrl""").containsMatchIn(src)) {
                "$rel: benutzt noch direkt resolveThumbUrl() statt des Rückfall-Helfers"
            }
        }
    }
}
