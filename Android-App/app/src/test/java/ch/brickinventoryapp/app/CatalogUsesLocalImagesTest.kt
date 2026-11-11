package ch.brickinventoryapp.app

import org.junit.Assert.assertEquals
import ch.brickinventoryapp.model.ui.model.alsAnsicht
import ch.brickinventoryapp.model.data.model.CatalogSetItem
import ch.brickinventoryapp.model.data.model.CatalogSetDetail
import ch.brickinventoryapp.data.api.ApiJson
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

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
 *
 * Gegenprobe: in CatalogSetItem.alsAnsicht `imageLocal =
 * null` → rot „Katalog-Modelle kennen image_local“.
 * Gegenprobe (lokal, liest nur Quelltext; als Patch nicht übersetzbar): in TeileKarte.kt
 * `serverUrl: String` aus der Signatur von PartTableRow bzw. ManualPartTile genommen →
 * rot „Funktion 'PartTableRow' …“ bzw. „Funktion 'ManualPartTile' …“.
 */
class CatalogUsesLocalImagesTest {

    private fun read(rel: String): String {
        val f = File(Quellen.wurzel, "$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    private fun code(src: String) = src.lines().joinToString("\n") { line ->
        if (line.trim().startsWith("//")) "" else line
    }

    @Test
    fun `Katalog-Modelle kennen image_local`() {
        // Gelesen wird, was der Server schickt, und es kommt in der Ansicht an.
        val item = ApiJson.decodeFromString(CatalogSetItem.serializer(),
            """{"set_number": "75192-1", "image_local": "/images/sets/75192-1.jpg"}""").alsAnsicht()
        assertEquals("/images/sets/75192-1.jpg", item.imageLocal)
        val detail = ApiJson.decodeFromString(CatalogSetDetail.serializer(),
            """{"set_number": "75192-1", "image_local": "/images/sets/75192-1_thumb.jpg"}""").alsAnsicht()
        assertEquals("/images/sets/75192-1_thumb.jpg", detail.imageLocal)
    }

    @Test
    fun `Katalog-Bildschirme reichen das Feld durch, statt null zu erzwingen`() {
        val list = code(Quellen.bildschirm("katalog/ui/screens/CatalogScreen.kt"))
        // rememberTileImageWithFallback(...) zählt ebenfalls:
        assert(list.contains("resolveThumbUrl(serverUrl, set.imageLocal, set.imageUrl)") ||
               list.contains("rememberTileImageWithFallback(serverUrl, set.imageLocal, set.imageUrl)")) {
            "Die Katalog-Liste muss set.imageLocal durchreichen, nicht null"
        }
        assert(!list.contains("resolveThumbUrl(serverUrl, null, set.imageUrl)")) {
            "Ein hart verdrahtetes null verhindert die Nutzung bereits vorhandener Dateien"
        }

        val detail = code(read("katalog/ui/screens/CatalogDetailScreen.kt"))
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
        val screenSrc = read("katalog/ui/screens/CatalogDetailScreen.kt").replace("\n", " ")
        assert(Regex("""fun CatalogDetailScreen\([^)]*serverUrl: String""").containsMatchIn(screenSrc)) {
            "serverUrl fehlt in der Funktionssignatur"
        }
        val graphSrc = code(read("katalog/ui/KatalogGraph.kt"))
        assert(graphSrc.contains("serverUrl = state.serverUrl")) {
            "Der Aufrufer in KatalogGraph.kt muss serverUrl übergeben"
        }
    }

    @Test
    fun `CatalogSetCard wird mit serverUrl aufgerufen`() {
        // Die generische Prüfung oben deckt die SIGNATUR ab; hier zusätzlich
        // der konkrete Aufruf, der beim gemeldeten Fehler tatsächlich fehlte.
        //
        // ── Auf die REGEL geprüft, nicht auf den Wortlaut ────
        //
        // Vorher stand hier ein contains() auf den ganzen Aufruf, schliessende
        // Klammer inbegriffen. Diese Zusicherung ist gefallen, als das Design
        // "noppe" ein fünftes Argument brauchte (die Position der Kachel für
        // die Deckelfarbe) — obwohl serverUrl unverändert an dritter Stelle
        // stand und die Sache, um die es hier geht, gar nicht berührt war.
        //
        // Die Aussage ist „serverUrl steht an dritter Stelle", nicht „der
        // Aufruf hat genau vier Argumente". Das Zeichen danach darf deshalb
        // ein Komma sein.
        val src = read("katalog/ui/screens/CatalogScreen.kt")
        assert(Regex("""CatalogSetCard\(set, imageLoader, serverUrl, onSetClick[,)]""")
                .containsMatchIn(src)) {
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
            "sammlung/ui/screens/GalerieKarte.kt",
            "sammlung/ui/screens/SetDetailScreen.kt",
            "teile/ui/screens/PartsScreen.kt",
            "finanzen/ui/screens/FinanceScreen.kt",
            "teile/ui/screens/MinifigsScreen.kt",
            "katalog/ui/screens/CatalogScreen.kt",
            "katalog/ui/screens/CatalogDetailScreen.kt",
        ).flatMap { Quellen.bildschirmDateien(it) }
        for (rel in screensToCheck) {
            val raw = read(rel)
            // Nur Funktionen auf oberster Ebene (Spalte 0), auch internal oder private:
            // Ohne Sichtbarkeit fiele ein Aufruf der Funktion davor zu.
            val funcStarts = Regex("""^(?:(?:public|internal|private)\s+)?fun (\w+)\(""", RegexOption.MULTILINE)
                .findAll(raw).map { it.range.first to it.groupValues[1] }.toList()
            val useIdxs = Regex("""(resolve(Thumb|Full)Url|rememberTileImageWithFallback)\(\s*serverUrl""")
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
            "teile/ui/screens/PartsScreen.kt" to 2,      // ManualPartTile, PartCard
            "teile/ui/screens/MinifigsScreen.kt" to 2,   // ManualFigTile, MinifigCard
            "katalog/ui/screens/CatalogScreen.kt" to 1,     // CatalogSetCard
        )
        for ((rel, expectedCount) in expectations) {
            val src = Quellen.bildschirm(rel)
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
