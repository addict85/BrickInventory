package ch.brickinventoryapp

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Die Farbe eines manuell erfassten Teils nachtraeglich aendern — App-Seite.
 *
 * ── Marcos Bitte ────────────────────────────────────────────────────────────
 *
 *   „Ich habe mehrere wanted listen importiert. Die Farbe wurde nicht immer
 *    uebernommen und die Teile sind nun mehrfach vorhanden (bsp 3001). …
 *    Weiter moechte ich die Farbe nachtraeglich anpassen koennen fuer den Fall
 *    dass diese nicht korrekt geladen wurde."
 *
 * ── Was hier geprueft wird und was NICHT ────────────────────────────────────
 *
 * Was die Aenderung TUT — Umziehen oder Zusammenlegen, Erfassungen vom
 * gleichen Tag addieren, ein Set-Teil abweisen — prueft der Server gegen eine
 * echte Datenbank: Web-App/test/teil-farbe-aendern-db.test.js. Eine zweite,
 * schwaechere Fassung davon gehoert nicht hierher.
 *
 * Hier stehen die drei Aussagen, die nur auf DIESER Seite nachweisbar sind:
 *
 *   1. Die App ruft denselben Dienst wie die Webapp (Marcos Vorgabe: „Bitte
 *      die Login jeweils nur 1x im Backend bauen. Beide Apps sollen die
 *      gleichen Services des Backends verwenden.")
 *   2. Nach der Aenderung wird der Bildschirm mit der NEUEN Farbe neu
 *      geoeffnet. Die Farbe steckt in der Route UND in der Suche nach der
 *      Zeile (`it.colorId == colorId`) — ohne das stuende er leer da, obwohl
 *      die Aenderung geklappt hat.
 *   3. Die Farbzeile haengt NICHT daran, dass ein Farbname da ist. Das war
 *      der Zustand vorher: Der Chip oben stand unter `part?.colorName?.let`,
 *      und ausgerechnet das Teil ohne Farbnamen — genau der Fall, der
 *      korrigiert werden muss — zeigte nichts an.
 *
 * ── Gegenproben (am 19.10. GEMESSEN) ────────────────────────────────────────
 *
 * Kotlin laesst sich in dieser Umgebung nicht uebersetzen (dl.google.com ist
 * gesperrt), die Uebersetzung macht die CI. Die SUCHMUSTER dieses Tests sind
 * deshalb einzeln gegen die echten Dateien nachgerechnet worden, jedes mit
 * seiner Gegenprobe:
 *
 *   A  `"api/v1/parts/{partNumber}/{colorId}/color"` aus BrickApiService.kt
 *      entfernt → Fall 1 rot („Die Adresse … fehlt").
 *   B  `onFarbeGeaendert` aus CollectionGraph.kt entfernt
 *      → Fall 2 rot („Der Bildschirm wird nach der Aenderung nicht …").
 *   C  die Farbzeile im Screen hinter `part?.colorName != null` gelegt
 *      → Fall 3 rot.
 *   D  `if (neueFarbe == colorId) return` aus PartsFeature.kt entfernt
 *      → Fall 4 rot.
 */
class TeilFarbeAendernTest {

    private val api by lazy {
        Quellen.ohneKommentare(Quellen.lies("data/api/BrickApiService.kt"))
    }
    private val repo by lazy {
        Quellen.ohneKommentare(Quellen.lies("data/repository/TeileRepository.kt"))
    }
    private val feature by lazy {
        Quellen.ohneKommentare(Quellen.lies("ui/PartsFeature.kt"))
    }
    private val screen by lazy {
        Quellen.ohneKommentare(Quellen.lies("ui/screens/ManualItemDetailScreen.kt"))
    }
    private val graph by lazy {
        Quellen.ohneKommentare(Quellen.lies("nav/CollectionGraph.kt"))
    }
    private val feld by lazy {
        Quellen.ohneKommentare(Quellen.lies("ui/screens/FarbWahlFeld.kt"))
    }

    @Test
    fun `die App ruft denselben Dienst wie die Webapp`() {
        assertTrue(
            "Die Adresse api/v1/parts/{partNumber}/{colorId}/color fehlt in " +
                "BrickApiService.kt — dann ruft die App etwas anderes als die Webapp, " +
                "oder gar nichts.",
            api.contains("\"api/v1/parts/{partNumber}/{colorId}/color\"")
        )
        // Die ALTE Farbe im Pfad, die NEUE im Koerper. Beides gehoert dazu: Der
        // Pfad sagt, welche Zeile gemeint ist, der Koerper, wohin sie soll.
        assertTrue(
            "setPartColor nimmt kein TeilFarbeRequest — dann reist die neue Farbe " +
                "nicht mit, und der Server weist die Anfrage mit 400 ab.",
            api.contains("TeilFarbeRequest")
        )
        assertTrue(
            "TeileRepository hat kein setPartColor — der Bildschirm kaeme nicht an " +
                "die Route.",
            repo.contains("fun setPartColor")
        )
        // owner: Besitzer der KARTE. Im Haushalt zeigt der manuelle Bereich die
        // Eintraege aller Konten; ohne die Angabe aendert der Server die Farbe
        // der EIGENEN Zeile — geklickt waere die fremde Karte. Dieselbe Luecke
        // wie beim Loeschen (siehe deletePart).
        assertTrue(
            "setPartColor reicht den Besitzer der Karte nicht mit — im Haushalt " +
                "wuerde die Farbe der eigenen Zeile geaendert statt der angezeigten.",
            Regex("""setPartColor\([^)]*owner""", RegexOption.DOT_MATCHES_ALL).containsMatchIn(repo) &&
                Regex("""owner\s*=\s*part\?\.userId""").containsMatchIn(screen)
        )
    }

    @Test
    fun `nach der Aenderung oeffnet der Bildschirm mit der neuen Farbe`() {
        assertTrue(
            "Der Bildschirm wird nach der Aenderung nicht neu geoeffnet: In " +
                "CollectionGraph.kt fehlt onFarbeGeaendert. Die Farbe ist Teil der " +
                "Route und der Suche nach der Zeile — der Bildschirm stuende leer da, " +
                "obwohl die Aenderung geklappt hat.",
            graph.contains("onFarbeGeaendert")
        )
        assertTrue(
            "onFarbeGeaendert navigiert nicht auf ManualItemDetail mit der neuen Farbe.",
            Regex(
                """onFarbeGeaendert\s*=\s*\{[^}]*ManualItemDetail\.createRoute""",
                RegexOption.DOT_MATCHES_ALL
            ).containsMatchIn(graph)
        )
        // Erst zurueck, dann hin: Bliebe der alte Eintrag im Rueckweg stehen,
        // landete ein Zurueck-Tipp auf genau der Farbe, die gerade korrigiert
        // wurde.
        assertTrue(
            "Vor dem neuen Aufruf fehlt das popBackStack() — der alte Eintrag mit " +
                "der falschen Farbe bliebe im Rueckweg stehen.",
            Regex(
                """onFarbeGeaendert\s*=\s*\{[^}]*popBackStack\(\)[^}]*navigate""",
                RegexOption.DOT_MATCHES_ALL
            ).containsMatchIn(graph)
        )
        assertTrue(
            "Der Screen gibt onFarbeGeaendert nicht an setzeTeilFarbe weiter — dann " +
                "wird nach der Aenderung nichts neu geoeffnet.",
            Regex("""onFertig\s*=\s*onFarbeGeaendert""").containsMatchIn(screen)
        )
    }

    @Test
    fun `die Farbzeile haengt nicht an einem vorhandenen Farbnamen`() {
        // Der Aufruf von FarbWahlFeld darf nicht unter einer Bedingung stehen,
        // die den Farbnamen verlangt. Geprueft wird der Block VOR dem Aufruf:
        // Die naechste Bedingung darueber ist `if (!isFig) {` — und sonst
        // nichts.
        val i = screen.indexOf("FarbWahlFeld(")
        assertTrue(
            "FarbWahlFeld wird im Detailbildschirm nicht aufgerufen — dann gibt es " +
                "keine Moeglichkeit, die Farbe zu korrigieren.",
            i > 0
        )
        val davor = screen.substring(0, i)
        val letzteBedingung = Regex("""if \(([^)\n]*)\)\s*\{[^{}]*$""").find(davor)
            ?.groupValues?.get(1)
            ?: Regex("""if \(([^)\n]*)\)""").findAll(davor).lastOrNull()?.groupValues?.get(1) ?: ""
        assertTrue(
            "Die Farbzeile steht hinter der Bedingung „$letzteBedingung". Verlangt sie " +
                "einen Farbnamen, zeigt ausgerechnet das Teil ohne Farbnamen nichts an — " +
                "und genau das ist der Fall, der korrigiert werden muss.",
            !letzteBedingung.contains("colorName")
        )
        // Und die Gegenrichtung im Feld selbst: Ohne Farbliste (kein Netz, kein
        // Rebrickable-Schluessel) muss die heutige Farbe trotzdem dastehen.
        assertTrue(
            "FarbWahlFeld faellt ohne Farbliste nicht auf den heutigen Namen zurueck — " +
                "dann stuende dort ein leeres Feld.",
            feld.contains("aktuellerName")
        )
        assertTrue(
            "FarbWahlFeld nennt keinen Rueckfall fuer eine Farbe ohne Namen — dann " +
                "waere das Feld bei genau diesen Teilen leer.",
            feld.contains("parts_color_unknown")
        )
    }

    @Test
    fun `dieselbe Farbe nochmal loest keine Anfrage aus`() {
        // Zwei Stellen, und beide mit Grund: Das Feld schickt den Rueckruf
        // nicht los (spart die Anfrage UND das Neuoeffnen), das ViewModel
        // bricht ebenfalls ab (es ist der Weg, den jeder Aufrufer nimmt).
        //
        // Der Server weist den Fall ohnehin ab, ohne etwas zu aendern — aber
        // „der Server faengt es schon" ist kein Grund, eine Anfrage zu
        // schicken, deren Antwort ein Neuaufbau des Bildschirms ist.
        assertTrue(
            "setzeTeilFarbe bricht bei gleicher Farbe nicht ab.",
            Regex("""if \(neueFarbe == colorId\) return""").containsMatchIn(feature)
        )
        assertTrue(
            "FarbWahlFeld ruft onWahl auch fuer die bereits gewaehlte Farbe.",
            Regex("""if \(c\.id != aktuell\) onWahl\(c\)""").containsMatchIn(feld)
        )
    }
}
