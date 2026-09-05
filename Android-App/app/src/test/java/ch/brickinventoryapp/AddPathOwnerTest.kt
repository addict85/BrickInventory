package ch.brickinventoryapp

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
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /** Kommentare ausblenden — die Erklärtexte nennen die geprüften Muster selbst. */
    private fun code(src: String) = src.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `der Barcode-Weg reicht den Eigentuemer an das Repository durch`() {
        val feature = code(read("ui/BarcodeFeature.kt"))
        assert(feature.contains("ownerUserId")) {
            "confirmAddBarcode kennt keinen Eigentümer — ein per Barcode erfasstes Set " +
                "landet dann immer beim eigenen Konto"
        }
        assert(Regex("""repo\.sets\.addSet\([^)]*ownerUserId""").containsMatchIn(feature)) {
            "der Eigentümer wird nicht an repo.sets.addSet() weitergereicht"
        }
    }

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
        assert(nav.contains("state.householdMembers")) {
            "die Auswahl braucht die Haushaltsmitglieder aus dem Zustand"
        }
        // Ohne Haushalt darf nichts mitgeschickt werden — sonst überschriebe die
        // App eine Server-Vorgabe mit einer ID, die niemand gewählt hat.
        assert(nav.contains("state.householdMembers.size > 1")) {
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
     * ── Nachtrag 140: die Regel steht jetzt an einer Stelle ─────────────────
     *
     * „Ohne Haushalt geht KEIN Eigentümer mit" stand in beiden manuellen
     * Dialogen wörtlich als `if (householdMembers.size > 1) owner else null` —
     * zusammen mit drei weiteren Umrechnungen, die dort ebenfalls doppelt
     * standen. Sie sind nach `erfassungsWerte()` gewandert
     * (ManualItemComposables.kt).
     *
     * Geprüft wird deshalb beides: dass die Dialoge die Umrechnung benutzen,
     * und dass sie die Regel enthält. Nur das erste wäre zu wenig — eine
     * Funktion dieses Namens könnte alles Mögliche tun.
     */
    @Test
    fun `ohne Haushalt geht kein Eigentuemer mit`() {
        for (datei in listOf("ui/screens/PartsDialogs.kt", "ui/screens/MinifigsScreen.kt")) {
            assert(code(read(datei)).contains("erfassungsWerte(")) {
                "$datei rechnet die Eingaben wieder selbst um statt über erfassungsWerte()"
            }
        }
        val gemeinsam = code(read("ui/screens/ManualItemComposables.kt"))
        assert(gemeinsam.contains("if (haushalt.size > 1) besitzer else null")) {
            "erfassungsWerte() schickt den Eigentümer auch ohne Haushalt mit — dann " +
                "überschreibt die App eine Server-Vorgabe mit einer ID, die niemand gewählt hat"
        }
        // Und die drei anderen Entscheidungen derselben Umrechnung, jede eine
        // eigene Aussage über eine leere Eingabe.
        assert(gemeinsam.contains("anzahl.toIntOrNull() ?: 1")) { "leere Anzahl heisst 1, nicht 0" }
        assert(gemeinsam.contains("notiz.ifBlank { null }")) { "leere Notiz heisst „keine\"" }
        assert(gemeinsam.contains("preis.replace(',', '.')")) {
            "das Komma der deutschen Tastatur muss zum Punkt werden, sonst kommt beim " +
                "Server keine Zahl an"
        }
    }
}
