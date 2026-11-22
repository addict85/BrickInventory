package ch.brickinventoryapp.shared

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Zustand
import org.junit.Assert.assertEquals
import ch.brickinventoryapp.model.domain.MemberView
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.shared.ui.EntryValues
import ch.brickinventoryapp.shared.ui.erfassungsWerte

/**
 * Every capture path lets you choose the owner — including the barcode scanner.
 *
 * Counter-check (carried out): ownerUserId removed from the confirmAddBarcode
 * call → the first sub-step turns red.
 */
class AddPathOwnerTest {

    private fun read(rel: String): String {
        val f = File(Quellen.root, "$rel")
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
        val nav = code(read("collection/ui/Erfassungsrahmen.kt") + "\n" + read("collection/ui/dialogs/BarcodeResultDialog.kt"))
        assert(nav.contains("OwnerPicker(")) {
            "im Barcode-Dialog fehlt die Eigentümer-Auswahl — OwnerPicker blendet sich " +
                "ohne Haushalt ohnehin selbst aus, schadet also nie"
        }
        assert(nav.contains("blick.householdMembers")) {
            "die Auswahl braucht die Haushaltsmitglieder aus dem Zustand"
        }
        // Without a household, nothing may be sent along — otherwise the
        // app would overwrite a server default with an ID nobody chose.
        assert(nav.contains("blick.householdMembers.size > 1")) {
            "ohne Haushalt darf kein Eigentümer mitgeschickt werden (gleiche Regel wie im Galerie-Dialog)"
        }
    }

    @Test
    fun `all adding paths ask for the owner`() {
        // Guard against the next forgotten path.
        val routes = listOf(
            "collection/ui/screens/GalerieErfassen.kt" to "Set über die Galerie",
            "parts/ui/screens/PartsDialogs.kt"    to "manuelles Teil",
            "parts/ui/screens/FigurenErfassen.kt" to "manuelle Minifigur",
        )
        for ((datei, name) in routes) {
            assert(code(read(datei)).contains("OwnerPicker(")) {
                "Erfassungsweg ohne Eigentümer-Auswahl: $name ($datei)"
            }
        }
    }

    /**
     * The conversion of the inputs lives in one place (erfassungsWerte): the dialogs use it (structure), and it is run here.
     * Counter-check: in erfassungsWerte `haushalt.size > 1` →
     * `haushalt.size > 0` → red „without a household no owner goes along“.
     */
    @Test
    fun `without a household no owner goes along`() {
        for (datei in listOf("parts/ui/screens/PartsDialogs.kt", "parts/ui/screens/FigurenErfassen.kt")) {
            assert(code(read(datei)).contains("erfassungsWerte(")) {
                "$datei rechnet die Eingaben wieder selbst um statt über erfassungsWerte()"
            }
        }
        val allein = listOf(MemberView(id = 1, username = "ich", isSelf = true))
        val haushalt = allein + MemberView(id = 7, username = "lea")
        assertEquals("ohne Haushalt überschriebe die App eine Server-Vorgabe mit einer ID, die niemand gewählt hat",
            EntryValues(anzahl = 1, preis = Geld.aus(2.5), zustand = Zustand.GEBRAUCHT, besitzer = null),
            erfassungsWerte(anzahl = "", preis = "2,50", zustand = Zustand.GEBRAUCHT, besitzer = 7, haushalt = allein))
        assertEquals(EntryValues(anzahl = 3, preis = null, zustand = Zustand.NEU, besitzer = 7),
            erfassungsWerte(anzahl = "3", preis = "", zustand = Zustand.NEU, besitzer = 7, haushalt = haushalt))
    }
}
