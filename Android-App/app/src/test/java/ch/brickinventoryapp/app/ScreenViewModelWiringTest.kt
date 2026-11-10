package ch.brickinventoryapp.app

import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Bildschirme sind zustandslos: Nur eine Route (Name endet auf `Route`) nimmt ein
 * ViewModel, sammelt seine Flüsse und reicht Zustand und Aktionen weiter. Was
 * darunter liegt, lässt sich so mit festem Zustand zeigen und prüfen, ohne Hilt.
 *
 * Gegenproben:
 *   screen-nimmt-viewmodel   PartsScreen nimmt wieder `vm: TeileViewModel`
 *                            → rot „kein Composable ausser einer Route nimmt ein ViewModel“
 *   karte-holt-viewmodel     PreisalarmeCard holt sich `hiltViewModel()` selbst
 *                            → rot „kein Bildschirm holt sich ein ViewModel selbst“
 */
class ScreenViewModelWiringTest {

    /** Ein @Composable mit Namen, Parameterliste und Rumpf, aus dem Quelltext geschnitten. */
    private data class Composable(val modul: String, val datei: String, val name: String, val parameter: String, val rumpf: String)

    /**
     * Das app-Modul ist die Wurzel der Oberfläche (Gerüst); dort und im Graphen eines
     * Bereichs (`*Graph.kt`) dürfen ViewModels geholt werden.
     */
    private val module = Quellen.module.filter { it.name == "app" || it.name.startsWith("core-") || it.name.startsWith("feature-") }

    private fun composables(): List<Composable> {
        val kopf = Regex("""@Composable\s*(?:\n\s*@[\w.]+(?:\([^)]*\))?\s*)*\n\s*(?:(?:internal|private|public)\s+)?fun\s+(?:<[^>]*>\s*)?(\w+)\s*\(""")
        val liste = mutableListOf<Composable>()
        for (modul in module) {
            val wurzel = File(modul, "src/main")
            wurzel.walkTopDown().filter { it.extension == "kt" }.forEach { datei ->
                val s = Quellen.ohneKommentare(datei.readText())
                for (m in kopf.findAll(s)) {
                    val parameterEnde = schliessend(s, m.range.last, '(', ')')
                    val rumpfAnfang = s.indexOf('{', parameterEnde)
                    val rumpfEnde = if (rumpfAnfang < 0) parameterEnde else schliessend(s, rumpfAnfang, '{', '}')
                    liste += Composable(modul.name, datei.name, m.groupValues[1],
                        s.substring(m.range.last + 1, parameterEnde), s.substring(maxOf(rumpfAnfang, parameterEnde), rumpfEnde))
                }
            }
        }
        return liste
    }

    /** Index der passenden schliessenden Klammer zur öffnenden bei [ab]. */
    private fun schliessend(s: String, ab: Int, auf: Char, zu: Char): Int {
        var tiefe = 0
        for (i in ab until s.length) {
            if (s[i] == auf) tiefe++
            else if (s[i] == zu && --tiefe == 0) return i
        }
        return s.length
    }

    @Test
    fun `die Pruefung findet die Bildschirme`() {
        val namen = composables().map { it.name }.toSet()
        // Leere Listen prüfen nichts: Ohne diese Namen wäre der Schnitt oben kaputt.
        for (n in listOf("PartsScreen", "PartsRoute", "GalleryScreen", "SettingsScreen", "MonitoringScreen", "MerklisteScreen")) {
            assert(n in namen) { "$n nicht gefunden — Muster veraltet?" }
        }
    }

    @Test
    fun `kein Composable ausser einer Route nimmt ein ViewModel`() {
        val fehler = composables()
            .filter { !it.name.endsWith("Route") }
            .filter { Regex(""":\s*[\w.]*ViewModel\b""").containsMatchIn(it.parameter) }
            .map { "${it.datei}: ${it.name}" }
        assert(fehler.isEmpty()) {
            "Diese Composables nehmen ein ViewModel; sie sollen Zustand und Aktionen bekommen:\n  " +
                fehler.joinToString("\n  ")
        }
    }

    @Test
    fun `kein Bildschirm holt sich ein ViewModel selbst`() {
        val fehler = composables()
            .filter { it.modul != "app" && !it.name.endsWith("Route") && !it.datei.endsWith("Graph.kt") }
            .filter { Regex("""\b(hiltViewModel|aktivitaetsViewModel)\s*[<(]""").containsMatchIn(it.rumpf) }
            .map { "${it.datei}: ${it.name}" }
        assert(fehler.isEmpty()) {
            "Diese Composables holen sich ein ViewModel; das gehört in die Route:\n  " + fehler.joinToString("\n  ")
        }
    }
}
