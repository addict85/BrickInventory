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
 * exactly that is what the comment in the code warns about: „Bewusst mit disableAutoCancel(): Ohne das fällt die Kamera nach wenigen Sekunden auf ihre eigene Wahl zurück.“
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
            "the barcode scanner does not set the tapper exactly once"
        }
        assert(count == 1) {
            "$count touch listeners on previewView. setOnTouchListener REPLACES — " +
                "the one set last wins, and which one that is depends on " +
                "when the camera callback arrives. Exactly that is where autofocus " +
                "failed."
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
            "Only ${hits.size} FileEntry(s) with tap-to-focus found. Expected " +
                "are at least the barcode scanner and the SetupScreen — " +
                "if the search finds fewer, this test checks nothing and would " +
                "still be green."
        }
        return hits
    }

    @Test
    fun `tap-to-focus keeps the focus`() {
        for (file in withTapToFocus()) {
            // The tapper itself lives in CameraSetup.kt; it is checked there for every user.
            val c = code(file.readText()) + "\n" + setup()
            assert(c.contains("disableAutoCancel()")) {
                "${file.name}: Without disableAutoCancel() the camera falls back to its own choice after " +
                    "a few seconds — the user " +
                    "focuses on purpose, and it is gone right away."
            }
            assert(!c.contains("setAutoCancelDuration")) {
                "${file.name}: setAutoCancelDuration is there. That is the opposite " +
                    "of disableAutoCancel() and was the cause once before."
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
     * Then it read „whoever builds a preview must set the AF mode“ —
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
            "Only ${files.size} screen files found — the path is wrong, and an " +
                "empty result would let this test pass silently."
        }

        for ((brand, was) in listOf(
            "CONTROL_AF_MODE_CONTINUOUS_PICTURE" to "Der AF-Modus",
            "Preview.Builder()"                  to "Die Vorschau",
            "ImageAnalysis.Builder()"            to "Die Bildanalyse",
            "bindToLifecycle("                   to "Die Bindung",
        )) {
            val where = files.filter { code(it.readText()).contains(brand) }.map { it.name }
            assert(where == listOf("CameraSetup.kt")) {
                "$was ($brand) stands in ${where.joinToString()} instead of only in CameraSetup.kt. " +
                    "Every further place is a second version of the same rule — and exactly " +
                    "there tap-to-focus in the SetupScreen got stuck."
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
            "The AF mode stands in CameraSetup.kt only ${n}x — it must hang on preview AND " +
                "image analysis. Do NOT adapt this test, add the place instead."
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
            "Only ${user.size} screen(s) call cameraBind() (${user.joinToString()}). " +
                "Expected are the barcode scanner and SetupScreen."
        }
    }

    @Test
    fun `the tapper lives only in CameraSetup`() {
        // Like preview and binding: a copy in the screen missed the next fix.
        val own = withTapToFocus().filter { it.name != "CameraSetup.kt" && code(it.readText()).contains("startFocusAndMetering(") }
        assert(own.isEmpty()) { "own tap-to-focus instead of tapToFocus(): ${own.joinToString { it.name }}" }
        assert(setup().contains("startFocusAndMetering(")) { "CameraSetup.kt no longer focuses on tap" }
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
            "Only ${files.size} FileEntry(s) with startFocusAndMetering found — " +
                "expected are at least the barcode scanner and SetupScreen. " +
                "An empty result would let this test pass silently."
        }
        for (file in files) {
            assert(!pump.containsMatchIn(code(file.readText()))) {
                "${file.name}: startFocusAndMetering runs in a loop, behind " +
                    "a timer or in an effect (focus pump) — that forces the " +
                    "camera into a new search run all the time."
            }
        }
    }
}
