package ch.brickinventoryapp

import org.junit.Test

/**
 * Der Navigationsaufbau baut Navigation — sonst nichts.
 *
 * ── Warum (Nachtrag 97) ─────────────────────────────────────────────────────
 *
 * `BrickInventoryManagerApp()` war 277 Zeilen lang. Davon waren rund fünfzehn
 * der eigentliche NavHost; den grössten Block machte ein AlertDialog aus, der
 * nach einem Barcode-Scan Menge, Kaufpreis, Zustand und Eigentümer erfasst.
 *
 * Dasselbe Muster wie im Webfrontend, wo Kaufpreis- und Detailfenster in
 * js/07-admin.js lagen: Ein Dialog liegt dort, wo er AUFGERUFEN wird, statt wo
 * er hingehört. Wer am Navigationsaufbau etwas ändern wollte, las erst an einem
 * Erfassungsformular vorbei.
 *
 * Diese Prüfung hält den Zustand danach fest, damit der nächste Dialog nicht
 * wieder dort landet.
 */
class NavigationHostSizeTest {

    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    private fun code(src: String) = src.lines()
        .joinToString("\n") { val t = it.trim(); if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else it }

    @Test
    fun `der Navigationsaufbau enthaelt keine Dialoge`() {
        val nav = code(read("AppNavigation.kt"))

        // AlertDialog/Dialog gehören in eine eigene Datei unter ui/dialogs/.
        // Der AUFRUF bleibt hier — an genau einer Stelle steht damit, WANN ein
        // Dialog erscheint; das WIE steht woanders.
        assert(!nav.contains("AlertDialog(")) {
            "AppNavigation.kt baut wieder selbst einen Dialog. Er gehört nach " +
                "ui/dialogs/ — der Navigationsaufbau soll Navigation aufbauen."
        }
        assert(nav.contains("BarcodeResultDialog(")) {
            "Der Barcode-Dialog wird gar nicht mehr aufgerufen"
        }
        // Die Bedingung bleibt beim Aufrufer, damit an EINER Stelle steht,
        // wann der Dialog erscheint.
        assert(nav.contains("barcodeState.result != null")) {
            "Die Bedingung ist mitgewandert — dann steht das WANN nicht mehr hier"
        }
    }

    @Test
    fun `die Datei bleibt in einer lesbaren Groesse`() {
        // Kein Selbstzweck: 277 Zeilen waren der Zustand, der den Dialog
        // überhaupt so lange unsichtbar gemacht hat. Die Schwelle ist grosszügig
        // gesetzt — sie soll den nächsten grossen Block auffangen, nicht jede
        // hinzugefügte Route.
        val zeilen = read("AppNavigation.kt").lines().size
        assert(zeilen < 260) {
            "AppNavigation.kt hat $zeilen Zeilen. Beim letzten Mal war ein " +
                "Erfassungsformular hineingewandert — gehört hier etwas hinein, " +
                "das keine Navigation ist?"
        }
    }

    @Test
    fun `der Dialog liest seinen Zustand selbst`() {
        // Dieselbe Bauart wie die Reiter-Bildschirme seit Nachtrag 96.
        val dlg = code(read("ui/dialogs/BarcodeResultDialog.kt"))
        assert(dlg.contains("vm: MainViewModel")) { "Der Dialog nimmt kein ViewModel" }
        assert(dlg.contains("vm.state.collectAsStateWithLifecycle()")) {
            "Der Dialog liest den Zustand nicht selbst"
        }
        assert(!dlg.contains("navController")) {
            "Der Dialog navigiert selbst — dann ist er an seinen Platz gebunden"
        }
    }
}
