package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * Text recognition reads the set number from the INSTRUCTION. There is no barcode there,
 * and the camera sees several numbers: without the filter nonsense would come out constantly.
 *
 * ── What is NO longer here ───────────────────────────────────────────────────
 * The selection rule itself (which number in the text is the set number) is checked against
 * the common corpus so that web app and Android app give the same
 * answer: SetNumberCorpusTest, shared/setnummer-korpus.json.
 *
 * KNOWN LIMIT, deliberately left so: if two numbers are equally plausible,
 * the wrong one can win. Against that stands the confirmation dialog with image and
 * name — and it explicitly says that the number is
 * guessed (the uncertain flag of BarcodeUiState). It is part of the design, not just
 * politeness.
 */
class OcrSetNumberTest {

    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `text recognition runs ONLY when adding, not in the price comparison`() {
        // The switch is OFF: that way no future caller inherits text recognition.
        val screen = code(File(Sources.root,
            "collection/ui/screens/BarcodeScannerScreen.kt").readText())
        assert(screen.contains("ocrEnabled: Boolean = false")) {
            "Der Standard muss AUS sein — sonst bekommt jeder Aufrufer die Texterkennung ungefragt"
        }

        // The scanner for gallery and parts list switches it on …
        val tools = code(File(Sources.root,
            "collection/ui/CollectionGraph.kt").readText())
        assert(tools.contains("ocrEnabled = true")) {
            "Beim Erfassen fehlt die Texterkennung — genau dort ist sie gewollt"
        }

        // … the price comparison does not.
        val comparison = code(File(Sources.root,
            "collection/ui/screens/ComparisonScreen.kt").readText())
        assert(!comparison.contains("ocrEnabled")) {
            "Der Preisvergleich schaltet die Texterkennung ein — dort ist sie ausdrücklich nicht gewollt"
        }
    }

    // The candidate rule itself (suffix, digit counts, order and
    // element numbers, years, quantities, three-digit old sets) no longer
    // stands here: it must come out the same in BOTH apps and is therefore
    // checked against the common corpus — SetNumberCorpusTest and
    // shared/setnummer-korpus.json. The same enumeration used to stand here a second
    // time, and only the app side was covered by it.
}
