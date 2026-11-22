package ch.brickinventoryapp.shared

import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.shared.ui.EntryValues
import ch.brickinventoryapp.shared.ui.entryValues
import ch.brickinventoryapp.testing.Sources
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * Every capture path lets you choose the owner — including the barcode scanner.
 *
 * Counter-check (carried out): ownerUserId removed from the confirmAddBarcode
 * call → the first sub-step turns red.
 */
class AddPathOwnerTest {

    private fun read(rel: String): String {
        val f = File(Sources.root, "$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /** Hide the comments — the explanatory text names the checked patterns itself. */
    private fun code(src: String) = src.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `the barcode dialog shows the selection`() {
        // The dialog lives in BarcodeResultDialog.kt; the capture frame shows it. Both
        // files, so the rule is found wherever it lives.
        val nav = code(read("collection/ui/EntryFrame.kt") + "\n" + read("collection/ui/dialogs/BarcodeResultDialog.kt"))
        assert(nav.contains("OwnerPicker(")) {
            "im Barcode-Dialog fehlt die Eigentümer-Auswahl — OwnerPicker blendet sich " +
                "ohne Haushalt ohnehin selbst aus, schadet also nie"
        }
        assert(nav.contains("glance.householdMembers")) {
            "die Auswahl braucht die Haushaltsmitglieder aus dem Zustand"
        }
        // Without a household, nothing may be sent along — otherwise the
        // app would overwrite a server default with an ID nobody chose.
        assert(nav.contains("glance.householdMembers.size > 1")) {
            "ohne Haushalt darf kein Eigentümer mitgeschickt werden (gleiche Regel wie im Galerie-Dialog)"
        }
    }

    @Test
    fun `all adding paths ask for the owner`() {
        // Guard against the next forgotten path.
        val routes = listOf(
            "collection/ui/screens/GalleryRecord.kt" to "Set über die Galerie",
            "parts/ui/screens/PartsDialogs.kt"    to "manuelles Teil",
            "parts/ui/screens/FiguresRecord.kt" to "manuelle Minifigur",
        )
        for ((file, name) in routes) {
            assert(code(read(file)).contains("OwnerPicker(")) {
                "Erfassungsweg ohne Eigentümer-Auswahl: $name ($file)"
            }
        }
    }

    /**
     * The conversion of the inputs lives in one place (entryValues): the dialogs use it (structure), and it is run here.
     * Counter-check: in entryValues `household.size > 1` →
     * `household.size > 0` → red „without a household no owner goes along“.
     */
    @Test
    fun `without a household no owner goes along`() {
        for (file in listOf("parts/ui/screens/PartsDialogs.kt", "parts/ui/screens/FiguresRecord.kt")) {
            assert(code(read(file)).contains("entryValues(")) {
                "$file rechnet die Eingaben wieder selbst um statt über entryValues()"
            }
        }
        val alone = listOf(MemberView(id = 1, username = "ich", isSelf = true))
        val household = alone + MemberView(id = 7, username = "lea")
        assertEquals("ohne Haushalt überschriebe die App eine Server-Vorgabe mit einer ID, die niemand gewählt hat",
            EntryValues(count = 1, price = Money.from(2.5), condition = Condition.USED, owner = null),
            entryValues(count = "", price = "2,50", condition = Condition.USED, owner = 7, household = alone))
        assertEquals(EntryValues(count = 3, price = null, condition = Condition.NEW, owner = 7),
            entryValues(count = "3", price = "", condition = Condition.NEW, owner = 7, household = household))
    }
}
