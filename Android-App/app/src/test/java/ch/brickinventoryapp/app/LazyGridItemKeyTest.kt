package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test

/**
 * In a keyed list EVERY item has a key.
 */
class LazyGridItemKeyTest {

    @Test
    fun `no keyless item in a keyed list`() {
        // Lower bound via Quellen.all(): if the file walk found
        // nothing, the violation list would stay empty and the test green without having
        // checked anything.
        val ui = Sources.below("ui")
        assert(ui.size >= 20) { "Only ${'$'}{ui.size} files under ui/ — path outdated?" }
        // The call can span several lines and contain nested brackets
        // (`span = { GridItemSpan(maxLineSpan) }`). A first version
        // without DOT_MATCHES_ALL stayed green in the counter-check — it did not find the
        // multi-line call at all.
        val entry = Regex(
            """(?<![\w.])item\s*\(((?:[^()]|\([^()]*\))*)\)\s*\{""",
            RegexOption.DOT_MATCHES_ALL)
        val error = mutableListOf<String>()

        for (f in ui) {
            val code = Sources.strip(f.readText())
            // Only files that work with keys at all — otherwise there is
            // no fallback key that could change.
            if (!code.contains("key =")) continue
            for (m in entry.findAll(code)) {
                val args = m.groupValues[1]
                if (args.contains("key") || args.isBlank()) continue
                val row = code.substring(0, m.range.first).count { it == '\n' } + 1
                error += "${f.name}:$row — item(${args.take(40)}…) ohne key"
            }
        }
        assert(error.isEmpty()) {
            "Entry without a key in an encrypted list:\n  " +
                error.joinToString("\n  ") +
                "\nIts fallback key comes from the index and changes as soon as the " +
                "list grows — the grid then treats it as a different entry."
        }
    }
}
