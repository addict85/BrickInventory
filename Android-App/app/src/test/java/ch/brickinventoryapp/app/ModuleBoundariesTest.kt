package ch.brickinventoryapp.app

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.buildlogic.edges.ModuleEdge
import ch.brickinventoryapp.buildlogic.edges.ModuleEdges
import ch.brickinventoryapp.testing.Sources

/**
 * The module boundaries, read from settings.gradle.kts and the build.gradle.kts:
 * app → feature-* → core-*, no area knows another (without exception),
 * fixed layering of the core modules, core-model without Android, core-ui without domain knowledge.
 * The edge rule is build-logic/…/edges/ModuleEdges.kt; the task
 * moduleEdgesCheck runs the same in Gradle, here it runs against the module scripts.
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
 *   F  counter-checks/konvention-mit-modulkante.patch: the area convention
 *      adds core-ui → red “conventions add no module edges“
 *   G  in build-logic/settings.gradle.kts `google()` without filter →
 *      red „Ohne Inhaltsfilter in build-logic/settings.gradle.kts“
 *   I in settings.gradle.kts an exclusiveContent
 *      deleted → red „exclusiveContent je Block in settings.gradle.kts“
 *   J a `regex="true"` back in
 *      verification-metadata.xml → red “no key applies to a whole group …”
 *   K in build-tool-vulnerabilities.txt the version set to 3.15.0
 *      → red “every vulnerability in the build tooling …” (not in verification-metadata.xml)
 *   H a `PdfRenderer(` in PdfPage.kt →
 *      red “PdfRenderer lives only in the isolated render service“; likewise
 *      counter-checks/pdf-bitmap-aus-dem-renderer.patch (again `Bitmap.CREATOR.createFromParcel`)
 *   L  counter-checks/netz-haengt-an-ablage.patch: core-network includes Room →
 *      red „core-network hängt an Ablage oder DI“ (layering of the core modules);
 *      only CI measures it, locally there is no Gradle
 *   M  counter-checks/merge-rest-im-baum.patch: a file `Rest.kt.orig` in the tree →
 *      red “no merge remnant lies in the tree” (every module folder is included …)
 *   N  counter-checks/dienste-haengt-an-update.patch: core-services includes core-update →
 *      red „layering of the core modules: core-services hängt an [core-update]“ (core-data →
 *      core-update is already caught by Gradle as a cycle)
 *   P  counter-checks/zustand-haengt-an-ui.patch: core-state includes core-ui →
 *      red „layering of the core modules: core-state hängt an [core-ui]“
 *   Q  counter-checks/gemeinsam-haengt-an-daten.patch: core-ui-inventory includes core-data →
 *      red „layering of the core modules: core-ui-inventory hängt an [core-data]“
 *   U  counter-checks/offline-haengt-an-daten.patch: core-offline includes core-ui →
 *      red „layering of the core modules: core-offline hängt an [core-ui]“ (core-data
 *      would not work: Gradle already aborts the cycle, without a test report)
 *   W  counter-checks/ablage-kennt-wireformat.patch: core-offline includes core-contract again →
 *      red „core-offline kennt das Wire-Format“ (layering of the core modules)
 *   T  counter-checks/bereich-kennt-bereich.patch: feature-parts includes feature-catalog →
 *      red „feature-parts hängt an feature-catalog“
 *   R  counter-checks/ui-kennt-ansicht.patch: a core-ui file imports a view from
 *      model.fach → red „core-ui kennt Fachmodelle“ (layering of the core modules)
 *   S  counter-checks/ui-neuer-bildschirm.patch: a new file in core-ui/ui/screens →
 *      red „core-ui/ui/screens enthält nur die Kamera-Bausteine“ (layering …)
 *   O  counter-checks/fremder-paketstamm.patch: feature-parts gets a file in the package
 *      ch.brickinventoryapp.collection → red „außerhalb des Paketstamms ihres Moduls“
 *   V  counter-checks/daten-reicht-netz-weiter.patch: core-data includes core-network via api →
 *      red „Modulkanten per api nur zu core-model: [core-data → core-network]“ (layering …)
 *   X  counter-checks/netz-oeffnet-intent.patch: ExternalAddress.kt imports android.content.Intent →
 *      red „core-network importiert Ablage, Repositories, DI oder Android-Oberfläche“ (layering …)
 *   Y  counter-checks/sitzung-haengt-an-ui.patch: core-session includes core-ui →
 *      red „layering of the core modules: core-session hängt an core-ui“
 *   Z  counter-checks/konto-haengt-an-tresor.patch: feature-account includes core-security again →
 *      red „feature-account hängt an core-security, das unter dem Zustand liegt“ (no area depends …)
 *   AA core-state switches on brickinventory.android.compose again → red „core-state liegt unter
 *      der Oberfläche und schaltet Compose ein“ (layering …; measured with kotlinc, in Gradle
 *      AndroidComposeConvention already aborts); counter-checks/zustand-darf-oberflaeche.patch → red “the edge rule …”
 *   AB counter-checks/bereichs-viewmodel-im-zustand.patch: a ViewModel of only one area in core-state
 *      → red „… liegt in core-state ohne Grund in ModuleEdges.stateViewModels“ (layering …)
 *   W  counter-checks/route-im-kern.patch: a route in core-model, the management opens it →
 *      red „feature-management nennt fremde Routentypen: [Zentralziel]“ (no area depends …);
 *      measured locally with kotlinc against the tree, in CI via Gradle
 */
class ModuleBoundariesTest {

    private data class Dependency(val configuration: String, val target: String)

    private val project = Sources.project

    private fun module(): Map<String, String> =
        Sources.module.filter { it.name != "buildSrc" }.associate { it.name to File(it, "build.gradle.kts").readText() }

    private fun edges(name: String, build: String): List<ModuleEdge> =
        dependencies(build).map { ModuleEdge(name, it.configuration, it.target) }

    private fun dependencies(build: String): List<Dependency> =
        Regex("""^\s*(\w+)\(project\(":([\w-]+)"\)\)""", RegexOption.MULTILINE).findAll(build)
            .map { Dependency(it.groupValues[1], it.groupValues[2]) }.toList()

    /** What applies in the shipped code; test configurations do not count. */
    private fun mainDependencies(build: String): Set<String> =
        dependencies(build).filter { !it.configuration.startsWith("test") }.map { it.target }.toSet()

    @Test
    fun `every module folder is included, every included module exists, no merge remnant lies in the tree, and every Kotlin file lies in its module's package root`() {
        // A .orig/.rej is never compiled, but counts for every search across the tree.
        val root: File = checkNotNull(project.parentFile)
        val remainder = root.walkTopDown()
            .onEnter { it.name !in setOf(".git", ".claude", ".gradle", "build", "node_modules") }
            .filter { it.isFile && it.extension in setOf("orig", "rej") }.map { it.relativeTo(root).path }.toList()
        assertTrue("Merge-Reste im Baum, löschen: $remainder", remainder.isEmpty())
        val included = Regex("""include\("(:[\w-]+)"\)""")
            .findAll(File(project, "settings.gradle.kts").readText()).map { it.groupValues[1].removePrefix(":") }.toSet()
        val folder = module().keys
        assertTrue("Nur ${folder.size} Module gefunden — Suche veraltet?", folder.size >= 12)
        assertEquals("jeder Modulordner ist eingebunden", folder, included)
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
        val wrong = mutableListOf<String>()
        var n = 0
        for (m in Sources.module) for (sentence in listOf("main", "test")) {
            val basis = File(m, "src/$sentence/java")
            if (!basis.isDirectory) continue
            for (f in basis.walkTopDown().filter { it.isFile && it.extension == "kt" }) {
                n++
                val rel = f.relativeTo(basis).invariantSeparatorsPath
                val pkg = packageRow.find(f.readText())?.groupValues?.get(1)
                val should = master[m.name]?.let { "ch.brickinventoryapp.$it" }
                val folderPackage = rel.substringBeforeLast('/').replace('/', '.')
                if (should == null || pkg != folderPackage || !(pkg == should || pkg.startsWith("$should."))) {
                    wrong += "${m.name}/src/$sentence: $rel (package $pkg, Stamm ${should ?: "fehlt"})"
                }
            }
        }
        assertTrue("Nur $n Kotlin-Dateien gefunden — Suche veraltet?", n >= 500)
        assertTrue("Dateien außerhalb des Paketstamms ihres Moduls:\n  " + wrong.joinToString("\n  "), wrong.isEmpty())
    }

    @Test
    fun `no area depends on another area or on the app, none names foreign route types`() {
        val areas = module().filterKeys { it.startsWith("feature-") }
        assertTrue("Nur ${areas.size} Bereichsmodule", areas.size >= 5)
        for ((name, build) in areas) {
            // Ohne Ausnahme: Was mehrere Bereiche zeigen, liegt in core-ui-inventory.
            val wrong = ModuleEdges.violations(edges(name, build))
            assertTrue(wrong.joinToString("\n"), wrong.isEmpty())
            assertTrue("$name kennt keine Kernmodule — Muster veraltet?", mainDependencies(build).any { it.startsWith("core-") })
        }
        // Routes: an area registers and opens only its own destinations, foreign ones via the callbacks
        // of its navigation interface. A route in a core module would be the central list again.
        val routesCall = Regex("""\b(?:composable|navigation|popUpTo|getBackStackEntry|toRoute|hasRoute)<([A-Z]\w*)|\bnavigate\(\s*([A-Z]\w*)""")
        val declaration = Regex("""\b(?:class|interface|object)\s+(\w+)""")
        for (name in areas.keys) {
            val sources = File(project, "$name/src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }
                .map { Sources.withoutComments(it.readText()) }.toList()
            val own = sources.flatMap { q -> declaration.findAll(q).map { it.groupValues[1] } }.toSet()
            val named = sources.flatMap { q -> routesCall.findAll(q).map { it.groupValues[1].ifEmpty { it.groupValues[2] } } }.toSet()
            assertTrue("$name nennt keine Route — Muster veraltet?", named.isNotEmpty())
            assertTrue("$name nennt fremde Routentypen: ${named - own}", (named - own).isEmpty())
        }
    }

    @Test
    fun `layering of the core modules`() {
        val cores = module().filterKeys { it.startsWith("core-") }
        assertEquals("jedes Kernmodul hat eine Regel", ModuleEdges.cores.keys, cores.keys)
        val all = module().flatMap { (name, build) -> edges(name, build) }
        assertTrue("Nur ${all.size} Modulkanten — Muster veraltet?", all.size >= 60)
        val violations = ModuleEdges.violations(all)
        assertTrue(violations.joinToString("\n"), violations.isEmpty())
        val plugin = Regex("""alias\(libs\.plugins\.([\w.]+)\)""")
        val ui = module().mapNotNull { (name, build) -> ModuleEdges.uiViolation(name, plugin.findAll(build).map { it.groupValues[1] }.toList()) }
        assertTrue(ui.joinToString("\n"), ui.isEmpty())
        val viewModel = Regex("""\bclass\s+(\w+)[^{]*?:\s*ViewModel\(\)""")
        val stateVms = File(project, "core-state/src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }
            .flatMap { f -> viewModel.findAll(Sources.withoutComments(f.readText())).map { it.groupValues[1] } }.toList()
        assertTrue("Keine ViewModels in core-state gefunden — Muster veraltet?", stateVms.size >= 3)
        val vmWrong = ModuleEdges.stateViewModelViolations(stateVms)
        assertTrue(vmWrong.joinToString("\n"), vmWrong.isEmpty())
        // core-network is the lower network layer: store, repositories and Hilt stay in core-data.
        val network = cores.getValue("core-network")
        val libraries = Regex("""\(libs\.([\w.]+)\)""").findAll(network).map { it.groupValues[1] }.toList()
        val store = listOf("androidx.room", "sqlcipher", "hilt", "androidx.hilt", "androidx.datastore", "androidx.work", "retrofit")
        assertTrue("core-network hängt an Ablage oder DI: $libraries", libraries.none { b -> store.any { b.startsWith(it) } })
        val imports = File(project, "core-network/src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }.flatMap { f ->
            Regex("""^import\s+([\w.]+)""", RegexOption.MULTILINE).findAll(f.readText()).map { "${f.name}: ${it.groupValues[1]}" }
        }.toList()
        assertTrue("Nur ${imports.size} Importe in core-network — Pfad veraltet?", imports.size > 20)
        // An intent is UI (core-ui), not a network rule.
        val foreign = imports.filter { Regex(""": (androidx\.room|dagger|javax\.inject|retrofit2|android\.content|ch\.brickinventoryapp\.data\.(repository|local|cache))\b""").containsMatchIn(it) }
        assertTrue("core-network importiert Ablage, Repositories, DI oder Android-Oberfläche: $foreign", foreign.isEmpty())
        checkUiWithoutDomainKnowledge()
    }

    /**
     * core-ui is the design system: theme and building blocks without domain knowledge. Whoever needs a domain type
     * (model.fach) or a server model (model.data) is a domain building block
     * and belongs in the area or in core-ui-inventory; it only formats amounts and currency.
     */
    private fun checkUiWithoutDomainKnowledge() {
        val root = File(project, "core-ui/src/main/java")
        val files = root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        assertTrue("Nur ${files.size} Dateien in core-ui — Pfad veraltet?", files.size >= 40)
        val domain = Regex("""\bch\.brickinventoryapp\.model\.(data|domain\.(?!(CurrencyCode|Money)\b))""")
        val findings = files.filter { domain.containsMatchIn(Sources.withoutComments(it.readText())) }.map { it.relativeTo(root).path }
        assertTrue("core-ui kennt Fachmodelle: $findings", findings.isEmpty())
        // The camera building blocks are still called ui.screens; new screens or building blocks do not go there.
        val screens = File(root, "ch/brickinventoryapp/ui/screens").listFiles().orEmpty().map { it.name }.sorted()
        assertEquals("core-ui/ui/screens enthält nur die Kamera-Bausteine", listOf("CameraPermission.kt", "CameraSetup.kt"), screens)
    }

    /**
     * The rule itself, on edges that do not exist in the tree.
     *
     * Counter-checks (measured with kotlinc):
     *   counter-checks/kantenregel-ohne-testausnahme.patch: test configurations count → red here
     *   the api line deleted → red here, „Modulkanten per api …“ missing
     *   core-ui entered in kerne["core-state"] → red here
     *   counter-checks/tiefe-kerne-offen.patch: the rule for depthCores deleted → red here
 *   counter-checks/wire-format-fuer-alle.patch: the rule for wireMarker deleted → red here
     *
     *   in uiViolation `module in withoutUi &&` deleted → red here (core-navigation)
     *   counter-checks/zustand-darf-oberflaeche.patch: core-state missing in withoutUi → red here
     */
    @Test
    fun `the edge rule forbids area to area, wrong layering, api and core-testing in main code`() {
        fun check(of: String, configuration: String, after: String) = ModuleEdges.violations(listOf(ModuleEdge(of, configuration, after)))
        assertEquals(listOf("feature-parts hängt an feature-catalog"), check("feature-parts", "implementation", "feature-catalog"))
        assertEquals(listOf("feature-parts hängt an app"), check("feature-parts", "implementation", "app"))
        assertEquals(listOf("layering of the core modules: core-state hängt an core-ui"), check("core-state", "implementation", "core-ui"))
        assertEquals(listOf("Modulkanten per api nur zu core-model: core-data → core-network"), check("core-data", "api", "core-network"))
        assertEquals(listOf("Modulkanten per api nur zu core-model: core-data → core-contract"), check("core-data", "api", "core-contract"))
        assertEquals(listOf("feature-parts kennt das Wire-Format: Nur core-data bildet es ab"),
            check("feature-parts", "implementation", "core-contract"))
        assertEquals(listOf("app kennt das Wire-Format: Nur core-data bildet es ab"), check("app", "implementation", "core-contract"))
        assertEquals(emptyList<String>(), check("feature-parts", "testImplementation", "core-contract"))
        assertEquals(emptyList<String>(), check("core-data", "implementation", "core-contract"))
        assertEquals(listOf("core-offline kennt das Wire-Format: Nur core-data bildet es ab"), check("core-offline", "implementation", "core-contract"))
        assertEquals(listOf("feature-account bindet core-testing nicht nur für Tests ein"), check("feature-account", "implementation", "core-testing"))
        assertEquals(listOf("feature-account hängt an core-security, das unter dem Zustand liegt"),
            check("feature-account", "implementation", "core-security"))
        assertEquals(listOf("feature-parts hängt an core-network, das unter dem Zustand liegt"), check("feature-parts", "implementation", "core-network"))
        assertTrue(check("core-neu", "implementation", "core-model").single().endsWith("(core-neu hat keine Regel in ModuleEdges.cores)"))
        // Allowed: tests see more, the app sees everything except the test helpers, the layering downwards.
        assertEquals(emptyList<String>(), check("feature-parts", "testImplementation", "core-testing"))
        assertEquals(emptyList<String>(), check("feature-login", "implementation", "core-security"))
        assertEquals(emptyList<String>(), check("feature-account", "testImplementation", "core-security"))
        assertEquals(emptyList<String>(), check("core-state", "testImplementation", "core-ui"))
        assertEquals(emptyList<String>(), check("app", "implementation", "feature-parts"))
        assertEquals(emptyList<String>(), check("core-data", "api", "core-model"))
        assertEquals(emptyList<String>(), check("core-state", "implementation", "core-data"))
        assertEquals("core-state liegt unter der Oberfläche und schaltet Compose ein: [brickinventory.android.compose]",
            ModuleEdges.uiViolation("core-state", listOf("brickinventory.android.library", "brickinventory.android.compose")))
        assertEquals(null, ModuleEdges.uiViolation("core-navigation", listOf("brickinventory.android.compose")))
        assertEquals(listOf("WantedListViewModel liegt in core-state ohne Grund in ModuleEdges.stateViewModels"),
            ModuleEdges.stateViewModelViolations(ModuleEdges.stateViewModels.keys + "WantedListViewModel"))
    }

    @Test
    fun `core-model stays without Android`() {
        val build = module().getValue("core-model")
        val plugins = Regex("""alias\(libs\.plugins\.([\w.]+)\)""").findAll(build).map { it.groupValues[1] }.toSet()
        assertTrue("core-model ist kein reines Kotlin-Modul: $plugins", "brickinventory.jvm.library" in plugins)
        // The JVM convention itself applies kotlin.jvm and no Android plugin.
        val convention = File(project, "build-logic/convention/src/main/kotlin/ch/brickinventoryapp/buildlogic/Conventions.kt")
            .readText().substringAfter("class JvmLibraryConvention").substringBefore("\n}\n")
        assertTrue("die JVM-Konvention wendet kotlin.jvm an", "pluginFromCatalog(\"kotlin.jvm\")" in convention)
        assertTrue("die JVM-Konvention bleibt ohne Android", "android" !in convention.lowercase())
        val android = plugins.filter { it in setOf("android.application", "android.library", "kotlin.compose", "hilt", "ksp") }
        assertTrue("core-model stays without Android: $android", android.isEmpty())
        val libraries = Regex("""\(libs\.([\w.]+)\)""").findAll(build).map { it.groupValues[1] }.toList()
        assertTrue("core-model stays without Android: $libraries",
            libraries.none { it.startsWith("androidx") || it.startsWith("hilt") || it.startsWith("robolectric") })
        assertTrue("core-model hängt an anderen Modulen: ${mainDependencies(build)}", mainDependencies(build).isEmpty())
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
        for (file in listOf("settings.gradle.kts", "build-logic/settings.gradle.kts")) {
            val settings = File(project, file).readText().lines()
                .filterNot { it.trim().startsWith("//") }.joinToString("\n")
            val google = Regex("""\bgoogle \{[^\n]*""").findAll(settings).map { it.value }.toList()
            assertEquals("$file, pluginManagement und dependencyResolutionManagement: $google", 2, google.size)
            for (z in google) assertTrue("Ohne Inhaltsfilter in $file: $z", z.startsWith("google { content {") &&
                listOf("com\\\\.android.*", "com\\\\.google.*", "androidx.*").all { z.contains("includeGroupByRegex(\"$it\")") })
            // Exclusive: androidx, com.android and com.google.android only from Google.
            val exclusive = Regex("""exclusiveContent \{\s*forRepository \{ google\(\) }\s*filter \{([^\n]*)}""")
                .findAll(settings).map { it.groupValues[1] }.toList()
            assertEquals("exclusiveContent je Block in $file", 2, exclusive.size)
            for (f in exclusive) assertTrue("Exklusive Gruppen in $file: $f",
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
        val sources = File(project, "build-logic").walkTopDown()
            .filter { it.isFile && (it.extension == "kt" || it.name.endsWith(".gradle.kts")) }.toList()
        assertTrue("Nur ${sources.size} Dateien unter build-logic — Suche veraltet?", sources.size >= 4)
        val edge = Regex("""\bproject\s*\(""")
        val withEdge = sources.filter { edge.containsMatchIn(Sources.withoutComments(it.readText())) }.map { it.name }
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
        val sources = Sources.module.flatMap { m ->
            File(m, "src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }
                .map { it.name to Sources.withoutComments(it.readText()) }.toList()
        }
        assertEquals(listOf("PdfRenderService.kt"), sources.filter { call.containsMatchIn(it.second) }.map { it.first })
        assertEquals("Ein Bitmap-Parcel wird ausgepackt", emptyList<String>(),
            sources.filter { unpack.containsMatchIn(it.second) }.map { it.first })
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
        val rows = File(project, "tools/build-tool-vulnerabilities.txt").readLines()
        val entry = Regex("""^([\w.-]+):([\w.-]+):([\w.-]+) (CVE-\d{4}-\d+) bis:(\d{4}-\d{2}-\d{2})$""")
        var n = 0
        rows.forEachIndexed { i, z ->
            if (z.isBlank() || z.startsWith("#")) return@forEachIndexed
            val m = entry.matchEntire(z.trim())
            assertTrue("Zeile ${i + 1} hat nicht die Form gruppe:name:fassung CVE bis:Datum: $z", m != null)
            val (group, name, version) = m!!.destructured
            val until = m.groupValues[5]
            n++
            assertTrue("Ohne Grund darüber: $z", i > 0 && rows[i - 1].startsWith("# ") && rows[i - 1].length > 20)
            assertTrue("Abgelaufen: $z", LocalDate.parse(until) >= LocalDate.now())
            assertTrue("$group:$name:$version steht nicht mehr in verification-metadata.xml — Zeile streichen",
                meta.contains("<component group=\"$group\" name=\"$name\" version=\"$version\">"))
        }
        assertTrue("Nur $n Einträge — Format veraltet?", n >= 1)
    }
}
