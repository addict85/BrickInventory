package ch.brickinventoryapp.app

import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

/**
 * In einer verschlüsselten Liste hat JEDER Eintrag einen Schlüssel.
 */
class LazyGridItemKeyTest {

    @Test
    fun `kein schluessselloser Eintrag in einer verschluesselten Liste`() {
        // Untergrenze über Quellen.alle(): Fände der Dateilauf
        // nichts, bliebe die Verstossliste leer und der Test grün, ohne etwas
        // geprüft zu haben.
        val ui = Quellen.unter("ui")
        assert(ui.size >= 20) { "Nur ${'$'}{ui.size} Dateien unter ui/ — Pfad veraltet?" }
        // Der Aufruf kann über mehrere Zeilen gehen und geschachtelte Klammern
        // enthalten (`span = { GridItemSpan(maxLineSpan) }`). Eine erste Fassung
        // ohne DOT_MATCHES_ALL blieb bei der Gegenprobe grün — sie fand den
        // mehrzeiligen Aufruf gar nicht.
        val eintrag = Regex(
            """(?<![\w.])item\s*\(((?:[^()]|\([^()]*\))*)\)\s*\{""",
            RegexOption.DOT_MATCHES_ALL)
        val fehler = mutableListOf<String>()

        for (f in ui) {
            val code = Quellen.entkleide(f.readText())
            // Nur Dateien, die überhaupt mit Schlüsseln arbeiten — sonst gibt es
            // keinen Ersatzschlüssel, der wechseln könnte.
            if (!code.contains("key =")) continue
            for (m in eintrag.findAll(code)) {
                val args = m.groupValues[1]
                if (args.contains("key") || args.isBlank()) continue
                val zeile = code.substring(0, m.range.first).count { it == '\n' } + 1
                fehler += "${f.name}:$zeile — item(${args.take(40)}…) ohne key"
            }
        }
        assert(fehler.isEmpty()) {
            "Eintrag ohne Schlüssel in einer verschlüsselten Liste:\n  " +
                fehler.joinToString("\n  ") +
                "\nSein Ersatzschlüssel kommt aus dem Index und wechselt, sobald die " +
                "Liste wächst — das Raster behandelt ihn dann als anderen Eintrag."
        }
    }
}
