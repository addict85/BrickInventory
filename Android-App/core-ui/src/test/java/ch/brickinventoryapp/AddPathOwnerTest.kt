package ch.brickinventoryapp

import org.junit.Assert.assertEquals
import ch.brickinventoryapp.ui.model.MitgliedAnsicht
import ch.brickinventoryapp.ui.erfassungsWerte
import ch.brickinventoryapp.ui.ErfassungsWerte
import org.junit.Test

/**
 * Jeder Erfassungsweg lässt den Eigentümer wählen — auch der Barcode-Scanner.
 *
 * ── Woher dieser Test kommt (Marcos Bericht, Nachtrag 44) ───────────────────
 * „In der Android-App kann der Eigentümer bei der Erfassung mit dem Barcode
 * nicht ausgewählt werden."
 *
 * Repository, API-Vertrag und Server-Route kannten den Eigentümer seit jeher
 * (`addSet(..., ownerUserId)`); der Galerie-Dialog, die Teile- und die
 * Minifiguren-Erfassung fragen ihn über OwnerPicker ab. Nur der
 * Barcode-Dialog tat es nicht — er rief `repo.addSet(setNum, 1, price,
 * condition)` ohne den fünften Parameter. Das Ergebnis war kein Fehler,
 * sondern etwas Stilleres: Ein per Barcode erfasstes Set landete IMMER beim
 * eigenen Konto, ohne dass es jemand merkte.
 *
 * Wieder das Muster, das sich durch dieses Projekt zieht: eine Regel fehlt an
 * einem ZWEITEN Weg (vgl. requireAdmin, forgot-password, die Preisroute im
 * Haushalt). Deshalb prüft dieser Test nicht die eine reparierte Stelle,
 * sondern ALLE Erfassungswege — der nächste neue Weg soll hier auffallen.
 *
 * Gegenprobe (durchgeführt): ownerUserId aus dem confirmAddBarcode-Aufruf
 * entfernt → der erste Teilschritt wird rot.
 */
class AddPathOwnerTest {

    private fun read(rel: String): String {
        val f = java.io.File(Quellen.wurzel, "$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /** Kommentare ausblenden — die Erklärtexte nennen die geprüften Muster selbst. */
    private fun code(src: String) = src.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `der Barcode-Dialog zeigt die Auswahl an`() {
        // Der Barcode-Dialog steht seit seiner Auslagerung in
        // ui/dialogs/BarcodeResultDialog.kt; AppNavigation.kt ruft ihn nur noch
        // auf. Gelesen werden BEIDE Dateien, damit die Regel dort gefunden
        // wird, wo sie heute steht.
        val nav = code(read("AppNavigation.kt") + "\n" + read("ui/dialogs/BarcodeResultDialog.kt"))
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
            "ui/screens/GalleryScreen.kt"   to "Set über die Galerie",
            "ui/screens/PartsDialogs.kt"    to "manuelles Teil",
            "ui/screens/MinifigsScreen.kt"  to "manuelle Minifigur",
        )
        for ((datei, name) in wege) {
            assert(code(read(datei)).contains("OwnerPicker(")) {
                "Erfassungsweg ohne Eigentümer-Auswahl: $name ($datei)"
            }
        }
    }

    /**
     * Die Umrechnung der Eingaben steht an einer Stelle (erfassungsWerte, Nachtrag
     * 140): Die Dialoge benutzen sie (Struktur), und sie wird hier ausgeführt.
     * Gegenprobe (31.10.2026, gemessen): in erfassungsWerte `haushalt.size > 1` →
     * `haushalt.size > 0` → rot „ohne Haushalt geht kein Eigentuemer mit“.
     */
    @Test
    fun `ohne Haushalt geht kein Eigentuemer mit`() {
        for (datei in listOf("ui/screens/PartsDialogs.kt", "ui/screens/MinifigsScreen.kt")) {
            assert(code(read(datei)).contains("erfassungsWerte(")) {
                "$datei rechnet die Eingaben wieder selbst um statt über erfassungsWerte()"
            }
        }
        val allein = listOf(MitgliedAnsicht(id = 1, username = "ich", isSelf = true))
        val haushalt = allein + MitgliedAnsicht(id = 7, username = "lea")
        assertEquals("ohne Haushalt überschriebe die App eine Server-Vorgabe mit einer ID, die niemand gewählt hat",
            ErfassungsWerte(anzahl = 1, preis = 2.5, zustand = "U", besitzer = null),
            erfassungsWerte(anzahl = "", preis = "2,50", zustand = "U", besitzer = 7, haushalt = allein))
        assertEquals(ErfassungsWerte(anzahl = 3, preis = null, zustand = "N", besitzer = 7),
            erfassungsWerte(anzahl = "3", preis = "", zustand = "N", besitzer = 7, haushalt = haushalt))
    }

}
