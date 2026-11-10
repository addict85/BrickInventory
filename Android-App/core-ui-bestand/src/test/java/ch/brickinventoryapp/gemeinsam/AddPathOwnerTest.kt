package ch.brickinventoryapp.gemeinsam

import ch.brickinventoryapp.model.fach.Zustand
import org.junit.Assert.assertEquals
import ch.brickinventoryapp.model.ui.model.MitgliedAnsicht
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.gemeinsam.ui.ErfassungsWerte
import ch.brickinventoryapp.gemeinsam.ui.erfassungsWerte

/**
 * Jeder Erfassungsweg lässt den Eigentümer wählen — auch der Barcode-Scanner.
 *
 * Gegenprobe (durchgeführt): ownerUserId aus dem confirmAddBarcode-Aufruf
 * entfernt → der erste Teilschritt wird rot.
 */
class AddPathOwnerTest {

    private fun read(rel: String): String {
        val f = File(Quellen.wurzel, "$rel")
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
        val nav = code(read("sammlung/ui/Erfassungsrahmen.kt") + "\n" + read("sammlung/ui/dialogs/BarcodeResultDialog.kt"))
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
        val wege = listOf(
            "sammlung/ui/screens/GalerieErfassen.kt" to "Set über die Galerie",
            "teile/ui/screens/PartsDialogs.kt"    to "manuelles Teil",
            "teile/ui/screens/FigurenErfassen.kt" to "manuelle Minifigur",
        )
        for ((datei, name) in wege) {
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
        for (datei in listOf("teile/ui/screens/PartsDialogs.kt", "teile/ui/screens/FigurenErfassen.kt")) {
            assert(code(read(datei)).contains("erfassungsWerte(")) {
                "$datei rechnet die Eingaben wieder selbst um statt über erfassungsWerte()"
            }
        }
        val allein = listOf(MitgliedAnsicht(id = 1, username = "ich", isSelf = true))
        val haushalt = allein + MitgliedAnsicht(id = 7, username = "lea")
        assertEquals("ohne Haushalt überschriebe die App eine Server-Vorgabe mit einer ID, die niemand gewählt hat",
            ErfassungsWerte(anzahl = 1, preis = 2.5, zustand = Zustand.GEBRAUCHT, besitzer = null),
            erfassungsWerte(anzahl = "", preis = "2,50", zustand = Zustand.GEBRAUCHT, besitzer = 7, haushalt = allein))
        assertEquals(ErfassungsWerte(anzahl = 3, preis = null, zustand = Zustand.NEU, besitzer = 7),
            erfassungsWerte(anzahl = "3", preis = "", zustand = Zustand.NEU, besitzer = 7, haushalt = haushalt))
    }
}
