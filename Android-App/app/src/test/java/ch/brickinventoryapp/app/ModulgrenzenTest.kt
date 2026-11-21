package ch.brickinventoryapp.app

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.buildlogic.kanten.Modulkante
import ch.brickinventoryapp.buildlogic.kanten.Modulkanten
import ch.brickinventoryapp.testing.Quellen

/**
 * The module boundaries, read from settings.gradle.kts and the build.gradle.kts:
 * app → feature-* → core-*, no area knows another (without exception),
 * fixed layering of the core modules, core-model without Android, core-ui without domain knowledge.
 * The edge rule is build-logic/…/kanten/Modulkanten.kt; the task
 * modulkantenPruefen runs the same in Gradle, here it runs against the module scripts.
 *
 * Counter-checks:
 *   A  feature-collection: `implementation(project(":feature-parts"))` → red
 *      „feature-collection hängt an feature-parts“
 *   B  core-model: jvm.library replaced by android.library → red „core-model
 *      ist kein reines Kotlin-Modul“
 *   C  core-data: `implementation(project(":core-ui"))` → red „Schichtung
 *      der Kernmodule: core-data hängt an [core-ui]“
 *   D  include(":feature-management") deleted from settings.gradle.kts → red
 *      “every module folder is included”
 *   E  in dependencyResolutionManagement again `google()` → red
 *      “google() only supplies Google's groups“ (Ohne Inhaltsfilter)
 *   F  gegenproben/konvention-mit-modulkante.patch: the area convention
 *      adds core-ui → red “conventions add no module edges“
 *   G  in build-logic/settings.gradle.kts `google()` without filter →
 *      red „Ohne Inhaltsfilter in build-logic/settings.gradle.kts“
 *   I in settings.gradle.kts an exclusiveContent
 *      deleted → red „exclusiveContent je Block in settings.gradle.kts“
 *   J a `regex="true"` back in
 *      verification-metadata.xml → red “no key applies to a whole group …”
 *   K in build-tool-vulnerabilities.txt the version set to 3.15.0
 *      → red “every vulnerability in the build tooling …” (not in verification-metadata.xml)
 *   H a `PdfRenderer(` in PdfSeite.kt →
 *      red “PdfRenderer lives only in the isolated render service“; likewise
 *      gegenproben/pdf-bitmap-aus-dem-renderer.patch (again `Bitmap.CREATOR.createFromParcel`)
 *   L  gegenproben/netz-haengt-an-ablage.patch: core-network includes Room →
 *      red „core-network hängt an Ablage oder DI“ (layering of the core modules);
 *      only CI measures it, locally there is no Gradle
 *   M  gegenproben/merge-rest-im-baum.patch: a file `Rest.kt.orig` in the tree →
 *      red “no merge remnant lies in the tree” (every module folder is included …)
 *   N  gegenproben/dienste-haengt-an-update.patch: core-services includes core-update →
 *      red „layering of the core modules: core-services hängt an [core-update]“ (core-data →
 *      core-update is already caught by Gradle as a cycle)
 *   P  gegenproben/zustand-haengt-an-ui.patch: core-state includes core-ui →
 *      red „layering of the core modules: core-state hängt an [core-ui]“
 *   Q  gegenproben/gemeinsam-haengt-an-daten.patch: core-ui-inventory includes core-data →
 *      red „layering of the core modules: core-ui-inventory hängt an [core-data]“
 *   U  gegenproben/offline-haengt-an-daten.patch: core-offline includes core-ui →
 *      red „layering of the core modules: core-offline hängt an [core-ui]“ (core-data
 *      would not work: Gradle already aborts the cycle, without a test report)
 *   W  gegenproben/ablage-kennt-wireformat.patch: core-offline includes core-contract again →
 *      red „core-offline kennt das Wire-Format“ (layering of the core modules)
 *   T  gegenproben/bereich-kennt-bereich.patch: feature-parts includes feature-catalog →
 *      red „feature-parts hängt an feature-catalog“
 *   R  gegenproben/ui-kennt-ansicht.patch: a core-ui file imports a view from
 *      model.fach → red „core-ui kennt Fachmodelle“ (layering of the core modules)
 *   S  gegenproben/ui-neuer-bildschirm.patch: a new file in core-ui/ui/screens →
 *      red „core-ui/ui/screens enthält nur die Kamera-Bausteine“ (layering …)
 *   O  gegenproben/fremder-paketstamm.patch: feature-parts gets a file in the package
 *      ch.brickinventoryapp.collection → red „außerhalb des Paketstamms ihres Moduls“
 *   V  gegenproben/daten-reicht-netz-weiter.patch: core-data includes core-network via api →
 *      red „Modulkanten per api nur zu core-model: [core-data → core-network]“ (layering …)
 *   X  gegenproben/netz-oeffnet-intent.patch: ExterneAdresse.kt imports android.content.Intent →
 *      red „core-network importiert Ablage, Repositories, DI oder Android-Oberfläche“ (layering …)
 *   Y  gegenproben/sitzung-haengt-an-ui.patch: core-session includes core-ui →
 *      red „layering of the core modules: core-session hängt an core-ui“
 *   Z  gegenproben/konto-haengt-an-tresor.patch: feature-account includes core-security again →
 *      red „feature-account hängt an core-security, das unter dem Zustand liegt“ (no area depends …)
 *   AA core-state switches on brickinventory.android.compose again → red „core-state liegt unter
 *      der Oberfläche und schaltet Compose ein“ (layering …; measured with kotlinc, in Gradle
 *      AndroidComposeKonvention already aborts); gegenproben/zustand-darf-oberflaeche.patch → red “the edge rule …”
 *   AB gegenproben/bereichs-viewmodel-im-zustand.patch: a ViewModel of only one area in core-state
 *      → red „… liegt in core-state ohne Grund in Modulkanten.zustandsViewModels“ (layering …)
 *   W  gegenproben/route-im-kern.patch: a route in core-model, the management opens it →
 *      red „feature-management nennt fremde Routentypen: [Zentralziel]“ (no area depends …);
 *      measured locally with kotlinc against the tree, in CI via Gradle
 */
class ModulgrenzenTest {

    private data class Dependency(val configuration: String, val ziel: String)

    private val project = Quellen.project

    private fun module(): Map<String, String> =
        Quellen.module.filter { it.name != "buildSrc" }.associate { it.name to File(it, "build.gradle.kts").readText() }

    private fun kanten(name: String, bau: String): List<Modulkante> =
        dependencies(bau).map { Modulkante(name, it.configuration, it.ziel) }

    private fun dependencies(bau: String): List<Dependency> =
        Regex("""^\s*(\w+)\(project\(":([\w-]+)"\)\)""", RegexOption.MULTILINE).findAll(bau)
            .map { Dependency(it.groupValues[1], it.groupValues[2]) }.toList()

    /** What applies in the shipped code; test configurations do not count. */
    private fun mainDependencies(bau: String): Set<String> =
        dependencies(bau).filter { !it.configuration.startsWith("test") }.map { it.ziel }.toSet()

    @Test
    fun `every module folder is included, every included module exists, no merge remnant lies in the tree, and every Kotlin file lies in its module's package root`() {
        // A .orig/.rej is never compiled, but counts for every search across the tree.
        val root: File = checkNotNull(project.parentFile)
        val remainder = root.walkTopDown()
            .onEnter { it.name !in setOf(".git", ".claude", ".gradle", "build", "node_modules") }
            .filter { it.isFile && it.extension in setOf("orig", "rej") }.map { it.relativeTo(root).path }.toList()
        assertTrue("Merge-Reste im Baum, löschen: $remainder", remainder.isEmpty())
        val eingebunden = Regex("""include\("(:[\w-]+)"\)""")
            .findAll(File(project, "settings.gradle.kts").readText()).map { it.groupValues[1].removePrefix(":") }.toSet()
        val folder = module().keys
        assertTrue("Nur ${folder.size} Module gefunden — Suche veraltet?", folder.size >= 12)
        assertEquals("jeder Modulordner ist eingebunden", folder, eingebunden)
        // Every module has its own package root (table in README.md): an import
        // thus reveals the module, and no package spreads across two modules.
        val master = mapOf(
            "app" to "app", "core-model" to "model", "core-contract" to "contract", "core-network" to "network", "core-data" to "data",
            "core-security" to "security", "core-offline" to "offline",
            "core-update" to "update", "core-services" to "services", "core-ui" to "ui", "core-state" to "state",
            "core-navigation" to "navigation",
            "core-session" to "session",
            "core-testing" to "testing", "feature-login" to "login", "feature-catalog" to "catalog",
            "feature-collection" to "collection", "feature-parts" to "parts", "feature-finances" to "finances",
            "feature-account" to "account", "feature-management" to "management", "core-ui-inventory" to "shared",
        )
        assertEquals("kein Stamm ist doppelt vergeben", master.size, master.values.toSet().size)
        val packageRow = Regex("""^package\s+([\w.]+)""", RegexOption.MULTILINE)
        val falsch = mutableListOf<String>()
        var n = 0
        for (m in Quellen.module) for (satz in listOf("main", "test")) {
            val basis = File(m, "src/$satz/java")
            if (!basis.isDirectory) continue
            for (f in basis.walkTopDown().filter { it.isFile && it.extension == "kt" }) {
                n++
                val rel = f.relativeTo(basis).invariantSeparatorsPath
                val paket = packageRow.find(f.readText())?.groupValues?.get(1)
                val soll = master[m.name]?.let { "ch.brickinventoryapp.$it" }
                val folderPackage = rel.substringBeforeLast('/').replace('/', '.')
                if (soll == null || paket != folderPackage || !(paket == soll || paket.startsWith("$soll."))) {
                    falsch += "${m.name}/src/$satz: $rel (package $paket, Stamm ${soll ?: "fehlt"})"
                }
            }
        }
        assertTrue("Nur $n Kotlin-Dateien gefunden — Suche veraltet?", n >= 500)
        assertTrue("Dateien außerhalb des Paketstamms ihres Moduls:\n  " + falsch.joinToString("\n  "), falsch.isEmpty())
    }

    @Test
    fun `no area depends on another area or on the app, none names foreign route types`() {
        val areas = module().filterKeys { it.startsWith("feature-") }
        assertTrue("Nur ${areas.size} Bereichsmodule", areas.size >= 5)
        for ((name, bau) in areas) {
            // Ohne Ausnahme: Was mehrere Bereiche zeigen, liegt in core-ui-inventory.
            val falsch = Modulkanten.violations(kanten(name, bau))
            assertTrue(falsch.joinToString("\n"), falsch.isEmpty())
            assertTrue("$name kennt keine Kernmodule — Muster veraltet?", mainDependencies(bau).any { it.startsWith("core-") })
        }
        // Routes: an area registers and opens only its own destinations, foreign ones via the callbacks
        // of its navigation interface. A route in a core module would be the central list again.
        val routesCall = Regex("""\b(?:composable|navigation|popUpTo|getBackStackEntry|toRoute|hasRoute)<([A-Z]\w*)|\bnavigate\(\s*([A-Z]\w*)""")
        val declaration = Regex("""\b(?:class|interface|object)\s+(\w+)""")
        for (name in areas.keys) {
            val quellen = File(project, "$name/src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }
                .map { Quellen.withoutComments(it.readText()) }.toList()
            val eigene = quellen.flatMap { q -> declaration.findAll(q).map { it.groupValues[1] } }.toSet()
            val genannt = quellen.flatMap { q -> routesCall.findAll(q).map { it.groupValues[1].ifEmpty { it.groupValues[2] } } }.toSet()
            assertTrue("$name nennt keine Route — Muster veraltet?", genannt.isNotEmpty())
            assertTrue("$name nennt fremde Routentypen: ${genannt - eigene}", (genannt - eigene).isEmpty())
        }
    }

    @Test
    fun `layering of the core modules`() {
        val kerne = module().filterKeys { it.startsWith("core-") }
        assertEquals("jedes Kernmodul hat eine Regel", Modulkanten.kerne.keys, kerne.keys)
        val alle = module().flatMap { (name, bau) -> kanten(name, bau) }
        assertTrue("Nur ${alle.size} Modulkanten — Muster veraltet?", alle.size >= 60)
        val violations = Modulkanten.violations(alle)
        assertTrue(violations.joinToString("\n"), violations.isEmpty())
        val plugin = Regex("""alias\(libs\.plugins\.([\w.]+)\)""")
        val ui = module().mapNotNull { (name, bau) -> Modulkanten.uiViolation(name, plugin.findAll(bau).map { it.groupValues[1] }.toList()) }
        assertTrue(ui.joinToString("\n"), ui.isEmpty())
        val viewModel = Regex("""\bclass\s+(\w+)[^{]*?:\s*ViewModel\(\)""")
        val stateVms = File(project, "core-state/src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }
            .flatMap { f -> viewModel.findAll(Quellen.withoutComments(f.readText())).map { it.groupValues[1] } }.toList()
        assertTrue("Keine ViewModels in core-state gefunden — Muster veraltet?", stateVms.size >= 3)
        val vmWrong = Modulkanten.stateViewModelViolations(stateVms)
        assertTrue(vmWrong.joinToString("\n"), vmWrong.isEmpty())
        // core-network is the lower network layer: store, repositories and Hilt stay in core-data.
        val netz = kerne.getValue("core-network")
        val libraries = Regex("""\(libs\.([\w.]+)\)""").findAll(netz).map { it.groupValues[1] }.toList()
        val ablage = listOf("androidx.room", "sqlcipher", "hilt", "androidx.hilt", "androidx.datastore", "androidx.work", "retrofit")
        assertTrue("core-network hängt an Ablage oder DI: $libraries", libraries.none { b -> ablage.any { b.startsWith(it) } })
        val importe = File(project, "core-network/src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }.flatMap { f ->
            Regex("""^import\s+([\w.]+)""", RegexOption.MULTILINE).findAll(f.readText()).map { "${f.name}: ${it.groupValues[1]}" }
        }.toList()
        assertTrue("Nur ${importe.size} Importe in core-network — Pfad veraltet?", importe.size > 20)
        // An intent is UI (core-ui), not a network rule.
        val fremd = importe.filter { Regex(""": (androidx\.room|dagger|javax\.inject|retrofit2|android\.content|ch\.brickinventoryapp\.data\.(repository|lokal|cache))\b""").containsMatchIn(it) }
        assertTrue("core-network importiert Ablage, Repositories, DI oder Android-Oberfläche: $fremd", fremd.isEmpty())
        checkUiWithoutDomainKnowledge()
    }

    /**
     * core-ui is the design system: theme and building blocks without domain knowledge. Whoever needs a domain type
     * (model.fach) or a server model (model.data) is a domain building block
     * and belongs in the area or in core-ui-inventory; it only formats amounts and currency.
     */
    private fun checkUiWithoutDomainKnowledge() {
        val root = File(project, "core-ui/src/main/java")
        val dateien = root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        assertTrue("Nur ${dateien.size} Dateien in core-ui — Pfad veraltet?", dateien.size >= 40)
        val fach = Regex("""\bch\.brickinventoryapp\.model\.(data|fach\.(?!(Waehrung|Geld)\b))""")
        val findings = dateien.filter { fach.containsMatchIn(Quellen.withoutComments(it.readText())) }.map { it.relativeTo(root).path }
        assertTrue("core-ui kennt Fachmodelle: $findings", findings.isEmpty())
        // The camera building blocks are still called ui.screens; new screens or building blocks do not go there.
        val screens = File(root, "ch/brickinventoryapp/ui/screens").listFiles().orEmpty().map { it.name }.sorted()
        assertEquals("core-ui/ui/screens enthält nur die Kamera-Bausteine", listOf("KameraAufbau.kt", "KameraErlaubnis.kt"), screens)
    }

    /**
     * The rule itself, on edges that do not exist in the tree.
     *
     * Counter-checks (measured with kotlinc):
     *   gegenproben/kantenregel-ohne-testausnahme.patch: test configurations count → red here
     *   the api line deleted → red here, „Modulkanten per api …“ missing
     *   core-ui entered in kerne["core-state"] → red here
     *   gegenproben/tiefe-kerne-offen.patch: the rule for depthCores deleted → red here
 *   gegenproben/wire-format-fuer-alle.patch: the rule for wireKenner deleted → red here
     *
     *   in uiViolation `modul in withoutUi &&` deleted → red here (core-navigation)
     *   gegenproben/zustand-darf-oberflaeche.patch: core-state missing in withoutUi → red here
     */
    @Test
    fun `the edge rule forbids area to area, wrong layering, api and core-testing in main code`() {
        fun pruefe(von: String, configuration: String, nach: String) = Modulkanten.violations(listOf(Modulkante(von, configuration, nach)))
        assertEquals(listOf("feature-parts hängt an feature-catalog"), pruefe("feature-parts", "implementation", "feature-catalog"))
        assertEquals(listOf("feature-parts hängt an app"), pruefe("feature-parts", "implementation", "app"))
        assertEquals(listOf("layering of the core modules: core-state hängt an core-ui"), pruefe("core-state", "implementation", "core-ui"))
        assertEquals(listOf("Modulkanten per api nur zu core-model: core-data → core-network"), pruefe("core-data", "api", "core-network"))
        assertEquals(listOf("Modulkanten per api nur zu core-model: core-data → core-contract"), pruefe("core-data", "api", "core-contract"))
        assertEquals(listOf("feature-parts kennt das Wire-Format: Nur core-data bildet es ab"),
            pruefe("feature-parts", "implementation", "core-contract"))
        assertEquals(listOf("app kennt das Wire-Format: Nur core-data bildet es ab"), pruefe("app", "implementation", "core-contract"))
        assertEquals(emptyList<String>(), pruefe("feature-parts", "testImplementation", "core-contract"))
        assertEquals(emptyList<String>(), pruefe("core-data", "implementation", "core-contract"))
        assertEquals(listOf("core-offline kennt das Wire-Format: Nur core-data bildet es ab"), pruefe("core-offline", "implementation", "core-contract"))
        assertEquals(listOf("feature-account bindet core-testing nicht nur für Tests ein"), pruefe("feature-account", "implementation", "core-testing"))
        assertEquals(listOf("feature-account hängt an core-security, das unter dem Zustand liegt"),
            pruefe("feature-account", "implementation", "core-security"))
        assertEquals(listOf("feature-parts hängt an core-network, das unter dem Zustand liegt"), pruefe("feature-parts", "implementation", "core-network"))
        assertTrue(pruefe("core-neu", "implementation", "core-model").single().endsWith("(core-neu hat keine Regel in Modulkanten.kerne)"))
        // Allowed: tests see more, the app sees everything except the test helpers, the layering downwards.
        assertEquals(emptyList<String>(), pruefe("feature-parts", "testImplementation", "core-testing"))
        assertEquals(emptyList<String>(), pruefe("feature-login", "implementation", "core-security"))
        assertEquals(emptyList<String>(), pruefe("feature-account", "testImplementation", "core-security"))
        assertEquals(emptyList<String>(), pruefe("core-state", "testImplementation", "core-ui"))
        assertEquals(emptyList<String>(), pruefe("app", "implementation", "feature-parts"))
        assertEquals(emptyList<String>(), pruefe("core-data", "api", "core-model"))
        assertEquals(emptyList<String>(), pruefe("core-state", "implementation", "core-data"))
        assertEquals("core-state liegt unter der Oberfläche und schaltet Compose ein: [brickinventory.android.compose]",
            Modulkanten.uiViolation("core-state", listOf("brickinventory.android.library", "brickinventory.android.compose")))
        assertEquals(null, Modulkanten.uiViolation("core-navigation", listOf("brickinventory.android.compose")))
        assertEquals(listOf("MerklisteViewModel liegt in core-state ohne Grund in Modulkanten.zustandsViewModels"),
            Modulkanten.stateViewModelViolations(Modulkanten.zustandsViewModels.keys + "MerklisteViewModel"))
    }

    @Test
    fun `core-model stays without Android`() {
        val bau = module().getValue("core-model")
        val plugins = Regex("""alias\(libs\.plugins\.([\w.]+)\)""").findAll(bau).map { it.groupValues[1] }.toSet()
        assertTrue("core-model ist kein reines Kotlin-Modul: $plugins", "brickinventory.jvm.library" in plugins)
        // The JVM convention itself applies kotlin.jvm and no Android plugin.
        val convention = File(project, "build-logic/convention/src/main/kotlin/ch/brickinventoryapp/buildlogic/Konventionen.kt")
            .readText().substringAfter("class JvmLibraryKonvention").substringBefore("\n}\n")
        assertTrue("die JVM-Konvention wendet kotlin.jvm an", "pluginAusKatalog(\"kotlin.jvm\")" in convention)
        assertTrue("die JVM-Konvention bleibt ohne Android", "android" !in convention.lowercase())
        val android = plugins.filter { it in setOf("android.application", "android.library", "kotlin.compose", "hilt", "ksp") }
        assertTrue("core-model stays without Android: $android", android.isEmpty())
        val libraries = Regex("""\(libs\.([\w.]+)\)""").findAll(bau).map { it.groupValues[1] }.toList()
        assertTrue("core-model stays without Android: $libraries",
            libraries.none { it.startsWith("androidx") || it.startsWith("hilt") || it.startsWith("robolectric") })
        assertTrue("core-model hängt an anderen Modulen: ${mainDependencies(bau)}", mainDependencies(bau).isEmpty())
    }

    @Test
    fun `the app includes every area`() {
        val app = mainDependencies(module().getValue("app"))
        val areas = module().keys.filter { it.startsWith("feature-") }.toSet()
        assertEquals("ein Bereich ohne die App wäre toter Code", areas, app.filter { it.startsWith("feature-") }.toSet())
    }

    /** Plugins like dependencies: google() only for Google's groups, otherwise mavenCentral. */
    @Test
    fun `google() only supplies Google's groups`() {
        // build-logic resolves AGP and Kotlin for the conventions itself.
        for (datei in listOf("settings.gradle.kts", "build-logic/settings.gradle.kts")) {
            val settings = File(project, datei).readText().lines()
                .filterNot { it.trim().startsWith("//") }.joinToString("\n")
            val google = Regex("""\bgoogle \{[^\n]*""").findAll(settings).map { it.value }.toList()
            assertEquals("$datei, pluginManagement und dependencyResolutionManagement: $google", 2, google.size)
            for (z in google) assertTrue("Ohne Inhaltsfilter in $datei: $z", z.startsWith("google { content {") &&
                listOf("com\\\\.android.*", "com\\\\.google.*", "androidx.*").all { z.contains("includeGroupByRegex(\"$it\")") })
            // Exclusive: androidx, com.android and com.google.android only from Google.
            val exclusive = Regex("""exclusiveContent \{\s*forRepository \{ google\(\) }\s*filter \{([^\n]*)}""")
                .findAll(settings).map { it.groupValues[1] }.toList()
            assertEquals("exclusiveContent je Block in $datei", 2, exclusive.size)
            for (f in exclusive) assertTrue("Exklusive Gruppen in $datei: $f",
                listOf("androidx\\\\..*", "com\\\\.android(\\\\..*)?", "com\\\\.google\\\\.android\\\\..*").all { f.contains("includeGroupByRegex(\"$it\")") })
        }
    }

    /**
     * This test reads the edges from the module scripts. If a convention added
     * one itself, it would apply to every module with this plugin and would stand
     * nowhere here.
     */
    @Test
    fun `conventions add no module edges`() {
        val quellen = File(project, "build-logic").walkTopDown()
            .filter { it.isFile && (it.extension == "kt" || it.name.endsWith(".gradle.kts")) }.toList()
        assertTrue("Nur ${quellen.size} Dateien unter build-logic — Suche veraltet?", quellen.size >= 4)
        val edge = Regex("""\bproject\s*\(""")
        val withEdge = quellen.filter { edge.containsMatchIn(Quellen.withoutComments(it.readText())) }.map { it.name }
        assertTrue("conventions add no module edges: $withEdge", withEdge.isEmpty())
    }

    /**
     * pdfium parses third-party files; only the service in the isolated process may do so. Only
     * pixels come back into a buffer of fixed size, never a bitmap parcel to unpack.
     */
    @Test
    fun `PdfRenderer lives only in the isolated render service`() {
        val call = Regex("""\bPdfRenderer\s*\(""")
        val unpack = Regex("""\bBitmap\.CREATOR\b""")
        val quellen = Quellen.module.flatMap { m ->
            File(m, "src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }
                .map { it.name to Quellen.withoutComments(it.readText()) }.toList()
        }
        assertEquals(listOf("PdfRenderDienst.kt"), quellen.filter { call.containsMatchIn(it.second) }.map { it.first })
        assertEquals("Ein Bitmap-Parcel wird ausgepackt", emptyList<String>(),
            quellen.filter { unpack.containsMatchIn(it.second) }.map { it.first })
    }

    /**
     * A key with a group regex covered every future package of the group without a
     * checksum entry. A new checksum run writes regexes again:
     * then red here, and in the pull request they are replaced by the groups.
     */
    @Test
    fun `no key applies to a whole group via regex`() {
        val meta = File(project, "gradle/verification-metadata.xml").readText()
        assertTrue("verification-metadata.xml ohne Schlüssel — Pfad veraltet?", meta.contains("<trusted-key "))
        val regex = meta.lines().filter { "regex=\"true\"" in it }.map { it.trim() }
        assertEquals("Gruppen-Regex im Vertrauen: $regex", emptyList<String>(), regex)
    }

    /** Vulnerabilities in the build tooling are justified, time-limited and concern a version that exists. */
    @Test
    fun `every vulnerability in the build tooling is justified, time-limited and current`() {
        val meta = File(project, "gradle/verification-metadata.xml").readText()
        val zeilen = File(project, "tools/build-tool-vulnerabilities.txt").readLines()
        val entry = Regex("""^([\w.-]+):([\w.-]+):([\w.-]+) (CVE-\d{4}-\d+) bis:(\d{4}-\d{2}-\d{2})$""")
        var n = 0
        zeilen.forEachIndexed { i, z ->
            if (z.isBlank() || z.startsWith("#")) return@forEachIndexed
            val m = entry.matchEntire(z.trim())
            assertTrue("Zeile ${i + 1} hat nicht die Form gruppe:name:fassung CVE bis:Datum: $z", m != null)
            val (gruppe, name, fassung) = m!!.destructured
            val bis = m.groupValues[5]
            n++
            assertTrue("Ohne Grund darüber: $z", i > 0 && zeilen[i - 1].startsWith("# ") && zeilen[i - 1].length > 20)
            assertTrue("Abgelaufen: $z", LocalDate.parse(bis) >= LocalDate.now())
            assertTrue("$gruppe:$name:$fassung steht nicht mehr in verification-metadata.xml — Zeile streichen",
                meta.contains("<component group=\"$gruppe\" name=\"$name\" version=\"$fassung\">"))
        }
        assertTrue("Nur $n Einträge — Format veraltet?", n >= 1)
    }
}
