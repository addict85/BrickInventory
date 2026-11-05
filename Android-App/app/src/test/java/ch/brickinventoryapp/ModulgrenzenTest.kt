package ch.brickinventoryapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Die Modulgrenzen, gelesen aus settings.gradle.kts und den build.gradle.kts:
 * app → feature-* → core-*, kein Bereich kennt einen anderen, die Kernmodule
 * liegen in fester Schichtung, core-model bleibt reines Kotlin ohne Android.
 * Gradle bricht bei einem Zyklus ab, aber nicht bei einer Kante, die nur in
 * die falsche Richtung zeigt — die fängt dieser Test.
 *
 * Gegenproben:
 *   A  feature-sammlung: `implementation(project(":feature-teile"))` → rot
 *      „feature-sammlung hängt an feature-teile“
 *   B  core-model: jvm.library durch android.library ersetzt → rot „core-model
 *      ist kein reines Kotlin-Modul“
 *   C  core-data: `implementation(project(":core-ui"))` → rot „Schichtung
 *      der Kernmodule: core-data hängt an [core-ui]“
 *   D  include(":feature-verwaltung") aus settings.gradle.kts gestrichen → rot
 *      „jeder Modulordner ist eingebunden“
 *   E  in dependencyResolutionManagement wieder `google()` → rot
 *      „google() liefert nur Googles Gruppen“ (Ohne Inhaltsfilter)
 *   F  gegenproben/konvention-mit-modulkante.patch: die Bereichs-Konvention
 *      trägt core-ui ein → rot „Konventionen tragen keine Modulkanten ein“
 *   G  in build-logic/settings.gradle.kts `google()` ohne Filter →
 *      rot „Ohne Inhaltsfilter in build-logic/settings.gradle.kts“
 */
class ModulgrenzenTest {

    private data class Abhaengigkeit(val konfiguration: String, val ziel: String)

    private val projekt = Quellen.projekt

    private fun module(): Map<String, String> =
        Quellen.module.filter { it.name != "buildSrc" }.associate { it.name to File(it, "build.gradle.kts").readText() }

    private fun abhaengigkeiten(bau: String): List<Abhaengigkeit> =
        Regex("""^\s*(\w+)\(project\(":([\w-]+)"\)\)""", RegexOption.MULTILINE).findAll(bau)
            .map { Abhaengigkeit(it.groupValues[1], it.groupValues[2]) }.toList()

    /** Was im ausgelieferten Code gilt; Testkonfigurationen zählen nicht. */
    private fun hauptAbhaengigkeiten(bau: String): Set<String> =
        abhaengigkeiten(bau).filter { !it.konfiguration.startsWith("test") }.map { it.ziel }.toSet()

    @Test
    fun `jeder Modulordner ist eingebunden und jedes eingebundene Modul gibt es`() {
        val eingebunden = Regex("""include\("(:[\w-]+)"\)""")
            .findAll(File(projekt, "settings.gradle.kts").readText()).map { it.groupValues[1].removePrefix(":") }.toSet()
        val ordner = module().keys
        assertTrue("Nur ${ordner.size} Module gefunden — Suche veraltet?", ordner.size >= 12)
        assertEquals("jeder Modulordner ist eingebunden", ordner, eingebunden)
    }

    @Test
    fun `kein Bereich hängt an einem anderen Bereich oder an der App`() {
        val bereiche = module().filterKeys { it.startsWith("feature-") }
        assertTrue("Nur ${bereiche.size} Bereichsmodule", bereiche.size >= 5)
        for ((name, bau) in bereiche) {
            val falsch = hauptAbhaengigkeiten(bau).filter { it.startsWith("feature-") || it == "app" }
            assertTrue("$name hängt an ${falsch.joinToString()}", falsch.isEmpty())
            assertTrue("$name kennt keine Kernmodule — Muster veraltet?", hauptAbhaengigkeiten(bau).any { it.startsWith("core-") })
        }
    }

    @Test
    fun `Schichtung der Kernmodule`() {
        val erlaubt = mapOf(
            "core-model" to emptySet(),
            "core-ressourcen" to emptySet(),
            "core-data" to setOf("core-model", "core-ressourcen"),
            "core-ui" to setOf("core-model", "core-ressourcen"),
            "core-zustand" to setOf("core-model", "core-ressourcen", "core-data", "core-ui"),
            "core-testing" to setOf("core-zustand", "core-data", "core-ui"),
        )
        val kerne = module().filterKeys { it.startsWith("core-") }
        assertEquals("jedes Kernmodul hat eine Regel", erlaubt.keys, kerne.keys)
        for ((name, bau) in kerne) {
            val zuviel = hauptAbhaengigkeiten(bau) - erlaubt.getValue(name)
            assertTrue("Schichtung der Kernmodule: $name hängt an $zuviel", zuviel.isEmpty())
        }
        // Die Testhilfen nur für Tests: Im ausgelieferten Code hätten sie nichts verloren.
        for ((name, bau) in module()) {
            val haupt = hauptAbhaengigkeiten(bau)
            if (name != "core-testing") assertTrue("$name bindet core-testing nicht nur für Tests ein", "core-testing" !in haupt)
        }
    }

    @Test
    fun `core-model bleibt ohne Android`() {
        val bau = module().getValue("core-model")
        val plugins = Regex("""alias\(libs\.plugins\.([\w.]+)\)""").findAll(bau).map { it.groupValues[1] }.toSet()
        assertTrue("core-model ist kein reines Kotlin-Modul: $plugins", "brickinventory.jvm.library" in plugins)
        // Die JVM-Konvention selbst wendet kotlin.jvm an und kein Android-Plugin.
        val konvention = File(projekt, "build-logic/convention/src/main/kotlin/ch/brickinventoryapp/buildlogic/Konventionen.kt")
            .readText().substringAfter("class JvmLibraryKonvention").substringBefore("\n}\n")
        assertTrue("die JVM-Konvention wendet kotlin.jvm an", "pluginAusKatalog(\"kotlin.jvm\")" in konvention)
        assertTrue("die JVM-Konvention bleibt ohne Android", "android" !in konvention.lowercase())
        val android = plugins.filter { it in setOf("android.application", "android.library", "kotlin.compose", "hilt", "ksp") }
        assertTrue("core-model bleibt ohne Android: $android", android.isEmpty())
        val bibliotheken = Regex("""\(libs\.([\w.]+)\)""").findAll(bau).map { it.groupValues[1] }.toList()
        assertTrue("core-model bleibt ohne Android: $bibliotheken",
            bibliotheken.none { it.startsWith("androidx") || it.startsWith("hilt") || it.startsWith("robolectric") })
        assertTrue("core-model hängt an anderen Modulen: ${hauptAbhaengigkeiten(bau)}", hauptAbhaengigkeiten(bau).isEmpty())
    }

    @Test
    fun `die App bindet jeden Bereich ein`() {
        val app = hauptAbhaengigkeiten(module().getValue("app"))
        val bereiche = module().keys.filter { it.startsWith("feature-") }.toSet()
        assertEquals("ein Bereich ohne die App wäre toter Code", bereiche, app.filter { it.startsWith("feature-") }.toSet())
    }

    /** Plugins wie Abhängigkeiten: google() nur für Googles Gruppen, sonst mavenCentral. */
    @Test
    fun `google() liefert nur Googles Gruppen`() {
        // build-logic löst AGP und Kotlin für die Konventionen selbst auf.
        for (datei in listOf("settings.gradle.kts", "build-logic/settings.gradle.kts")) {
            val settings = File(projekt, datei).readText().lines()
                .filterNot { it.trim().startsWith("//") }.joinToString("\n")
            val google = Regex("""\bgoogle\b[^\n]*""").findAll(settings).map { it.value }.toList()
            assertEquals("$datei, pluginManagement und dependencyResolutionManagement: $google", 2, google.size)
            for (z in google) assertTrue("Ohne Inhaltsfilter in $datei: $z", z.startsWith("google { content {") &&
                listOf("com\\\\.android.*", "com\\\\.google.*", "androidx.*").all { z.contains("includeGroupByRegex(\"$it\")") })
        }
    }

    /**
     * Die Kanten liest dieser Test aus den Modulskripten. Trüge eine Konvention
     * selbst eine ein, gälte sie für jedes Modul mit diesem Plugin und stünde
     * hier nirgends.
     */
    @Test
    fun `Konventionen tragen keine Modulkanten ein`() {
        val quellen = File(projekt, "build-logic").walkTopDown()
            .filter { it.isFile && (it.extension == "kt" || it.name.endsWith(".gradle.kts")) }.toList()
        assertTrue("Nur ${quellen.size} Dateien unter build-logic — Suche veraltet?", quellen.size >= 4)
        val kante = Regex("""\bproject\s*\(""")
        val mitKante = quellen.filter { kante.containsMatchIn(Quellen.ohneKommentare(it.readText())) }.map { it.name }
        assertTrue("Konventionen tragen keine Modulkanten ein: $mitKante", mitKante.isEmpty())
    }
}
