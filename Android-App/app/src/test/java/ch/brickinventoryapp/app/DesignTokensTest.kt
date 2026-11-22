package ch.brickinventoryapp.app

import org.junit.Test
import ch.brickinventoryapp.testing.Sources

/**
 * Shapes and colors live in the design, not in the screen.
 */
class DesignTokensTest {

    private val themeFolder = "ui/theme"

    @Test
    fun `no fixed corner radii outside the design`() {
        val error = mutableListOf<String>()
        for (file in Sources.all()) {
            if (file.invariantSeparatorsPath.contains("/$themeFolder/")) continue
            val s = Sources.withoutComments(file.readText())
            Regex("""RoundedCornerShape\(\d+\.dp\)""").findAll(s).forEach { m ->
                val row = s.substring(0, m.range.first).count { it == '\n' } + 1
                error += "${file.name}:$row  ${m.value}"
            }
        }
        assert(error.isEmpty()) {
            "Feste Eckenradien ausserhalb von $themeFolder/ (${error.size}):\n  " +
                error.joinToString("\n  ") +
                "\nDafür gibt es Formen.karte/chip/feld/kachel/leiste/etikett/marke/fab/strich. " +
                "Passt keine, gehört eine NEUE dorthin — sonst ist die nächste " +
                "Designänderung wieder eine Suche über den ganzen Baum."
        }
    }

    @Test
    fun `no fixed colors outside the design`() {
        val error = mutableListOf<String>()
        for (file in Sources.all()) {
            if (file.invariantSeparatorsPath.contains("/$themeFolder/")) continue
            val s = Sources.withoutComments(file.readText())
            Regex("""Color\(0x[0-9A-Fa-f]{8}\)""").findAll(s).forEach { m ->
                val row = s.substring(0, m.range.first).count { it == '\n' } + 1
                error += "${file.name}:$row  ${m.value}"
            }
        }
        assert(error.isEmpty()) {
            "Feste Farben ausserhalb von $themeFolder/ (${error.size}):\n  " +
                error.joinToString("\n  ") +
                "\nFür Zustände gibt es LocalStatusColors (erfolg/warnung/fehler), " +
                "für das Diagramm LocalChartColors. Eine Farbe, die im Bildschirm " +
                "steht, zieht beim Designwechsel nicht mit."
        }
    }

    @Test
    fun `no fixed elevations outside the design`() {
        // There are two: flat (lists, sections) and high (sign-in,
        // dialogs, key figures). A third number in the screen means that
        // someone invented a third meaning without naming it.
        val template = Regex(
            """cardElevation\(defaultElevation = \d+\.dp\)"""
        )
        val error = Sources.all()
            .filter { !it.invariantSeparatorsPath.contains("/$themeFolder/") }
            .filter { template.containsMatchIn(Sources.withoutComments(it.readText())) }
            .map { it.name }
        assert(error.isEmpty()) {
            "Diese Dateien setzen die Karten-Erhebung als Zahl: ${error.joinToString()}. " +
                "Dafür gibt es Formen.karteErhebung und Formen.karteErhebungHoch — " +
                "oder gleich AppCard."
        }
    }

    @Test
    fun `both designs supply status and chart colors`() {
        // A design that does not set one of the two groups falls back to the
        // CompositionLocal's default — and that is the classic one.
        // In the stone design a Prussian blue would then stand next to
        // sage green again, only this time without anyone noticing.
        val theme = Sources.withoutComments(Sources.read("ui/theme/Theme.kt"))
        assert(theme.contains("LocalStatusColors provides")) { "Statusfarben werden nicht bereitgestellt" }
        assert(theme.contains("LocalChartColors  provides") || theme.contains("LocalChartColors provides")) {
            "Diagrammfarben werden nicht bereitgestellt"
        }
        val branches = Regex("""StatusColors\(""").findAll(theme).count()
        assert(branches >= 2) {
            "Nur $branches StatusColors-Zweig(e) in Theme.kt — dann teilt sich " +
                "mindestens ein Design die Farben eines anderen"
        }
    }

    /**
     * No input field uses the angular Material default: storage location and selection fields
     * stood angular next to rounded text fields. Each names its shape from the design
     * (Formen.feld; search bars and table fields deliberately their own).
     * Counter-check (counter-checks/lagerort-feld-eckig.patch): `shape = Shapes.field` removed from the
     * storage location field → red with „LocationField.kt“.
     */
    @Test
    fun `no input field uses the angular default`() {
        val call = Regex("""\b(OutlinedTextField|TextField)\(""")
        val error = mutableListOf<String>()
        var seen = 0
        for (file in Sources.all()) {
            val s = Sources.withoutComments(file.readText())
                .replace(Regex(""""(?:\\.|[^"\\\n])*""""), "\"\"")
            for (m in call.findAll(s)) {
                var depth = 0
                var end = m.range.last
                while (end < s.length) {
                    if (s[end] == '(') depth++ else if (s[end] == ')' && --depth == 0) break
                    end++
                }
                seen++
                val arguments = s.substring(m.range.last, minOf(end + 1, s.length))
                if (!Regex("""\bshape\s*=\s*(ch\.brickinventoryapp\.ui\.theme\.)?(Shapes|MaterialTheme\.shapes)\.""").containsMatchIn(arguments)) {
                    error += "${file.name}:${s.substring(0, m.range.first).count { it == '\n' } + 1}"
                }
            }
        }
        assert(seen >= 30) { "Nur $seen Eingabefelder gefunden — greift die Suche noch?" }
        assert(error.isEmpty()) {
            "Eingabefelder in der eckigen Vorgabe (${error.size}):\n  " + error.joinToString("\n  ") +
                "\nshape = Shapes.field setzen — wie jedes andere Feld."
        }
    }

    /**
     * One button shape for the whole app: the pill of the Material default; otherwise it changed
     * from screen to screen in the flow setup → sign-in. Every outlined button
     * carries secondaryButtonColors/-Rand or is red as a danger; otherwise it looked disabled.
     *
     * Counter-checks: knopf-mit-eigener-form (`shape = Shapes.field` in LoginScreen.LoadButton)
     * → red with „LoginScreen.kt“; nebenknopf-ohne-farben („Als Datei speichern“ of the
     * emergency codes without both) → red with „SecondFactorRequiredMask.kt“.
     */
    @Test
    fun `buttons all carry the same shape, secondary buttons the same colors`() {
        val call = Regex("""\b(Button|OutlinedButton|FilledTonalButton|ElevatedButton|TextButton)\(""")
        val error = mutableListOf<String>()
        val secondaryButtons = mutableListOf<String>()
        var seen = 0
        for (file in Sources.all()) {
            // Empty strings: a bracket in them would upset the bracket balance.
            val s = Sources.withoutComments(file.readText())
                .replace(Regex(""""(?:\\.|[^"\\\n])*""""), "\"\"")
            for (m in call.findAll(s)) {
                // The argument list up to the matching bracket; the content (lambda) follows after it.
                var depth = 0
                var end = m.range.last
                while (end < s.length) {
                    if (s[end] == '(') depth++ else if (s[end] == ')' && --depth == 0) break
                    end++
                }
                val arguments = s.substring(m.range.last, minOf(end + 1, s.length))
                val where = "${file.name}:${s.substring(0, m.range.first).count { it == '\n' } + 1}"
                if (Regex("""\bshape\s*=""").containsMatchIn(arguments)) error += "$where  ${m.value}"
                if (m.groupValues[1] == "OutlinedButton" && file.name !in VIA_THE_CAMERA_IMAGE) {
                    seen++
                    besideButtonError(arguments)?.let { secondaryButtons += "$where  $it" }
                }
            }
        }
        assert(seen >= 20) { "Nur $seen umrandete Knöpfe gefunden — greift die Suche noch?" }
        assert(error.isEmpty()) {
            "Knöpfe mit eigener Form (${error.size}):\n  " + error.joinToString("\n  ") +
                "\nKnöpfe tragen die Vorgabe des Themas; Formen.feld gilt nur für Eingabefelder."
        }
        assert(secondaryButtons.isEmpty()) {
            "Umrandete Knöpfe ohne secondaryButtonColors()/secondaryButtonRand() (${secondaryButtons.size}):\n  " +
                secondaryButtons.joinToString("\n  ")
        }
    }

    /** The lamp in the scanner lies on the camera image and carries white on black. */
    private val VIA_THE_CAMERA_IMAGE = setOf("BarcodeScannerScreen.kt")

    /** What an outlined button lacks, or null. Red (danger) replaces the secondary button's colors. */
    private fun besideButtonError(arguments: String): String? {
        val danger = "colorScheme.error" in arguments
        val edge = Regex("""\bborder\s*=\s*secondaryButtonRand\(([^)]*)\)""").find(arguments)
        return when {
            !danger && !Regex("""\bcolors\s*=\s*secondaryButtonColors\(\)""").containsMatchIn(arguments) -> "ohne secondaryButtonColors()"
            edge == null && !danger -> "ohne secondaryButtonRand()"
            edge != null && Regex("""\benabled\s*=""").containsMatchIn(arguments) && edge.groupValues[1].isBlank() ->
                "sperrbar, aber secondaryButtonRand() ohne den Zustand"
            else -> null
        }
    }
}
