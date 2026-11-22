package ch.brickinventoryapp.collection

import ch.brickinventoryapp.collection.ui.screens.setNumberCandidates
import org.json.JSONObject
import org.junit.Test
import java.io.File

/**
 * The SHARED corpus: the web app and the Android app must read the same set number.
 *
 * ── Why a shared file ─────────────────────────────────────────────
 *
 * The same question — "which number in this text is the set number?" — is
 * answered twice: here in Kotlin for text recognition (offline, in the
 * camera loop) and in `Web-App/utils/produkttitel.ts` for dealer titles. A
 * shared call is not possible; a shared TEST CORPUS is.
 *
 * MEASURED, before it existed:
 *
 *   Rule                                       Server   App
 *   filter out a quantity statement ("3696 Pcs")  yes    NO
 *   reset a year number                            yes    NO
 *   order by digit count                           NO     yes
 *   three-digit set numbers (375, 928)             NO     NO
 *
 * The two versions answered the same question differently, and no
 * check said anything about it.
 *
 * ── Why nothing is listed here ─────────────────────────────────────
 *
 * The cases live in shared/setnummer-korpus.json, along with the reasoning for each case.
 * A new case is entered ONCE and from then on checks both apps.
 * The counter-check on the other side is Web-App/test/set-number-corpus.test.js.
 *
 * Self-proof via minimum counts: if the reading in went wrong, the
 * loop would be empty and the test green, without having checked anything.
 */
class SetNumberCorpusTest {

    /** Path relative to the module directory `Android-App/app` — as in ApkNameTest. */
    private val corpus by lazy {
        JSONObject(File("../../shared/setnummer-korpus.json").readText())
            .getJSONArray("faelle")
    }

    @Test
    fun `every case of the common corpus delivers the same first candidate`() {
        var withExpectation = 0
        var withoutCandidate = 0
        var threeDigit = 0
        for (i in 0 until corpus.length()) {
            val fall = corpus.getJSONObject(i)
            val text = fall.getString("text")
            val expected = if (fall.isNull("erwartet")) null else fall.getString("erwartet")
            val why = fall.getString("warum")
            val k = setNumberCandidates(text)
            val actual = k.firstOrNull()
            assert(actual == expected) {
                "Korpusfall $i: ${text.replace("\n", "\\n")}\n" +
                "  erwartet: $expected\n  bekommen: $actual  (alle: $k)\n  warum: $why"
            }
            if (expected == null) withoutCandidate++ else withExpectation++
            if (expected != null && expected.length == 3) threeDigit++
        }

        // Self-proof 1: the corpus was really read and is not empty.
        assert(corpus.length() >= 15) {
            "Nur ${corpus.length()} Faelle im Korpus — Datei geschrumpft oder falscher Pfad?"
        }
        // Self-proof 2: both directions are represented. Without this the
        // corpus could degrade into nothing but misses and still be green.
        assert(withExpectation >= 10) { "nur $withExpectation Faelle mit erwarteter Nummer" }
        assert(withoutCandidate >= 2) { "nur $withoutCandidate Faelle, die gar nichts liefern duerfen" }
        // Self-proof 3: the occasion for this round — three-digit legacy sets — is
        // covered. If support drops out again, it turns red.
        assert(threeDigit >= 2) { "nur $threeDigit dreistellige Setnummern im Korpus" }
    }
}
