package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test

/**
 * An unsuccessful scan leads to manual adding — everywhere.
 *
 * ── Four unsuccessful paths, one field ──────────────────────────────────────
 * All four lie in the ViewModel:
 *
 * Instead of putting a call into every screen, they report via
 * `requestManualEntry` in the state. Whoever embeds the scanner reads the
 * field and opens THEIR adding — the gallery a dialog, the parts list
 * puts the cursor into its input field (there is no dialog there).
 */
class ManualEntryAfterScanTest {

    // A common version instead of an own copy per test file — see
    // Sources.kt.
    private fun read(rel: String) = Sources.read(rel)
    private fun code(src: String) = Sources.withoutComments(src)

    @Test
    fun `every scanner entry reacts to it`() {
        // The gallery opens its dialog, the parts list sets the cursor.
        // Both acknowledge.
        val g = code(read("collection/ui/screens/GalleryScreen.kt"))
        assert(g.contains("barcode.requestManualEntry") && g.contains("showAddDialog = true")) {
            "Die Galerie öffnet die manuelle Erfassung nach einem erfolglosen Scan nicht"
        }
        assert(g.contains("entryVm.acknowledgeManualEntry()")) { "Die Galerie quittiert nicht" }

        val pl = code(read("parts/ui/screens/PartsListScreen.kt"))
        assert(pl.contains("requestManualEntry") && pl.contains("setFieldFocus.requestFocus()")) {
            "Die Teileliste setzt den Cursor nach einem erfolglosen Scan nicht ins Feld"
        }
        assert(pl.contains("onManualEntryAcknowledged()")) { "Die Teileliste quittiert nicht" }

        val tg = code(read("parts/ui/PartsGraph.kt"))
        assert(tg.contains("requestManualEntry = scan.manualRecord")) {
            "Der Graph reicht die Anforderung nicht an die Teileliste durch"
        }
    }

    @Test
    fun `the add form puts the cursor into the set field`() {
        // “This should always be so when the form is shown" — hence
        // LaunchedEffect(Unit): the dialog is composed anew on every opening,
        // so it runs exactly once per display.
        val g = read("collection/ui/screens/GalleryRecord.kt")
        val i = g.indexOf("fun AddSetDialog(")
        assert(i >= 0) { "AddSetDialog nicht gefunden" }
        val fn = g.substring(i)

        assert(fn.contains("FocusRequester()")) { "Kein Fokus-Anker im Dialog" }
        assert(Regex("""LaunchedEffect\(Unit\)[\s\S]{0,400}?requestFocus\(\)""").containsMatchIn(fn)) {
            "Der Cursor wird nicht bei jeder Anzeige ins Set-Feld gesetzt"
        }
        // The anchor must hang on the SET field, not on quantity or price.
        val setField = fn.indexOf("value = setNumber")
        val anchorAtSetField = fn.indexOf("focusRequester(setFieldFocus)")
        // In the same field means: before the next input field (quantity, price).
        val nextField = fn.indexOf("OutlinedTextField(", setField).let { if (it < 0) fn.length else it }
        assert(setField >= 0 && anchorAtSetField in (setField + 1) until nextField) {
            "Der Fokus-Anker hängt nicht am Set-Feld"
        }
    }
}
