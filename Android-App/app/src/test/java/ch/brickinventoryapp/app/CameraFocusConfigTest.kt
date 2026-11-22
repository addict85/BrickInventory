package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * The focus settings of the barcode scanner.
 *
 * ── The error ────────────────────────────────────────────────────────────────
 * On the same `previewView` there were TWO `setOnTouchListener`. That does not
 * add, it REPLACES: the second ran later (in the camera callback) and silently
 * overwrote the first.
 *
 * Effective was thus the version with `setAutoCancelDuration(3, SECONDS)` — and
 * exactly that is what the comment in the code warns about: „Bewusst mit disableAutoCancel():
 * Ohne das fällt die Kamera nach wenigen Sekunden auf ihre eigene Wahl zurück."
 * One taps, it becomes sharp, and seconds later it is gone again.
 */
class CameraFocusConfigTest {

    private fun scanner(): String =
        File(Sources.root, "collection/ui/screens/BarcodeScannerScreen.kt").readText()

    private fun code(src: String) = src.lines()
        .joinToString("\n") { val t = it.trim(); if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else it }

    private fun setup(): String = code(Sources.read("ui/screens/CameraSetup.kt"))

    @Test
    fun `exactly ONE tap-to-focus listener`() {
        // Since the tapper lives in CameraSetup.kt (tapToFocus), every scanner sets it
        // exactly once and none sets its own next to it.
        val count = Regex("""\.setOnTouchListener""").findAll(setup()).count() +
            Regex("""\.setOnTouchListener""").findAll(code(scanner())).count()
        assert(Regex("""\btapToFocus\(""").findAll(code(scanner())).count() == 1) {
            "Der Barcodescanner setzt den Tipper nicht genau einmal"
        }
        assert(count == 1) {
            "$count Touch-Listener auf previewView. setOnTouchListener ERSETZT — " +
                "der zuletzt gesetzte gewinnt, und welcher das ist, hängt davon ab, " +
                "wann der Kamera-Rückruf eintrifft. Genau daran ist der Autofokus " +
                "gescheitert."
        }
    }

    /**
     * Every file that offers tap-to-focus — not only the scanner.
     *
     * The SetupScreen offers the same as BarcodeScannerScreen.kt; a rule
     * that looks at only one copy leaves the other behind.
     *
     * The list is therefore not enumerated but FOUND: whoever builds a
     * third camera view is checked immediately, without touching this file.
     * An enumerated list would have been the third version of the same
     * rule.
     *
     * ── Counter-check ───────────────────────────────────────
     * The extended check was DELIBERATELY published alone, before the
     * fix. The run reported `354 tests completed, 1 failed`, namely
     * exactly this test. So the error was real and not staged —
     * an artificially built-in breakage would only have shown that the check
     * applies, not that it found something.
     *
     * Incidentally, the finding was not found by this test but by a
     * comparison of equal code blocks across the whole tree. A rule that stands in
     * two places looks right in each single place.
     */
    private fun withTapToFocus(): List<File> {
        // Die Bildschirme liegen je Modul unter <stamm>/ui/screens; below() sammelt alle.
        val hits = Sources.below("ui/screens")
            .filter { code(it.readText()).let { c -> c.contains("tapToFocus(") || c.contains("startFocusAndMetering(") } }
        assert(hits.size >= 2) {
            "Nur ${hits.size} FileEntry(en) mit Tap-to-Focus gefunden. Erwartet " +
                "werden mindestens der Barcodescanner und der SetupScreen — " +
                "findet die Suche weniger, prüft dieser Test nichts und wäre " +
                "trotzdem grün."
        }
        return hits
    }

    @Test
    fun `tap-to-focus keeps the focus`() {
        for (file in withTapToFocus()) {
            // The tapper itself lives in CameraSetup.kt; it is checked there for every user.
            val c = code(file.readText()) + "\n" + setup()
            assert(c.contains("disableAutoCancel()")) {
                "${file.name}: Ohne disableAutoCancel() fällt die Kamera nach " +
                    "wenigen Sekunden auf ihre eigene Wahl zurück — der Nutzer " +
                    "stellt gezielt scharf, und es ist gleich wieder weg."
            }
            assert(!c.contains("setAutoCancelDuration")) {
                "${file.name}: setAutoCancelDuration ist da. Das ist das Gegenteil " +
                    "von disableAutoCancel() und war schon einmal die Ursache."
            }
        }
    }

    /**
     * The whole camera setup stands in ONE place.
     *
     * ── Why the rule became stricter ─────────────────────────────────────────
     * At the very beginning this test counted occurrences of the string
     * `CONTROL_AF_MODE_CONTINUOUS_PICTURE` in the individual screen files:
     *
     * Then it read „whoever builds a preview must set the AF mode" —
     * the version for a world with two copies. Since the BINDING
     * has also been merged (19 of 23 lines were character-identical), nobody
     * except CameraSetup.kt builds a preview, an image analysis or a
     * binding any more. That allows checking the stronger rule: there is only one place.
     *
     * The rework reported this check itself as red — it found only
     * ONE file with `Preview.Builder()` and required at least two. That
     * was no violation but the proof that the merge took
     * effect; the rule has been adjusted to the new structure.
     */
    @Test
    fun `the camera setup lives only in CameraSetup`() {
        val files = Sources.below("ui/screens")
        assert(files.size >= 5) {
            "Nur ${files.size} Bildschirmdateien gefunden — der Pfad stimmt nicht, und ein " +
                "leeres Ergebnis würde diesen Test stillschweigend bestehen lassen."
        }

        for ((brand, was) in listOf(
            "CONTROL_AF_MODE_CONTINUOUS_PICTURE" to "Der AF-Modus",
            "Preview.Builder()"                  to "Die Vorschau",
            "ImageAnalysis.Builder()"            to "Die Bildanalyse",
            "bindToLifecycle("                   to "Die Bindung",
        )) {
            val where = files.filter { code(it.readText()).contains(brand) }.map { it.name }
            assert(where == listOf("CameraSetup.kt")) {
                "$was ($brand) steht in ${where.joinToString()} statt nur in CameraSetup.kt. " +
                    "Jede weitere Stelle ist eine zweite Fassung derselben Regel — und genau " +
                    "daran ist der Tap-to-Focus im SetupScreen hängengeblieben."
            }
        }
    }

    @Test
    fun `CameraSetup sets the AF mode on BOTH use cases`() {
        // CameraX merges the configurations of all bound use cases into ONE
        // repeating request. If the mode is only on one, the other decides along
        // depending on the device — and the image stays blurry although
        // the code looks right.
        val src = code(Sources.read("ui/screens/CameraSetup.kt"))
        val n = Regex("CONTROL_AF_MODE_CONTINUOUS_PICTURE").findAll(src).count()
        assert(n >= 2) {
            "Der AF-Modus steht in CameraSetup.kt nur ${n}x — er muss an Vorschau UND " +
                "Bildanalyse hängen. NICHT diesen Test anpassen, sondern die Stelle ergänzen."
        }
    }

    @Test
    fun `both scanners get their camera there`() {
        // Otherwise the rule above is of no use: whoever binds the camera themselves
        // bypasses autofocusPermanent() — and looks right doing so.
        val user = Sources.below("ui/screens")
            .filter { it.name != "CameraSetup.kt" }
            .filter { code(it.readText()).contains("cameraBind(") }
            .map { it.name }
        assert(user.size >= 2) {
            "Nur ${user.size} Bildschirm(e) rufen cameraBind() (${user.joinToString()}). " +
                "Erwartet werden Barcodescanner und SetupScreen."
        }
    }

    @Test
    fun `the tapper lives only in CameraSetup`() {
        // Like preview and binding: a copy in the screen missed the next fix.
        val own = withTapToFocus().filter { it.name != "CameraSetup.kt" && code(it.readText()).contains("startFocusAndMetering(") }
        assert(own.isEmpty()) { "Eigener Tap-to-Focus statt tapToFocus(): ${own.joinToString { it.name }}" }
        assert(setup().contains("startFocusAndMetering(")) { "CameraSetup.kt fokussiert beim Tippen nicht mehr" }
    }

    @Test
    fun `no periodic refocusing`() {
        // A startFocusAndMetering running on a timer interrupts the
        // continuous autofocus again and again. Focusing happens ONLY on
        // tapping.
        val pump = Regex(
            """(while\s*\(|delay\s*\(|Timer\(|fixedRate|LaunchedEffect)[\s\S]{0,400}?(startFocusAndMetering|tapToFocus)""")
        val files = withTapToFocus()
        assert(files.size >= 2) {
            "Nur ${files.size} FileEntry(en) mit startFocusAndMetering gefunden — " +
                "erwartet werden mindestens Barcodescanner und SetupScreen. " +
                "Ein leeres Ergebnis wuerde diesen Test stillschweigend bestehen lassen."
        }
        for (file in files) {
            assert(!pump.containsMatchIn(code(file.readText()))) {
                "${file.name}: startFocusAndMetering laeuft in einer Schleife, hinter " +
                    "einem Timer oder in einem Effekt (Fokus-Pump) — das zwingt die " +
                    "Kamera dauernd in einen neuen Suchlauf."
            }
        }
    }
}
