package ch.brickinventoryapp.app

import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

/**
 * In a keyed list EVERY item has a key.
 */
class LazyGridItemKeyTest {

    @Test
    fun `no keyless item in a keyed list`() {
        // Lower bound via Quellen.alle(): if the file walk found
        // nothing, the violation list would stay empty and the test green without having
        // checked anything.
        val ui = Quellen.unter("ui")
        assert(ui.size >= 20) { "Nur ${'$'}{ui.size} Dateien unter ui/ — Pfad veraltet?" }
        // The call can span several lines and contain nested brackets
        // (`span = { GridItemSpan(maxLineSpan) }`). A first version
        // without DOT_MATCHES_ALL stayed green in the counter-check — it did not find the
        // multi-line call at all.
        val entry = Regex(
            """(?<![\w.])item\s*\(((?:[^()]|\([^()]*\))*)\)\s*\{""",
            RegexOption.DOT_MATCHES_ALL)
        val fehler = mutableListOf<String>()

        for (f in ui) {
            val code = Quellen.strip(f.readText())
            // Only files that work with keys at all — otherwise there is
            // no fallback key that could change.
            if (!code.contains("key =")) continue
            for (m in entry.findAll(code)) {
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
