package ch.brickinventoryapp.app

import org.junit.Test
import ch.brickinventoryapp.testing.Sources

/**
 * Messages appear in the APP's language, not in the system's.
 *
 * ── The error this rule prevents ─────────────────────────────────────────────
 * `AppCompatDelegate.setApplicationLocales()` only localizes
 * AppCompat ACTIVITIES. Below Android 13 the application context keeps
 * the SYSTEM language — minSdk is 30, so affected are
 * Android 11 and 12. That has long been in LanguageManager.localizedContext()
 *
 * The ViewModels were the gap: thirty-two direct
 * `ctx.getString(...)` on the application context stood there. Whoever had their phone set to
 * German and the app to English thus got EVERY
 * snackbar and EVERY error message in German anyway — of all things via
 * `message()`, the function that only exists so that error messages do not come out in
 * a language the user did not choose.
 *
 * This can hardly stand out here: the app is developed in German, the
 * test device is set to German, and then the wrong language looks like the
 * right one. Exactly that is why the rule stands as a test and not as a maxim.
 *
 * ── What is checked ──────────────────────────────────────────────────────────
 * In the ViewModels, the feature files and the services `getString(`
 * may only stand on a receiver that comes from
 * `LanguageManager.localizedContext(...)` in the SAME file. The receiver's name
 * does not matter — its origin is checked.
 *
 * NOT checked are the screens under `ui/screens/` and `shared/ui/`: there `ctx`
 * is `LocalContext.current`, i.e. the activity context — and that one is localized
 * by AppCompatDelegate. Subjecting them to the same rule would mean forcing a
 * cumbersomeness that repairs nothing.
 *
 * Counter-checks (performed, via the stand-in script in the tools folder):
 *   a) in MainViewModel.text() `localizedContext(ctx)` replaced by `ctx`
 *      → sub-step 1 red (receiver no longer comes from localizedContext).
 *   b) in GalleryFeature a message set back to `ctx.getString(...)`
 *      → sub-step 1 red.
 *   c) in CsvImportService `loc` replaced by `this` → sub-step 1 red.
 *      The services were already right; the probe shows that they must
 *      stay so.
 *   d) in the helper `if (args.isEmpty())` removed → sub-step 3 red.
 *
 * While writing the stand-in script it also stood out that the first version
 * of the rule reported the two services as a violation: they bind their context
 * as `private val loc: Context by lazy { … }` across two lines, and the pattern
 * required a single-line assignment. Had that stayed, the rule would have
 * blackened exactly the files that do it right — and one would
 * probably have defused it instead of correcting it.
 */
class LanguageTheMessagesTest {

    /** Files in which the context does NOT come from an activity. */
    private fun affectedFiles(): List<Pair<String, String>> =
        Sources.all()
            .filter { f ->
                val p = f.absolutePath.replace('\\', '/')
                ("/ui/" in p || "/service/" in p) && "/ui/screens/" !in p && "/gemeinsam/ui/" !in p
            }
            .map { it.name to Sources.withoutComments(it.readText()) }

    @Test
    fun `resource texts come from the localized context`() {
        val files = affectedFiles()
        assert(files.size >= 15) {
            "Nur ${files.size} Dateien gefunden — der Pfadfilter stimmt nicht mehr, " +
                "und die Pruefung waere still gruen."
        }

        val error = mutableListOf<String>()
        var checked = 0
        for ((name, s) in files) {
            // Receivers that come from localizedContext(...) in this file.
            // Both spellings, and across the line: the services
            // bind it as `private val loc: Context by lazy { … }`, the
            // ViewModels as `val c = …` in the body of text().
            val localized = Regex(
                """val\s+(\w+)[^\n]*?(?:=|by\s+lazy\s*\{)\s*(?:\n\s*)?[\w.]*localizedContext\(""")
                .findAll(s).map { it.groupValues[1] }.toSet()
            // The expression can also be called directly:
            //   localizedContext(ctx).getString(...)
            val direct = Regex("""localizedContext\([^)]*\)\s*\.getString\(""")

            for (m in Regex("""(\w+)\s*\.getString\(""").findAll(s)) {
                checked++
                val recipient = m.groupValues[1]
                if (recipient in localized) continue
                // Line with a direct call?
                val row = s.substring(s.lastIndexOf('\n', m.range.first) + 1,
                                        (s.indexOf('\n', m.range.first).takeIf { it >= 0 } ?: s.length))
                if (direct.containsMatchIn(row)) continue
                error += "$name: $recipient.getString(...)"
            }
        }
        assert(checked > 0) { "Kein einziger getString-Aufruf gefunden — Muster veraltet?" }
        assert(error.isEmpty()) {
            "Diese Stellen holen Texte ueber einen Context, der unterhalb von " +
                "Android 13 die SYSTEM-Sprache traegt statt der eingestellten App-Sprache:\n  " +
                error.distinct().joinToString("\n  ") +
                "\nRichtig ist LanguageManager.localizedContext(...) — siehe TextSource.text()."
        }
    }

    @Test
    fun `the text source has the helper and uses it`() {
        // Without the helper the next caller writes ctx.getString() again.
        for (file in listOf("data/util/TextSource.kt")) {
            val s = Sources.withoutComments(Sources.read(file))
            assert(Regex("""fun text\(id: Int, vararg args: Any\?\)""").containsMatchIn(s)) {
                "$file hat keinen text()-Helfer mehr"
            }
            assert(s.contains("localizedContext")) {
                "$file holt den lokalisierten Context nicht mehr"
            }
        }
    }

    @Test
    fun `a text without arguments does not run through String-format`() {
        // getString(id, *empty) formats anyway. A text with a
        // single percent sign — say a percentage — would throw an
        // exception there instead of being shown, and only at runtime
        // and only for exactly this text.
        for (file in listOf("data/util/TextSource.kt")) {
            val s = Sources.withoutComments(Sources.read(file))
            assert(s.contains("if (args.isEmpty()) c.getString(id) else c.getString(id, *args)")) {
                "$file formatiert auch ohne Argumente — siehe TextSource.text()"
            }
        }
    }
}
