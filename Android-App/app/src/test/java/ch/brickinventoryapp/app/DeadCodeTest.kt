package ch.brickinventoryapp.app

import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * What is no longer used stands out.
 */
class DeadCodeTest {

    /**
     * Resources that deliberately stand in the source without a caller.
     * Keep short: every entry is an exception nobody checks any more.
     */
    private val allowedResources = setOf<String>(
        // (currently none)
    )

    /**
     * `<!-- … -->` out, also across several lines.
     *
     * Kotlin's line filter (Quellen.withoutComments) does not help in XML: there
     * the comment often stands in one line with content.
     */
    private fun withoutXmlComments(s: String) = s.replace(Regex("<!--[\\s\\S]*?-->"), "")

    @Test
    fun `every text resource is used`() {
        val en = File(Quellen.res, "values/strings.xml").readText()
        val schluessel = Regex("""<string name="([^"]+)"""").findAll(en)
            .map { it.groupValues[1] }.toSet()
        assert(schluessel.size > 300) { "Nur ${schluessel.size} Texte gefunden — Muster veraltet?" }

        // Searched is the Kotlin code AND the other XML files (themes,
        // menus, the manifest also include texts).
        //
        // WITHOUT COMMENTS. A key that only OCCURS in a
        // comment is not used — it is mentioned. The
        // difference is not theoretical: when switching the comparison
        // search field to `cd_search_clear`, `comparison_clear` became free, and
        // the comment that explains exactly THAT names the old name. The
        // check saw it and reported the text as still used.
        //
        // Thus every dead text keeps itself alive as soon as somewhere it says why
        // it is dead — and that is the kind of explanation one is most likely
        // to write down.
        val usage = buildString {
            Quellen.alle().forEach { append(Quellen.withoutComments(it.readText())).append('\n') }
            Quellen.res.walkTopDown()
                .filter { it.isFile && it.extension == "xml" && !it.name.startsWith("strings") }
                .forEach { append(withoutXmlComments(it.readText())).append('\n') }
            append(withoutXmlComments(Quellen.manifest.readText()))
        }
        assert(usage.length > 100_000) { "Zu wenig Quelltext gelesen — Pfad veraltet?" }

        val tot = schluessel.filter {
            it !in allowedResources && !Regex("""\b${Regex.escape(it)}\b""").containsMatchIn(usage)
        }.sorted()
        assert(tot.isEmpty()) {
            "Diese Texte werden nirgends benutzt (${tot.size}):\n  " + tot.joinToString("\n  ") +
                "\nEntweder ist die Anzeige dazu nie gebaut worden — dann fehlt eine " +
                "Funktion —, oder sie ist entfernt worden und der Text blieb liegen."
        }
    }

    @Test
    fun `every function has a caller`() {
        val dateien = Quellen.alle().associateWith { Quellen.withoutComments(it.readText()) }
        val alles = dateien.values.joinToString("\n")
        // The helpers from core-testing are there for tests; their callers stand there, not in the main tree.
        val fromTests = alles + "\n" + Quellen.tests.walkTopDown().filter { it.extension == "kt" }
            .joinToString("\n") { Quellen.withoutComments(it.readText()) }

        // Only own declarations: `override`, `operator` and constructors
        // stay out — the framework calls them, not this tree.
        val declaration = Regex("""^(?:internal |private |public |)fun (\w+)\s*[(<]""", RegexOption.MULTILINE)
        val orte = mutableMapOf<String, MutableList<String>>()
        dateien.forEach { (datei, s) ->
            declaration.findAll(s).forEach { orte.getOrPut(it.groupValues[1]) { mutableListOf() } += datei.invariantSeparatorsPath }
        }
        assert(orte.size > 80) { "Nur ${orte.size} Funktionen gefunden — Muster veraltet?" }

        // Entry points nobody calls from within this tree.
        val entries = setOf("main", "onCreate", "onStart", "onResume", "onPause", "onDestroy")

        val tot = orte.filter { (name, wo) ->
            if (name in entries) return@filter false
            val text = if (wo.all { "/testing/" in it }) fromTests else alles
            // A call is `name(`, a reference `::name`, a named
            // argument `name =`. Fewer hits than declarations means:
            // apart from the declaration nothing stands there.
            //
            // ── The fourth form: `name { … }` ────────────────
            //
            // Kotlin may pull the last parameter as a block BEHIND the brackets,
            // and then the bracket disappears completely:
            //
            //     CameraPermissionHint { cameraPermission.launchPermissionRequest() }
            //
            // That IS a call, only without `(`. This test did not
            // count it and reported the function as dead.
            //
            // The gap was there before and simply never struck:
            // MEASURED, exactly TWO own functions use this form,
            // `AppKarte` (3 places) and the new one here (2). `AppKarte` is
            // also called with brackets and therefore slipped through.
            val calls = Regex("""\b${Regex.escape(name)}\s*\(""").findAll(text).count()
            val asBlock = Regex("""\b${Regex.escape(name)}\s*\{""").findAll(text).count()
            val references = Regex("""::${Regex.escape(name)}\b""").findAll(text).count()
            val named = Regex("""\b${Regex.escape(name)}\s*=""").findAll(text).count()
            calls <= wo.size && asBlock == 0 && references == 0 && named == 0
        }.map { "${it.key} (${it.value.joinToString { p -> p.substringAfterLast('/') }})" }.sorted()

        assert(tot.isEmpty()) {
            "Diese Funktionen haben keinen Aufrufer (${tot.size}):\n  " + tot.joinToString("\n  ") +
                "\nEntfernen — oder es fehlt die Stelle, die sie benutzen sollte. " +
                "Genau das war bei saveUserDefaultCondition der Fall."
        }
    }
}
