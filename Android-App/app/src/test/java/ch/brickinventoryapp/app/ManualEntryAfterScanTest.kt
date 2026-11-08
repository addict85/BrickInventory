package ch.brickinventoryapp.app

import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

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
    fun `jeder Scanner-Einstieg reagiert darauf`() {
        // Die Galerie öffnet ihren Dialog, die Teileliste setzt den Cursor.
        // Beide quittieren.
        val g = code(lies("sammlung/ui/screens/GalleryScreen.kt"))
        assert(g.contains("barcode.manuelleErfassungAnfordern") && g.contains("showAddDialog = true")) {
            "Die Galerie öffnet die manuelle Erfassung nach einem erfolglosen Scan nicht"
        }
        assert(g.contains("erfassung.manuelleErfassungQuittieren()")) { "Die Galerie quittiert nicht" }

        val pl = code(lies("teile/ui/screens/PartsListScreen.kt"))
        assert(pl.contains("manuelleErfassungAnfordern") && pl.contains("setFeldFokus.requestFocus()")) {
            "Die Teileliste setzt den Cursor nach einem erfolglosen Scan nicht ins Feld"
        }
        assert(pl.contains("onManuelleErfassungQuittiert()")) { "Die Teileliste quittiert nicht" }

        val tg = code(lies("app/nav/ToolsGraph.kt"))
        assert(tg.contains("manuelleErfassungAnfordern = barcodeState.manuelleErfassungAnfordern")) {
            "Der Graph reicht die Anforderung nicht an die Teileliste durch"
        }
    }

    @Test
    fun `das Erfassen-Formular setzt den Cursor ins Set-Feld`() {
        // „Dies soll immer so sein, wenn das Formular angezeigt wird" — deshalb
        // LaunchedEffect(Unit): Der Dialog wird bei jedem Öffnen neu
        // zusammengesetzt, also läuft es bei jeder Anzeige genau einmal.
        val g = lies("sammlung/ui/screens/GalerieErfassen.kt")
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
        // Im selben Feld heisst: vor dem nächsten Eingabefeld (Menge, Preis).
        val naechstesFeld = fn.indexOf("OutlinedTextField(", setFeld).let { if (it < 0) fn.length else it }
        assert(setFeld >= 0 && ankerAmSetFeld in (setFeld + 1) until naechstesFeld) {
            "Der Fokus-Anker hängt nicht am Set-Feld"
        }
    }
}
