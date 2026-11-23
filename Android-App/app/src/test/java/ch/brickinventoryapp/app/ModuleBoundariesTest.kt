package ch.brickinventoryapp.app

import ch.brickinventoryapp.buildlogic.edges.ModuleEdge
import ch.brickinventoryapp.buildlogic.edges.ModuleEdges
import ch.brickinventoryapp.testing.Sources
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDate

/**
 * The module boundaries, read from settings.gradle.kts and the build.gradle.kts:
 * app → feature-* → core-*, no area knows another (without exception),
 * fixed layering of the core modules, core-model without Android, core-ui without domain knowledge.
 * The edge rule is build-logic/…/edges/ModuleEdges.kt; the task
 * moduleEdgesCheck runs the same in Gradle, here it runs against the module scripts.
 *
 * Counter-checks:
 *   A  feature-collection: `implementation(project(":feature-parts"))` → red
 *      „feature-collection depends on feature-parts“
 *   B  core-model: jvm.library replaced by android.library → red „core-model ist kein reines Kotlin-Modul“
 *   C  core-data: `implementation(project(":core-ui"))` → red „layering of the core modules: core-data depends on [core-ui]“
 *   D  include(":feature-management") deleted from settings.gradle.kts → red
 *      “every module folder is included”
 *   E  in dependencyResolutionManagement again `google()` → red
 *      “google() only supplies Google's groups“ (Ohne Inhaltsfilter)
 *   F  counter-checks/convention-with-module-edge.patch: the area convention
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
 *      counter-checks/pdf-bitmap-from-the-renderer.patch (again `Bitmap.CREATOR.createFromParcel`)
 *   M  `internal` removed from `class SetsRepositoryImpl` → red „SetsRepositoryImpl is public“ (layering of the core modules); likewise an import of data.parts.PartsRepositoryImpl
 *      in collection/SetsRepositoryImpl.kt → red „kennt parts.PartsRepositoryImpl“
 *   L  counter-checks/network-depends-on-store.patch: core-network includes Room →
 *      red „core-network depends on storage or DI“ (layering of the core modules);
 *      only CI measures it, locally there is no Gradle
 *   M  counter-checks/merge-leftover-in-tree.patch: a file `Rest.kt.orig` in the tree →
 *      red “no merge remnant lies in the tree” (every module folder is included …)
 *   N  counter-checks/services-depends-on-update.patch: core-services includes core-update →
 *      red „layering of the core modules: core-services depends on [core-update]“ (core-data →
 *      core-update is already caught by Gradle as a cycle)
 *   P  counter-checks/state-depends-on-ui.patch: core-state includes core-ui →
 *      red „layering of the core modules: core-state depends on [core-ui]“
 *   Q  counter-checks/common-depends-on-data.patch: core-ui-inventory includes core-data →
 *      red „layering of the core modules: core-ui-inventory depends on [core-data]“
 *   U  counter-checks/offline-depends-on-data.patch: core-offline includes core-ui →
 *      red „layering of the core modules: core-offline depends on [core-ui]“ (core-data
 *      would not work: Gradle already aborts the cycle, without a test report)
 *   W  counter-checks/store-knows-wire-format.patch: core-offline includes core-contract again →
 *      red „core-offline knows the wire format“ (layering of the core modules)
 *   T  counter-checks/scope-knows-scope.patch: feature-parts includes feature-catalog →
 *      red „feature-parts depends on feature-catalog“
 *   R  counter-checks/ui-knows-view.patch: a core-ui file imports a view from
 *      model.domain → red „core-ui kennt Fachmodelle“ (layering of the core modules)
 *   S  counter-checks/ui-new-screen.patch: a new file in core-ui/ui/screens →
 *      red „core-ui/ui/screens contains only the camera building blocks“ (layering …)
 *   O  counter-checks/foreign-package-root.patch: feature-parts gets a file in the package
 *      ch.brickinventoryapp.collection → red „outside the package root of their module“
 *   V  counter-checks/data-passes-network-on.patch: core-data includes core-network via api →
 *      red „module edges via api only to core-model: [core-data → core-network]“ (layering …)
 *   X  counter-checks/network-opens-intent.patch: ExternalAddress.kt imports android.content.Intent →
 *      red „core-network imports storage, repositories, DI or Android UI“ (layering …)
 *   Y  counter-checks/session-depends-on-ui.patch: core-session includes core-ui →
 *      red „layering of the core modules: core-session depends on core-ui“
 *   Z  counter-checks/account-depends-on-vault.patch: feature-account includes core-security again →
 *      red „feature-account depends on core-security, which lies below the state“ (no area depends …)
 *   AA core-state switches on brickinventory.android.compose again → red „core-state lies below the UI and switches on Compose“ (layering …; measured with kotlinc, in Gradle
 *      AndroidComposeConvention already aborts); counter-checks/state-may-use-ui.patch → red “the edge rule …”
 *   AB counter-checks/scope-viewmodel-in-state.patch: a ViewModel of only one area in core-state
 *      → red „… lies in core-state without a reason in ModuleEdges.stateViewModels“ (layering …)
 *   W  counter-checks/route-in-core.patch: a route in core-model, the management opens it →
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
        Regex("""^\s*(\w+)\((?:testFixtures\()?project\(":([\w-]+)"\)\)""", RegexOption.MULTILINE).findAll(build)
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
        assertTrue("merge leftovers in the tree, delete: $remainder", remainder.isEmpty())
        val included = Regex("""include\("(:[\w-]+)"\)""")
            .findAll(File(project, "settings.gradle.kts").readText()).map { it.groupValues[1].removePrefix(":") }.toSet()
        val folder = module().keys
        assertTrue("Only ${folder.size} modules found — search outdated?", folder.size >= 12)
        assertEquals("every module folder is included", folder, included)
        // Every module has its own package root (table in `README.md`): an import
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
        assertEquals("no root is assigned twice", master.size, master.values.toSet().size)
        val wrong = filesOutsidePackageRoot(master)
        assertTrue("Files outside the package root of their module:\n  " + wrong.joinToString("\n  "), wrong.isEmpty())
    }

    /**
     * The Kotlin files outside their module's package root. Test fixtures sit in a
     * `.testing` package of their module, so a test's import names whose fixture it uses.
     */
    private fun inRoot(rel: String, pkg: String?, should: String?, fixtures: Boolean): Boolean =
        should != null && pkg == rel.substringBeforeLast('/').replace('/', '.') &&
            (pkg == should || pkg.startsWith("$should.")) && (!fixtures || pkg.endsWith(".testing"))

    private fun filesOutsidePackageRoot(master: Map<String, String>): List<String> {
        val packageRow = Regex("""^package\s+([\w.]+)""", RegexOption.MULTILINE)
        val wrong = mutableListOf<String>()
        var n = 0
        for (m in Sources.module) for (sentence in listOf("main", "test", "testFixtures")) {
            val basis = File(m, "src/$sentence/java")
            if (!basis.isDirectory) continue
            for (f in basis.walkTopDown().filter { it.isFile && it.extension == "kt" }) {
                n++
                val rel = f.relativeTo(basis).invariantSeparatorsPath
                val pkg = packageRow.find(f.readText())?.groupValues?.get(1)
                val should = master[m.name]?.let { "ch.brickinventoryapp.$it" }
                if (!inRoot(rel, pkg, should, fixtures = sentence == "testFixtures")) {
                    wrong += "${m.name}/src/$sentence: $rel (package $pkg, Stamm ${should ?: "fehlt"})"
                }
            }
        }
        assertTrue("Only $n Kotlin files found — search outdated?", n >= 500)
        return wrong
    }

    @Test
    fun `no area depends on another area or on the app, none names foreign route types`() {
        val areas = module().filterKeys { it.startsWith("feature-") }
        assertTrue("Only ${areas.size} area modules", areas.size >= 5)
        for ((name, build) in areas) {
            // Without exception: what several areas show lives in core-ui-inventory.
            val wrong = ModuleEdges.violations(edges(name, build))
            assertTrue(wrong.joinToString("\n"), wrong.isEmpty())
            assertTrue("$name knows no core modules — pattern outdated?", mainDependencies(build).any { it.startsWith("core-") })
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
            assertTrue("$name names no route — pattern outdated?", named.isNotEmpty())
            assertTrue("$name names foreign route types: ${named - own}", (named - own).isEmpty())
        }
    }

    @Test
    fun `layering of the core modules`() {
        val cores = module().filterKeys { it.startsWith("core-") }
        assertEquals("every core module has a rule", ModuleEdges.cores.keys, cores.keys)
        val all = module().flatMap { (name, build) -> edges(name, build) }
        assertTrue("Only ${all.size} module edges — pattern outdated?", all.size >= 60)
        val violations = ModuleEdges.violations(all)
        assertTrue(violations.joinToString("\n"), violations.isEmpty())
        val plugin = Regex("""alias\(libs\.plugins\.([\w.]+)\)""")
        val ui = module().mapNotNull { (name, build) -> ModuleEdges.uiViolation(name, plugin.findAll(build).map { it.groupValues[1] }.toList()) }
        assertTrue(ui.joinToString("\n"), ui.isEmpty())
        val viewModel = Regex("""\bclass\s+(\w+)[^{]*?:\s*ViewModel\(\)""")
        val stateVms = File(project, "core-state/src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }
            .flatMap { f -> viewModel.findAll(Sources.withoutComments(f.readText())).map { it.groupValues[1] } }.toList()
        assertTrue("No ViewModels found in core-state — pattern outdated?", stateVms.size >= 3)
        val vmWrong = ModuleEdges.stateViewModelViolations(stateVms)
        assertTrue(vmWrong.joinToString("\n"), vmWrong.isEmpty())
        // core-network is the lower network layer: store, repositories and Hilt stay in core-data.
        val network = cores.getValue("core-network")
        val libraries = Regex("""\(libs\.([\w.]+)\)""").findAll(network).map { it.groupValues[1] }.toList()
        val store = listOf("androidx.room", "sqlcipher", "hilt", "androidx.hilt", "androidx.datastore", "androidx.work", "retrofit")
        assertTrue("core-network depends on storage or DI: $libraries", libraries.none { b -> store.any { b.startsWith(it) } })
        val imports = File(project, "core-network/src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }.flatMap { f ->
            Regex("""^import\s+([\w.]+)""", RegexOption.MULTILINE).findAll(f.readText()).map { "${f.name}: ${it.groupValues[1]}" }
        }.toList()
        assertTrue("Only ${imports.size} imports in core-network — path outdated?", imports.size > 20)
        // An intent is UI (core-ui), not a network rule.
        val foreign = imports.filter { Regex(""": (androidx\.room|dagger|javax\.inject|retrofit2|android\.content|ch\.brickinventoryapp\.data\.(repository|local|cache))\b""").containsMatchIn(it) }
        assertTrue("core-network imports storage, repositories, DI or Android UI: $foreign", foreign.isEmpty())
        checkUiWithoutDomainKnowledge()
        checkDataAreas()
    }

    /**
     * core-data is cut by area (catalog, collection, parts, finances, account): each shows
     * its repositories as interfaces, the implementations are internal and only Hilt binds them.
     * The shared kernel (repository: Outcome, fetch helpers) knows no area.
     */
    private fun checkDataAreas() {
        val root = File(project, "core-data/src/main/java/ch/brickinventoryapp/data")
        val areas = listOf("catalog", "collection", "parts", "finances", "account")
        val importRow = Regex("""^import ch\.brickinventoryapp\.data\.(\w+)\.(\w+)""", RegexOption.MULTILINE)
        val findings = mutableListOf<String>()
        for (f in root.walkTopDown().filter { it.isFile && it.extension == "kt" }) {
            val text = Sources.withoutComments(f.readText())
            val area = f.parentFile?.name.orEmpty()
            Regex("""^(\w+\s+)*class\s+(\w+Impl)\b""", RegexOption.MULTILINE).findAll(text)
                .filter { "internal" !in it.value && "private" !in it.value }.forEach { findings += "${f.name}: ${it.groupValues[2]} is public" }
            for (m in importRow.findAll(text)) {
                val (from, name) = m.destructured
                if (area == "repository" && from in areas) findings += "${f.name}: der Kern kennt den Bereich $from"
                if (area in areas && from in areas && from != area && name.endsWith("Impl")) findings += "${f.name}: kennt $from.$name"
            }
        }
        val interfaces = areas.associateWith { a ->
            File(root, a).listFiles().orEmpty().count { Regex("""^interface\s+\w+Repository\b""", RegexOption.MULTILINE).containsMatchIn(it.readText()) }
        }
        assertTrue("areas without a public repository interface: $interfaces", interfaces.values.all { it > 0 })
        assertTrue("Schichtung in core-data:\n  " + findings.joinToString("\n  "), findings.isEmpty())
    }

    /**
     * core-ui is the design system: theme and building blocks without domain knowledge. Whoever needs a domain type
     * (model.domain) or a server model (model.data) is a domain building block
     * and belongs in the area or in core-ui-inventory; it only formats amounts and currency.
     */
    private fun checkUiWithoutDomainKnowledge() {
        val root = File(project, "core-ui/src/main/java")
        val files = root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        assertTrue("Only ${files.size} files in core-ui — path outdated?", files.size >= 40)
        val domain = Regex("""\bch\.brickinventoryapp\.model\.(data|domain\.(?!(CurrencyCode|Money)\b))""")
        val findings = files.filter { domain.containsMatchIn(Sources.withoutComments(it.readText())) }.map { it.relativeTo(root).path }
        assertTrue("core-ui kennt Fachmodelle: $findings", findings.isEmpty())
        // The camera building blocks are still called ui.screens; new screens or building blocks do not go there.
        val screens = File(root, "ch/brickinventoryapp/ui/screens").listFiles().orEmpty().map { it.name }.sorted()
        assertEquals("core-ui/ui/screens contains only the camera building blocks", listOf("CameraPermission.kt", "CameraSetup.kt"), screens)
    }

    /**
     * The rule itself, on edges that do not exist in the tree.
     *
     * Counter-checks (measured with kotlinc):
     *   counter-checks/edge-rule-without-test-exception.patch: test configurations count → red here
     *   the api line deleted → red here, „Modulkanten per api …“ missing
     *   core-ui entered in cores["core-state"] → red here
     *   counter-checks/deep-internals-open.patch: the rule for depthCores deleted → red here
 *   counter-checks/wire-format-for-all.patch: the rule for wireMarker deleted → red here
     *
     *   in uiViolation `module in withoutUi &&` deleted → red here (core-navigation)
     *   counter-checks/state-may-use-ui.patch: core-state missing in withoutUi → red here
 *   the line `k.onlyTest && reverseTest(k)` in ModuleEdges.violations deleted → red here
 *      (core-data tests with core-state … missing)
     */
    @Test
    fun `the edge rule forbids area to area, wrong layering, api and core-testing in main code`() {
        fun check(of: String, configuration: String, after: String) = ModuleEdges.violations(listOf(ModuleEdge(of, configuration, after)))
        assertEquals(listOf("feature-parts depends on feature-catalog"), check("feature-parts", "implementation", "feature-catalog"))
        assertEquals(listOf("feature-parts depends on app"), check("feature-parts", "implementation", "app"))
        assertEquals(listOf("layering of the core modules: core-state depends on core-ui"), check("core-state", "implementation", "core-ui"))
        assertEquals(listOf("module edges via api only to core-model: core-data → core-network"), check("core-data", "api", "core-network"))
        assertEquals(listOf("module edges via api only to core-model: core-data → core-contract"), check("core-data", "api", "core-contract"))
        assertEquals(listOf("feature-parts knows the wire format: only core-data maps it"),
            check("feature-parts", "implementation", "core-contract"))
        assertEquals(listOf("app knows the wire format: only core-data maps it"), check("app", "implementation", "core-contract"))
        assertEquals(emptyList<String>(), check("feature-parts", "testImplementation", "core-contract"))
        assertEquals(emptyList<String>(), check("core-data", "implementation", "core-contract"))
        assertEquals(listOf("core-offline knows the wire format: only core-data maps it"), check("core-offline", "implementation", "core-contract"))
        assertEquals(listOf("feature-account includes core-testing not only for tests"), check("feature-account", "implementation", "core-testing"))
        assertEquals(listOf("feature-account depends on core-security, which lies below the state"),
            check("feature-account", "implementation", "core-security"))
        assertEquals(listOf("feature-parts depends on core-network, which lies below the state"), check("feature-parts", "implementation", "core-network"))
        assertTrue(check("core-neu", "implementation", "core-model").single().endsWith("(core-neu has no rule in ModuleEdges.cores)"))
        // Allowed: tests see more, the app sees everything except the test helpers, the layering downwards.
        assertEquals(emptyList<String>(), check("feature-parts", "testImplementation", "core-testing"))
        assertEquals(emptyList<String>(), check("feature-login", "implementation", "core-security"))
        assertEquals(emptyList<String>(), check("feature-account", "testImplementation", "core-security"))
        assertEquals(emptyList<String>(), check("core-state", "testImplementation", "core-data"))
        assertEquals(emptyList<String>(), check("core-offline", "testImplementation", "core-contract"))
        // A test that needs the layer above belongs there; fixtures of one module only see what lies below.
        assertEquals(listOf("core-data tests with core-state, which builds on core-data: the test belongs in core-state"),
            check("core-data", "testImplementation", "core-state"))
        assertEquals(listOf("core-model tests with core-contract, which builds on core-model: the test belongs in core-contract"),
            check("core-model", "testImplementation", "core-contract"))
        assertEquals(listOf("core-ui tests with feature-parts, which builds on core-ui: the test belongs in feature-parts"),
            check("core-ui", "testFixturesImplementation", "feature-parts"))
        assertEquals(emptyList<String>(), check("core-state", "testImplementation", "core-ui"))
        assertEquals(emptyList<String>(), check("app", "implementation", "feature-parts"))
        assertEquals(emptyList<String>(), check("core-data", "api", "core-model"))
        assertEquals(emptyList<String>(), check("core-state", "implementation", "core-data"))
        assertEquals("core-state lies below the UI and switches on Compose: [brickinventory.android.compose]",
            ModuleEdges.uiViolation("core-state", listOf("brickinventory.android.library", "brickinventory.android.compose")))
        assertEquals(null, ModuleEdges.uiViolation("core-navigation", listOf("brickinventory.android.compose")))
        assertEquals(listOf("WantedListViewModel lies in core-state without a reason in ModuleEdges.stateViewModels"),
            ModuleEdges.stateViewModelViolations(ModuleEdges.stateViewModels.keys + "WantedListViewModel"))
    }

    @Test
    fun `core-model stays without Android`() {
        val build = module().getValue("core-model")
        val plugins = Regex("""alias\(libs\.plugins\.([\w.]+)\)""").findAll(build).map { it.groupValues[1] }.toSet()
        assertTrue("core-model is not a pure Kotlin module: $plugins", "brickinventory.jvm.library" in plugins)
        // The JVM convention itself applies kotlin.jvm and no Android plugin.
        val convention = File(project, "build-logic/convention/src/main/kotlin/ch/brickinventoryapp/buildlogic/Conventions.kt")
            .readText().substringAfter("class JvmLibraryConvention").substringBefore("\n}\n")
        assertTrue("the JVM convention applies kotlin.jvm", "pluginFromCatalog(\"kotlin.jvm\")" in convention)
        assertTrue("the JVM convention stays without Android", "android" !in convention.lowercase())
        val android = plugins.filter { it in setOf("android.application", "android.library", "kotlin.compose", "hilt", "ksp") }
        assertTrue("core-model stays without Android: $android", android.isEmpty())
        val libraries = Regex("""\(libs\.([\w.]+)\)""").findAll(build).map { it.groupValues[1] }.toList()
        assertTrue("core-model stays without Android: $libraries",
            libraries.none { it.startsWith("androidx") || it.startsWith("hilt") || it.startsWith("robolectric") })
        assertTrue("core-model depends on other modules: ${mainDependencies(build)}", mainDependencies(build).isEmpty())
    }

    @Test
    fun `the app includes every area`() {
        val app = mainDependencies(module().getValue("app"))
        val areas = module().keys.filter { it.startsWith("feature-") }.toSet()
        assertEquals("an area without the app would be dead code", areas, app.filter { it.startsWith("feature-") }.toSet())
    }

    /** Plugins like dependencies: google() only for Google's groups, otherwise mavenCentral. */
    @Test
    fun `google() only supplies Google's groups`() {
        // build-logic resolves AGP and Kotlin for the conventions itself.
        for (file in listOf("settings.gradle.kts", "build-logic/settings.gradle.kts")) {
            val settings = File(project, file).readText().lines()
                .filterNot { it.trim().startsWith("//") }.joinToString("\n")
            val google = Regex("""\bgoogle \{[^\n]*""").findAll(settings).map { it.value }.toList()
            assertEquals("$file, pluginManagement and dependencyResolutionManagement: $google", 2, google.size)
            for (z in google) assertTrue("without a content filter in $file: $z", z.startsWith("google { content {") &&
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
        assertTrue("Only ${sources.size} files under build-logic — search outdated?", sources.size >= 4)
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
        assertEquals("a bitmap parcel is unpacked", emptyList<String>(),
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
        assertTrue("verification-metadata.xml without keys — path outdated?", meta.contains("<trusted-key "))
        val regex = meta.lines().filter { "regex=\"true\"" in it }.map { it.trim() }
        assertEquals("group regex in the trust: $regex", emptyList<String>(), regex)
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
            assertTrue("line ${i + 1} does not have the form group:name:version CVE until:date: $z", m != null)
            val (group, name, version) = m!!.destructured
            val until = m.groupValues[5]
            n++
            assertTrue("without a reason above: $z", i > 0 && rows[i - 1].startsWith("# ") && rows[i - 1].length > 20)
            assertTrue("expired: $z", LocalDate.parse(until) >= LocalDate.now())
            assertTrue("$group:$name:$version is no longer in verification-metadata.xml — delete the line",
                meta.contains("<component group=\"$group\" name=\"$name\" version=\"$version\">"))
        }
        assertTrue("Only $n entries — format outdated?", n >= 1)
    }
}
