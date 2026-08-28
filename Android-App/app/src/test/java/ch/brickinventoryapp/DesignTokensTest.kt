package ch.brickinventoryapp

import org.junit.Test

/**
 * Formen und Farben stehen im Design, nicht im Bildschirm.
 *
 * ── Woher dieser Test kommt (Nachtrag 120) ──────────────────────────────────
 *
 * Die FARBEN machten es längst richtig: zwei Designs über `colorScheme`,
 * Diagrammfarben über `LocalChartColors`. Formen und Erhebungen waren von
 * dieser Sorgfalt ausgenommen — 129 fest eingetragene
 * `RoundedCornerShape(N.dp)` in neun Radien, und die Kartenoptik stand
 * siebenmal wörtlich da. „Mach die Karten runder" hiess: vierzehn Stellen
 * suchen und hoffen, keine zu übersehen.
 *
 * Dazu zwölf feste Farben im Quelltext, darunter ZWEI verschiedene Grüns für
 * dieselbe Aussage („erfolgreich") in vier Dateien. Im Stein-Design zogen sie
 * nicht mit.
 *
 * Der Umbau hat die Werte nur VERSCHOBEN, nicht geändert — bis auf die
 * Vereinheitlichung der beiden Grüns. Dieser Test hält fest, dass sie dort
 * bleiben.
 */
class DesignTokensTest {

    private val themeOrdner = "ui/theme"

    @Test
    fun `keine festen Eckenradien ausserhalb des Designs`() {
        val fehler = mutableListOf<String>()
        for (datei in Quellen.alle()) {
            if (datei.invariantSeparatorsPath.contains("/$themeOrdner/")) continue
            val s = Quellen.ohneKommentare(datei.readText())
            Regex("""RoundedCornerShape\(\d+\.dp\)""").findAll(s).forEach { m ->
                val zeile = s.substring(0, m.range.first).count { it == '\n' } + 1
                fehler += "${datei.name}:$zeile  ${m.value}"
            }
        }
        assert(fehler.isEmpty()) {
            "Feste Eckenradien ausserhalb von $themeOrdner/ (${fehler.size}):\n  " +
                fehler.joinToString("\n  ") +
                "\nDafür gibt es Formen.karte/chip/knopf/kachel/leiste/etikett/marke/fab/strich. " +
                "Passt keine, gehört eine NEUE dorthin — sonst ist die nächste " +
                "Designänderung wieder eine Suche über den ganzen Baum."
        }
    }

    @Test
    fun `keine festen Farben ausserhalb des Designs`() {
        val fehler = mutableListOf<String>()
        for (datei in Quellen.alle()) {
            if (datei.invariantSeparatorsPath.contains("/$themeOrdner/")) continue
            val s = Quellen.ohneKommentare(datei.readText())
            Regex("""Color\(0x[0-9A-Fa-f]{8}\)""").findAll(s).forEach { m ->
                val zeile = s.substring(0, m.range.first).count { it == '\n' } + 1
                fehler += "${datei.name}:$zeile  ${m.value}"
            }
        }
        assert(fehler.isEmpty()) {
            "Feste Farben ausserhalb von $themeOrdner/ (${fehler.size}):\n  " +
                fehler.joinToString("\n  ") +
                "\nFür Zustände gibt es LocalStatusFarben (erfolg/warnung/fehler), " +
                "für das Diagramm LocalChartColors. Eine Farbe, die im Bildschirm " +
                "steht, zieht beim Designwechsel nicht mit."
        }
    }

    @Test
    fun `keine festen Erhebungen ausserhalb des Designs`() {
        // Es gibt zwei: flach (Listen, Abschnitte) und hoch (Anmeldung,
        // Dialoge, Kennzahlen). Eine dritte Zahl im Bildschirm heisst, dass
        // jemand eine dritte Bedeutung erfunden hat, ohne sie zu benennen.
        val vorlage = Regex(
            """cardElevation\(defaultElevation = \d+\.dp\)"""
        )
        val fehler = Quellen.alle()
            .filter { !it.invariantSeparatorsPath.contains("/$themeOrdner/") }
            .filter { vorlage.containsMatchIn(Quellen.ohneKommentare(it.readText())) }
            .map { it.name }
        assert(fehler.isEmpty()) {
            "Diese Dateien setzen die Karten-Erhebung als Zahl: ${fehler.joinToString()}. " +
                "Dafür gibt es Formen.karteErhebung und Formen.karteErhebungHoch — " +
                "oder gleich AppKarte."
        }
    }

    @Test
    fun `beide Designs liefern Status- und Diagrammfarben`() {
        // Ein Design, das eine der beiden Gruppen nicht setzt, fällt auf die
        // Vorgabe des CompositionLocal zurück — und die ist die klassische.
        // Im Stein-Design stünde dann wieder ein Preussischblau neben
        // Salbeigrün, nur diesmal ohne dass es jemandem auffiele.
        val theme = Quellen.ohneKommentare(Quellen.lies("ui/theme/Theme.kt"))
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
}
