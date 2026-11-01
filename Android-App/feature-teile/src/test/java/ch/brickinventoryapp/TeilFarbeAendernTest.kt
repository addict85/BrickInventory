package ch.brickinventoryapp

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.FigurenRepository
import ch.brickinventoryapp.ui.viewmodel.TeileViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
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
 * ── Gegenproben ─────────────────────────────────────────────────────────────
 *
 * Fall 1 und 4 laufen gegen einen Testserver (TeileViewModel, TeileRepository),
 * Fall 2 und 3 lesen Bildschirm und Graph. Gemessen am 29.10.2026:
 *   A  in TeileApi die Adresse auf "…/colour" → rot „die App ruft denselben
 *      Dienst wie die Webapp“
 *   B  owner in TeileRepository.setPartColor nicht weitergereicht → rot ebenda
 *   D  `if (neueFarbe == colorId) return` aus TeileViewModel entfernt → rot
 *      „dieselbe Farbe nochmal löst keine Anfrage aus“ (PUT …/3001/5/color)
 * Am 19.10. gemessen: B′ `onFarbeGeaendert` aus CollectionGraph.kt entfernt →
 * Fall 2 rot; C die Farbzeile hinter `part?.colorName != null` → Fall 3 rot.
 */
class TeilFarbeAendernTest {

    private val pfade = PfadServer("/api/v1/parts/3001/5/color" to """{"success":true}""")
    private val t = TestDienste(pfade.server)

    @Before
    fun auf() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        pfade.server.shutdown()
    }

    private fun vm() = t.merke(TeileViewModel(t.dienste, TeileRepository(t.api, t.cache), FigurenRepository(t.api, t.cache), SavedStateHandle()))
    private val screen by lazy {
        Quellen.ohneKommentare(Quellen.lies("ui/screens/ManualItemDetailScreen.kt"))
    }
    private val graph by lazy {
        Quellen.ohneKommentare(Quellen.lies("nav/CollectionGraph.kt"))
    }
    private val feld by lazy {
        Quellen.ohneKommentare(Quellen.lies("ui/screens/FarbWahlFeld.kt"))
    }

    /**
     * Die ALTE Farbe im Pfad, die NEUE im Körper: Der Pfad sagt, welche Zeile
     * gemeint ist, der Körper, wohin sie soll. owner ist der Besitzer der KARTE —
     * im Haushalt zeigt der manuelle Bereich alle Konten, ohne ihn änderte der
     * Server die eigene Zeile statt der angezeigten.
     */
    @Test
    fun `die App ruft denselben Dienst wie die Webapp`() {
        var geoeffnet: Int? = null
        vm().setzeTeilFarbe("3001", 5, 11, owner = 7) { geoeffnet = it }
        TestApi.warteBis("neu geöffnet") { geoeffnet != null }
        // Danach lädt der Bereich die Teile neu (Bestandssignal) — gezählt wird nur die Farbe.
        assertEquals(listOf("PUT /api/v1/parts/3001/5/color?owner=7"), pfade.anfragenAn("/color"))
        val koerper = pfade.koerper[pfade.anfragen.indexOfFirst { "/color" in it }]
        assertTrue(koerper, koerper.contains("\"color_id\":11"))
        assertEquals("Der Bildschirm öffnet mit der neuen Farbe", 11, geoeffnet)
        assertTrue("Der Bildschirm reicht den Besitzer der Karte nicht weiter",
            Regex("""owner\s*=\s*part\?\.userId""").containsMatchIn(screen))
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
            "Die Farbzeile steht hinter der Bedingung „$letzteBedingung\". Verlangt sie " +
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
        vm().setzeTeilFarbe("3001", 5, 5)
        Thread.sleep(200)
        assertTrue("setzeTeilFarbe bricht bei gleicher Farbe nicht ab: ${pfade.anfragen}", pfade.anfragenAn("/color").isEmpty())
        assertTrue(
            "FarbWahlFeld ruft onWahl auch fuer die bereits gewaehlte Farbe.",
            Regex("""if \(c\.id != aktuell\) onWahl\(c\)""").containsMatchIn(feld)
        )
    }
}
