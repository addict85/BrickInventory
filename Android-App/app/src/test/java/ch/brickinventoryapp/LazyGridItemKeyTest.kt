package ch.brickinventoryapp

import org.junit.Test

/**
 * In einer verschlüsselten Liste hat JEDER Eintrag einen Schlüssel.
 *
 * ── Marcos Befund (Nachtrag 108) ────────────────────────────────────────────
 * „Sobald neue Tiles geladen werden, springt die Galerie auf ca. die 6. Zeile —
 * unabhängig davon, ob ich schnell oder langsam scrolle."
 *
 * Das „unabhängig" schliesst das Wettrennen aus Nachtrag 106 als alleinige
 * Ursache aus. Gefunden wurde stattdessen: Die Kacheln der Galerie sind
 * verschlüsselt (`key = { it.setNumber }`), der Lade-Eintrag darunter war es
 * NICHT.
 *
 * Ein Eintrag ohne Schlüssel bekommt in einer solchen Liste einen Ersatz, der
 * aus seinem INDEX gebildet wird. Wächst die Liste von 100 auf 200, wechselt
 * dieser Ersatzschlüssel — für das Raster verschwindet damit ein Eintrag und
 * ein anderer erscheint, statt dass derselbe stehen bleibt.
 *
 * Dass Teile- und Minifiguren-Raster ihren Kopfzeilen längst Schlüssel geben
 * (`key = "manual-header"`, `key = "sets-header"`), war der Hinweis: Die
 * Galerie war die Ausnahme, nicht die Regel.
 *
 * EHRLICH DAZU: Ob dies Marcos Sprung erklärt, ist damit nicht bewiesen — es
 * ist ein belegter Mangel an derselben Stelle. Deshalb liegt in
 * ScrollMemory.kt zusätzlich eine Log-Zeile, die im nächsten Lauf entscheidet,
 * ob die Wiederherstellung feuert oder das Raster von sich aus springt.
 */
class LazyGridItemKeyTest {

    private fun entkleide(src: String): String {
        val out = StringBuilder()
        var i = 0
        while (i < src.length) {
            when {
                src.startsWith("//", i) -> {
                    val j = src.indexOf('\n', i).let { if (it < 0) src.length else it }
                    repeat(j - i) { out.append(' ') }; i = j
                }
                src.startsWith("/*", i) -> {
                    val j = src.indexOf("*/", i + 2).let { if (it < 0) src.length else it + 2 }
                    for (c in src.substring(i, j)) out.append(if (c == '\n') '\n' else ' '); i = j
                }
                src[i] == '"' -> {
                    var j = i + 1
                    while (j < src.length && src[j] != '"') j += if (src[j] == '\\') 2 else 1
                    j++
                    for (c in src.substring(i, minOf(j, src.length))) out.append(if (c == '\n') '\n' else ' ')
                    i = j
                }
                else -> { out.append(src[i]); i++ }
            }
        }
        return out.toString()
    }

    @Test
    fun `kein schluessselloser Eintrag in einer verschluesselten Liste`() {
        // Untergrenze über Quellen.alle() (Nachtrag 118): Fände der Dateilauf
        // nichts, bliebe die Verstossliste leer und der Test grün, ohne etwas
        // geprüft zu haben.
        val ui = Quellen.unter("ui")
        assert(ui.size >= 20) { "Nur ${'$'}{ui.size} Dateien unter ui/ — Pfad veraltet?" }
        val wurzel = java.io.File("src/main/java/ch/brickinventoryapp/ui")
        // Der Aufruf kann über mehrere Zeilen gehen und geschachtelte Klammern
        // enthalten (`span = { GridItemSpan(maxLineSpan) }`). Eine erste Fassung
        // ohne DOT_MATCHES_ALL blieb bei der Gegenprobe grün — sie fand den
        // mehrzeiligen Aufruf gar nicht.
        val eintrag = Regex(
            """(?<![\w.])item\s*\(((?:[^()]|\([^()]*\))*)\)\s*\{""",
            RegexOption.DOT_MATCHES_ALL)
        val fehler = mutableListOf<String>()

        for (f in wurzel.walkTopDown().filter { it.extension == "kt" }) {
            val code = entkleide(f.readText())
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
