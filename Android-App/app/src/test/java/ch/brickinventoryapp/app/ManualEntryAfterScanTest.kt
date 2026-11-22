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
 *
 * Counter-check (run here): `entryVm.acknowledgeManualEntry()` removed from GalleryScreen →
 * red “every scanner entry reacts to it”.
 */
class ManualEntryAfterScanTest {

    // A common version instead of an own copy per test file — see
    // Sources.kt.
    private fun read(rel: String) = Sources.read(rel)
    private fun code(src: String) = Sources.withoutComments(src)

    @Test
    fun `every scanner entry reacts to it`() {
        // The gallery opens its dialog and acknowledges; what the build list does is
        // checked as behavior in SubpagesTest.
        val g = code(read("collection/ui/screens/GalleryScreen.kt"))
        assert(g.contains("barcode.requestManualEntry") && g.contains("showAddDialog = true")) {
            "the gallery does not open manual entry after an unsuccessful scan"
        }
        assert(g.contains("entryVm.acknowledgeManualEntry()")) { "the gallery does not acknowledge" }

        val tg = code(read("parts/ui/PartsGraph.kt"))
        assert(tg.contains("requestManualEntry = scan.manualRecord")) {
            "the graph does not pass the request on to the parts list"
        }
    }

    @Test
    fun `the add form puts the cursor into the set field`() {
        // “This should always be so when the form is shown" — hence
        // LaunchedEffect(Unit): the dialog is composed anew on every opening,
        // so it runs exactly once per display.
        val g = read("collection/ui/screens/GalleryRecord.kt")
        val i = g.indexOf("fun AddSetDialog(")
        assert(i >= 0) { "AddSetDialog not found" }
        val fn = g.substring(i)

        assert(fn.contains("FocusRequester()")) { "no focus anchor in the dialog" }
        assert(Regex("""LaunchedEffect\(Unit\)[\s\S]{0,400}?requestFocus\(\)""").containsMatchIn(fn)) {
            "the cursor is not put into the set field on every showing"
        }
        // The anchor must hang on the SET field, not on quantity or price.
        val setField = fn.indexOf("value = setNumber")
        val anchorAtSetField = fn.indexOf("focusRequester(setFieldFocus)")
        // In the same field means: before the next input field (quantity, price).
        val nextField = fn.indexOf("OutlinedTextField(", setField).let { if (it < 0) fn.length else it }
        assert(setField >= 0 && anchorAtSetField in (setField + 1) until nextField) {
            "the focus anchor does not hang on the set field"
        }
    }
}
