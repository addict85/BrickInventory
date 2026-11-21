package ch.brickinventoryapp.app

import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

/**
 * Shapes and colors live in the design, not in the screen.
 */
class DesignTokensTest {

    private val themeFolder = "ui/theme"

    @Test
    fun `no fixed corner radii outside the design`() {
        val fehler = mutableListOf<String>()
        for (datei in Quellen.alle()) {
            if (datei.invariantSeparatorsPath.contains("/$themeFolder/")) continue
            val s = Quellen.withoutComments(datei.readText())
            Regex("""RoundedCornerShape\(\d+\.dp\)""").findAll(s).forEach { m ->
                val zeile = s.substring(0, m.range.first).count { it == '\n' } + 1
                fehler += "${datei.name}:$zeile  ${m.value}"
            }
        }
        assert(fehler.isEmpty()) {
            "Feste Eckenradien ausserhalb von $themeFolder/ (${fehler.size}):\n  " +
                fehler.joinToString("\n  ") +
                "\nDafür gibt es Formen.karte/chip/feld/kachel/leiste/etikett/marke/fab/strich. " +
                "Passt keine, gehört eine NEUE dorthin — sonst ist die nächste " +
                "Designänderung wieder eine Suche über den ganzen Baum."
        }
    }

    @Test
    fun `no fixed colors outside the design`() {
        val fehler = mutableListOf<String>()
        for (datei in Quellen.alle()) {
            if (datei.invariantSeparatorsPath.contains("/$themeFolder/")) continue
            val s = Quellen.withoutComments(datei.readText())
            Regex("""Color\(0x[0-9A-Fa-f]{8}\)""").findAll(s).forEach { m ->
                val zeile = s.substring(0, m.range.first).count { it == '\n' } + 1
                fehler += "${datei.name}:$zeile  ${m.value}"
            }
        }
        assert(fehler.isEmpty()) {
            "Feste Farben ausserhalb von $themeFolder/ (${fehler.size}):\n  " +
                fehler.joinToString("\n  ") +
                "\nFür Zustände gibt es LocalStatusFarben (erfolg/warnung/fehler), " +
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
        val fehler = Quellen.alle()
            .filter { !it.invariantSeparatorsPath.contains("/$themeFolder/") }
            .filter { template.containsMatchIn(Quellen.withoutComments(it.readText())) }
            .map { it.name }
        assert(fehler.isEmpty()) {
            "Diese Dateien setzen die Karten-Erhebung als Zahl: ${fehler.joinToString()}. " +
                "Dafür gibt es Formen.karteErhebung und Formen.karteErhebungHoch — " +
                "oder gleich AppKarte."
        }
    }

    @Test
    fun `both designs supply status and chart colors`() {
        // A design that does not set one of the two groups falls back to the
        // CompositionLocal's default — and that is the classic one.
        // In the stone design a Prussian blue would then stand next to
        // sage green again, only this time without anyone noticing.
        val theme = Quellen.withoutComments(Quellen.lies("ui/theme/Theme.kt"))
        assert(theme.contains("LocalStatusFarben provides")) { "Statusfarben werden nicht bereitgestellt" }
        assert(theme.contains("LocalChartColors  provides") || theme.contains("LocalChartColors provides")) {
            "Diagrammfarben werden nicht bereitgestellt"
        }
        val zweige = Regex("""StatusFarben\(""").findAll(theme).count()
        assert(zweige >= 2) {
            "Nur $zweige StatusFarben-Zweig(e) in Theme.kt — dann teilt sich " +
                "mindestens ein Design die Farben eines anderen"
        }
    }

    /**
     * No input field uses the angular Material default: storage location and selection fields
     * stood angular next to rounded text fields. Each names its shape from the design
     * (Formen.feld; search bars and table fields deliberately their own).
     * Counter-check (gegenproben/lagerort-feld-eckig.patch): `shape = Formen.feld` removed from the
     * storage location field → red with „LocationField.kt“.
     */
    @Test
    fun `no input field uses the angular default`() {
        val call = Regex("""\b(OutlinedTextField|TextField)\(""")
        val fehler = mutableListOf<String>()
        var gesehen = 0
        for (datei in Quellen.alle()) {
            val s = Quellen.withoutComments(datei.readText())
                .replace(Regex(""""(?:\\.|[^"\\\n])*""""), "\"\"")
            for (m in call.findAll(s)) {
                var tiefe = 0
                var ende = m.range.last
                while (ende < s.length) {
                    if (s[ende] == '(') tiefe++ else if (s[ende] == ')' && --tiefe == 0) break
                    ende++
                }
                gesehen++
                val arguments = s.substring(m.range.last, minOf(ende + 1, s.length))
                if (!Regex("""\bshape\s*=\s*(ch\.brickinventoryapp\.ui\.theme\.)?(Formen|MaterialTheme\.shapes)\.""").containsMatchIn(arguments)) {
                    fehler += "${datei.name}:${s.substring(0, m.range.first).count { it == '\n' } + 1}"
                }
            }
        }
        assert(gesehen >= 30) { "Nur $gesehen Eingabefelder gefunden — greift die Suche noch?" }
        assert(fehler.isEmpty()) {
            "Eingabefelder in der eckigen Vorgabe (${fehler.size}):\n  " + fehler.joinToString("\n  ") +
                "\nshape = Formen.feld setzen — wie jedes andere Feld."
        }
    }

    /**
     * One button shape for the whole app: the pill of the Material default; otherwise it changed
     * from screen to screen in the flow setup → sign-in. Every outlined button
     * carries nebenKnopfFarben/-Rand or is red as a danger; otherwise it looked disabled.
     *
     * Counter-checks: knopf-mit-eigener-form (`shape = Formen.feld` in LoginScreen.LoadButton)
     * → red with „LoginScreen.kt“; nebenknopf-ohne-farben („Als Datei speichern“ of the
     * emergency codes without both) → red with „ZweiterFaktorPflichtMaske.kt“.
     */
    @Test
    fun `buttons all carry the same shape, secondary buttons the same colors`() {
        val call = Regex("""\b(Button|OutlinedButton|FilledTonalButton|ElevatedButton|TextButton)\(""")
        val fehler = mutableListOf<String>()
        val nebenknoepfe = mutableListOf<String>()
        var gesehen = 0
        for (datei in Quellen.alle()) {
            // Empty strings: a bracket in them would upset the bracket balance.
            val s = Quellen.withoutComments(datei.readText())
                .replace(Regex(""""(?:\\.|[^"\\\n])*""""), "\"\"")
            for (m in call.findAll(s)) {
                // The argument list up to the matching bracket; the content (lambda) follows after it.
                var tiefe = 0
                var ende = m.range.last
                while (ende < s.length) {
                    if (s[ende] == '(') tiefe++ else if (s[ende] == ')' && --tiefe == 0) break
                    ende++
                }
                val arguments = s.substring(m.range.last, minOf(ende + 1, s.length))
                val wo = "${datei.name}:${s.substring(0, m.range.first).count { it == '\n' } + 1}"
                if (Regex("""\bshape\s*=""").containsMatchIn(arguments)) fehler += "$wo  ${m.value}"
                if (m.groupValues[1] == "OutlinedButton" && datei.name !in VIA_THE_CAMERA_IMAGE) {
                    gesehen++
                    besideButtonError(arguments)?.let { nebenknoepfe += "$wo  $it" }
                }
            }
        }
        assert(gesehen >= 20) { "Nur $gesehen umrandete Knöpfe gefunden — greift die Suche noch?" }
        assert(fehler.isEmpty()) {
            "Knöpfe mit eigener Form (${fehler.size}):\n  " + fehler.joinToString("\n  ") +
                "\nKnöpfe tragen die Vorgabe des Themas; Formen.feld gilt nur für Eingabefelder."
        }
        assert(nebenknoepfe.isEmpty()) {
            "Umrandete Knöpfe ohne nebenKnopfFarben()/nebenKnopfRand() (${nebenknoepfe.size}):\n  " +
                nebenknoepfe.joinToString("\n  ")
        }
    }

    /** The lamp in the scanner lies on the camera image and carries white on black. */
    private val VIA_THE_CAMERA_IMAGE = setOf("BarcodeScannerScreen.kt")

    /** What an outlined button lacks, or null. Red (danger) replaces the secondary button's colors. */
    private fun besideButtonError(arguments: String): String? {
        val danger = "colorScheme.error" in arguments
        val edge = Regex("""\bborder\s*=\s*nebenKnopfRand\(([^)]*)\)""").find(arguments)
        return when {
            !danger && !Regex("""\bcolors\s*=\s*nebenKnopfFarben\(\)""").containsMatchIn(arguments) -> "ohne nebenKnopfFarben()"
            edge == null && !danger -> "ohne nebenKnopfRand()"
            edge != null && Regex("""\benabled\s*=""").containsMatchIn(arguments) && edge.groupValues[1].isBlank() ->
                "sperrbar, aber nebenKnopfRand() ohne den Zustand"
            else -> null
        }
    }
}
