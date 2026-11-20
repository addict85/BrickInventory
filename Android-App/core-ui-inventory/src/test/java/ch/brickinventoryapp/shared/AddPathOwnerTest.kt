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
 * Jeder Erfassungsweg lässt den Eigentümer wählen — auch der Barcode-Scanner.
 *
 * Gegenprobe (durchgeführt): ownerUserId aus dem confirmAddBarcode-Aufruf
 * entfernt → der erste Teilschritt wird rot.
 */
class AddPathOwnerTest {

    private fun read(rel: String): String {
        val f = File(Quellen.root, "$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /** Kommentare ausblenden — die Erklärtexte nennen die geprüften Muster selbst. */
    private fun code(src: String) = src.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `der Barcode-Dialog zeigt die Auswahl an`() {
        // Der Dialog steht in BarcodeResultDialog.kt; der Erfassungsrahmen zeigt ihn. Beide
        // Dateien, damit die Regel gefunden wird, wo sie steht.
        val nav = code(read("collection/ui/Erfassungsrahmen.kt") + "\n" + read("collection/ui/dialogs/BarcodeResultDialog.kt"))
        assert(nav.contains("OwnerPicker(")) {
            "im Barcode-Dialog fehlt die Eigentümer-Auswahl — OwnerPicker blendet sich " +
                "ohne Haushalt ohnehin selbst aus, schadet also nie"
        }
        assert(nav.contains("blick.householdMembers")) {
            "die Auswahl braucht die Haushaltsmitglieder aus dem Zustand"
        }
        // Ohne Haushalt darf nichts mitgeschickt werden — sonst überschriebe die
        // App eine Server-Vorgabe mit einer ID, die niemand gewählt hat.
        assert(nav.contains("blick.householdMembers.size > 1")) {
            "ohne Haushalt darf kein Eigentümer mitgeschickt werden (gleiche Regel wie im Galerie-Dialog)"
        }
    }

    @Test
    fun `alle Erfassungswege fragen den Eigentuemer ab`() {
        // Wächter gegen den nächsten vergessenen Weg.
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
     * Die Umrechnung der Eingaben steht an einer Stelle (erfassungsWerte): Die Dialoge benutzen sie (Struktur), und sie wird hier ausgeführt.
     * Gegenprobe: in erfassungsWerte `haushalt.size > 1` →
     * `haushalt.size > 0` → rot „ohne Haushalt geht kein Eigentuemer mit“.
     */
    @Test
    fun `ohne Haushalt geht kein Eigentuemer mit`() {
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
