package ch.brickinventoryapp

import org.junit.Test

/**
 * Ein erfolgloser Scan führt zur manuellen Erfassung — überall.
 *
 * ── Marcos Vorgabe (Nachtrag 113) ───────────────────────────────────────────
 * „Wenn der Barcode erkannt wurde, aber die API keine Setnummer liefert, oder
 * wenn die Texterkennung keine Nummer erkennt, soll automatisch die manuelle
 * Erfassung erscheinen. Dies an allen Stellen so implementieren, wo der
 * Barcodescanner implementiert ist. Wenn der Dialog für die manuelle Erfassung
 * erscheint, soll der Cursor bereits im Set-Feld sein — dies soll immer so
 * sein, wenn das Formular angezeigt wird."
 *
 * ── Vier erfolglose Wege, ein Feld ──────────────────────────────────────────
 * Alle vier liegen im ViewModel:
 *   1. EAN gar nicht auflösbar
 *   2. EAN aufgelöst, aber ohne Setnummer
 *   3. Texterkennung ohne verwertbare Nummer
 *   4. Katalogabfrage zur erkannten Nummer scheitert
 *
 * Statt in jeden Bildschirm einen Aufruf zu setzen, melden sie sich über
 * `manuelleErfassungAnfordern` im Zustand. Wer den Scanner einbindet, liest das
 * Feld und öffnet SEINE Erfassung — die Galerie einen Dialog, die Teileliste
 * setzt den Cursor in ihr Eingabefeld (dort gibt es keinen Dialog).
 */
class ManualEntryAfterScanTest {

    // Gemeinsame Fassung statt einer eigenen Kopie je Testdatei — siehe
    // Quellen.kt (Nachtrag 115).
    private fun lies(rel: String) = Quellen.lies(rel)
    private fun code(src: String) = Quellen.ohneKommentare(src)

    @Test
    fun `alle erfolglosen Scan-Wege fordern die manuelle Erfassung an`() {
        val bf = code(lies("ui/BarcodeFeature.kt"))
        val anzahl = Regex("""manuelleErfassungAnfordern = true""").findAll(bf).count()
        assert(anzahl == 4) {
            "$anzahl statt 4 Stellen setzen die Anforderung. Es gibt vier " +
                "erfolglose Wege: EAN nicht auflösbar, EAN ohne Setnummer, " +
                "Texterkennung ohne Treffer, Katalogabfrage gescheitert. Fehlt " +
                "einer, bleibt der Nutzer dort mit einer Meldung allein."
        }
        assert(bf.contains("fun MainViewModel.manuelleErfassungQuittieren()")) {
            "Ohne Quittierung ginge die Erfassung beim nächsten Zusammensetzen " +
                "des Bildschirms erneut auf."
        }
    }

    @Test
    fun `jeder Scanner-Einstieg reagiert darauf`() {
        // Die Galerie öffnet ihren Dialog, die Teileliste setzt den Cursor.
        // Beide quittieren.
        val g = code(lies("ui/screens/GalleryScreen.kt"))
        assert(g.contains("barcodeState.manuelleErfassungAnfordern") && g.contains("showAddDialog = true")) {
            "Die Galerie öffnet die manuelle Erfassung nach einem erfolglosen Scan nicht"
        }
        assert(g.contains("vm.manuelleErfassungQuittieren()")) { "Die Galerie quittiert nicht" }

        val pl = code(lies("ui/screens/PartsListScreen.kt"))
        assert(pl.contains("manuelleErfassungAnfordern") && pl.contains("setFeldFokus.requestFocus()")) {
            "Die Teileliste setzt den Cursor nach einem erfolglosen Scan nicht ins Feld"
        }
        assert(pl.contains("onManuelleErfassungQuittiert()")) { "Die Teileliste quittiert nicht" }

        val tg = code(lies("nav/ToolsGraph.kt"))
        assert(tg.contains("manuelleErfassungAnfordern = barcodeState.manuelleErfassungAnfordern")) {
            "Der Graph reicht die Anforderung nicht an die Teileliste durch"
        }
    }

    @Test
    fun `das Erfassen-Formular setzt den Cursor ins Set-Feld`() {
        // „Dies soll immer so sein, wenn das Formular angezeigt wird" — deshalb
        // LaunchedEffect(Unit): Der Dialog wird bei jedem Öffnen neu
        // zusammengesetzt, also läuft es bei jeder Anzeige genau einmal.
        val g = lies("ui/screens/GalleryScreen.kt")
        val i = g.indexOf("fun AddSetDialog(")
        assert(i >= 0) { "AddSetDialog nicht gefunden" }
        val fn = g.substring(i)

        assert(fn.contains("FocusRequester()")) { "Kein Fokus-Anker im Dialog" }
        assert(Regex("""LaunchedEffect\(Unit\)[\s\S]{0,400}?requestFocus\(\)""").containsMatchIn(fn)) {
            "Der Cursor wird nicht bei jeder Anzeige ins Set-Feld gesetzt"
        }
        // Der Anker muss am SET-Feld hängen, nicht an Menge oder Preis.
        val setFeld = fn.indexOf("value = setNumber")
        val ankerAmSetFeld = fn.indexOf("focusRequester(setFeldFokus)")
        assert(setFeld >= 0 && ankerAmSetFeld > setFeld && ankerAmSetFeld - setFeld < 400) {
            "Der Fokus-Anker hängt nicht am Set-Feld"
        }
    }
}
