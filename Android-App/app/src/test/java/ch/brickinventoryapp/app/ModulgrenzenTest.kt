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
 * Die Modulgrenzen, gelesen aus settings.gradle.kts und den build.gradle.kts:
 * app → feature-* → core-*, kein Bereich kennt einen anderen (ohne Ausnahme),
 * feste Schichtung der Kernmodule, core-model ohne Android, core-ui ohne Fachwissen.
 * Die Kantenregel ist build-logic/…/kanten/Modulkanten.kt; dieselbe führt die Aufgabe
 * modulkantenPruefen in Gradle aus, hier läuft sie gegen die Modulskripte.
 *
 * Gegenproben:
 *   A  feature-collection: `implementation(project(":feature-parts"))` → rot
 *      „feature-collection hängt an feature-parts“
 *   B  core-model: jvm.library durch android.library ersetzt → rot „core-model
 *      ist kein reines Kotlin-Modul“
 *   C  core-data: `implementation(project(":core-ui"))` → rot „Schichtung
 *      der Kernmodule: core-data hängt an [core-ui]“
 *   D  include(":feature-management") aus settings.gradle.kts gestrichen → rot
 *      „jeder Modulordner ist eingebunden“
 *   E  in dependencyResolutionManagement wieder `google()` → rot
 *      „google() liefert nur Googles Gruppen“ (Ohne Inhaltsfilter)
 *   F  gegenproben/konvention-mit-modulkante.patch: die Bereichs-Konvention
 *      trägt core-ui ein → rot „Konventionen tragen keine Modulkanten ein“
 *   G  in build-logic/settings.gradle.kts `google()` ohne Filter →
 *      rot „Ohne Inhaltsfilter in build-logic/settings.gradle.kts“
 *   I in settings.gradle.kts ein exclusiveContent
 *      gestrichen → rot „exclusiveContent je Block in settings.gradle.kts“
 *   J ein `regex="true"` zurück in
 *      verification-metadata.xml → rot „kein Schlüssel gilt für eine ganze Gruppe …“
 *   K in bauwerkzeug-luecken.txt die Fassung auf 3.15.0
 *      → rot „jede Lücke im Bauwerkzeug …“ (steht nicht in verification-metadata.xml)
 *   H ein `PdfRenderer(` in PdfSeite.kt →
 *      rot „PdfRenderer steht nur im isolierten Render-Dienst“; ebenso
 *      gegenproben/pdf-bitmap-aus-dem-renderer.patch (wieder `Bitmap.CREATOR.createFromParcel`)
 *   L  gegenproben/netz-haengt-an-ablage.patch: core-network bindet Room ein →
 *      rot „core-network hängt an Ablage oder DI“ (Schichtung der Kernmodule);
 *      erst die CI misst es, lokal gibt es kein Gradle
 *   M  gegenproben/merge-rest-im-baum.patch: eine Datei `Rest.kt.orig` im Baum →
 *      rot „kein Merge-Rest liegt im Baum“ (jeder Modulordner ist eingebunden …)
 *   N  gegenproben/dienste-haengt-an-update.patch: core-services bindet core-update ein →
 *      rot „Schichtung der Kernmodule: core-services hängt an [core-update]“ (core-data →
 *      core-update fängt schon Gradle als Zyklus)
 *   P  gegenproben/zustand-haengt-an-ui.patch: core-state bindet core-ui ein →
 *      rot „Schichtung der Kernmodule: core-state hängt an [core-ui]“
 *   Q  gegenproben/gemeinsam-haengt-an-daten.patch: core-ui-inventory bindet core-data ein →
 *      rot „Schichtung der Kernmodule: core-ui-inventory hängt an [core-data]“
 *   U  gegenproben/offline-haengt-an-daten.patch: core-offline bindet core-ui ein →
 *      rot „Schichtung der Kernmodule: core-offline hängt an [core-ui]“ (core-data
 *      ginge nicht: Den Zyklus bricht schon Gradle ab, ohne Testbericht)
 *   W  gegenproben/ablage-kennt-wireformat.patch: core-offline bindet core-contract wieder ein →
 *      rot „core-offline kennt das Wire-Format“ (Schichtung der Kernmodule)
 *   T  gegenproben/bereich-kennt-bereich.patch: feature-parts bindet feature-catalog ein →
 *      rot „feature-parts hängt an feature-catalog“
 *   R  gegenproben/ui-kennt-ansicht.patch: eine core-ui-Datei importiert eine Ansicht aus
 *      model.fach → rot „core-ui kennt Fachmodelle“ (Schichtung der Kernmodule)
 *   S  gegenproben/ui-neuer-bildschirm.patch: eine neue Datei in core-ui/ui/screens →
 *      rot „core-ui/ui/screens enthält nur die Kamera-Bausteine“ (Schichtung …)
 *   O  gegenproben/fremder-paketstamm.patch: feature-parts bekommt eine Datei im Paket
 *      ch.brickinventoryapp.collection → rot „außerhalb des Paketstamms ihres Moduls“
 *   V  gegenproben/daten-reicht-netz-weiter.patch: core-data bindet core-network per api ein →
 *      rot „Modulkanten per api nur zu core-model: [core-data → core-network]“ (Schichtung …)
 *   X  gegenproben/netz-oeffnet-intent.patch: ExterneAdresse.kt importiert android.content.Intent →
 *      rot „core-network importiert Ablage, Repositories, DI oder Android-Oberfläche“ (Schichtung …)
 *   Y  gegenproben/sitzung-haengt-an-ui.patch: core-session bindet core-ui ein →
 *      rot „Schichtung der Kernmodule: core-session hängt an core-ui“
 *   Z  gegenproben/konto-haengt-an-tresor.patch: feature-account bindet core-security wieder ein →
 *      rot „feature-account hängt an core-security, das unter dem Zustand liegt“ (kein Bereich hängt …)
 *   AA core-state schaltet wieder brickinventory.android.compose ein → rot „core-state liegt unter
 *      der Oberfläche und schaltet Compose ein“ (Schichtung …; mit kotlinc gemessen, in Gradle bricht
 *      schon AndroidComposeKonvention ab); gegenproben/zustand-darf-oberflaeche.patch → rot „die Kantenregel …“
 *   AB gegenproben/bereichs-viewmodel-im-zustand.patch: ein ViewModel nur eines Bereichs in core-state
 *      → rot „… liegt in core-state ohne Grund in Modulkanten.zustandsViewModels“ (Schichtung …)
 *   W  gegenproben/route-im-kern.patch: eine Route in core-model, die Verwaltung öffnet sie →
 *      rot „feature-management nennt fremde Routentypen: [Zentralziel]“ (kein Bereich hängt …);
 *      lokal mit kotlinc gegen den Baum gemessen, in der CI über Gradle
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

    /** Was im ausgelieferten Code gilt; Testkonfigurationen zählen nicht. */
    private fun mainDependencies(bau: String): Set<String> =
        dependencies(bau).filter { !it.configuration.startsWith("test") }.map { it.ziel }.toSet()

    @Test
    fun `jeder Modulordner ist eingebunden, jedes eingebundene Modul gibt es, kein Merge-Rest liegt im Baum, und jede Kotlin-Datei liegt im Paketstamm ihres Moduls`() {
        // Eine .orig/.rej wird nie kompiliert, zählt aber für jede Suche über den Baum mit.
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
        // Jedes Modul hat seinen eigenen Paketstamm (Tabelle in README.md): Ein Import
        // verrät so das Modul, und kein Paket verteilt sich auf zwei Module.
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
    fun `kein Bereich hängt an einem anderen Bereich oder an der App, keiner nennt fremde Routentypen`() {
        val areas = module().filterKeys { it.startsWith("feature-") }
        assertTrue("Nur ${areas.size} Bereichsmodule", areas.size >= 5)
        for ((name, bau) in areas) {
            // Ohne Ausnahme: Was mehrere Bereiche zeigen, liegt in core-ui-inventory.
            val falsch = Modulkanten.violations(kanten(name, bau))
            assertTrue(falsch.joinToString("\n"), falsch.isEmpty())
            assertTrue("$name kennt keine Kernmodule — Muster veraltet?", mainDependencies(bau).any { it.startsWith("core-") })
        }
        // Routen: Ein Bereich registriert und öffnet nur eigene Ziele, fremde über die Rückrufe
        // seiner Navigationsschnittstelle. Eine Route in einem Kernmodul wäre wieder die zentrale Liste.
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
    fun `Schichtung der Kernmodule`() {
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
        // core-network ist die untere Netz-Schicht: Ablage, Repositories und Hilt bleiben in core-data.
        val netz = kerne.getValue("core-network")
        val libraries = Regex("""\(libs\.([\w.]+)\)""").findAll(netz).map { it.groupValues[1] }.toList()
        val ablage = listOf("androidx.room", "sqlcipher", "hilt", "androidx.hilt", "androidx.datastore", "androidx.work", "retrofit")
        assertTrue("core-network hängt an Ablage oder DI: $libraries", libraries.none { b -> ablage.any { b.startsWith(it) } })
        val importe = File(project, "core-network/src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }.flatMap { f ->
            Regex("""^import\s+([\w.]+)""", RegexOption.MULTILINE).findAll(f.readText()).map { "${f.name}: ${it.groupValues[1]}" }
        }.toList()
        assertTrue("Nur ${importe.size} Importe in core-network — Pfad veraltet?", importe.size > 20)
        // Ein Intent ist Oberfläche (core-ui), keine Netzregel.
        val fremd = importe.filter { Regex(""": (androidx\.room|dagger|javax\.inject|retrofit2|android\.content|ch\.brickinventoryapp\.data\.(repository|lokal|cache))\b""").containsMatchIn(it) }
        assertTrue("core-network importiert Ablage, Repositories, DI oder Android-Oberfläche: $fremd", fremd.isEmpty())
        checkUiWithoutDomainKnowledge()
    }

    /**
     * core-ui ist das Design-System: Theme und Bausteine ohne Fachwissen. Wer einen Fachtyp
     * (model.fach) oder ein Servermodell (model.data) braucht, ist ein fachlicher Baustein
     * und gehört in den Bereich oder nach core-ui-inventory; nur Beträge und Währung formatiert es.
     */
    private fun checkUiWithoutDomainKnowledge() {
        val root = File(project, "core-ui/src/main/java")
        val dateien = root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        assertTrue("Nur ${dateien.size} Dateien in core-ui — Pfad veraltet?", dateien.size >= 40)
        val fach = Regex("""\bch\.brickinventoryapp\.model\.(data|fach\.(?!(Waehrung|Geld)\b))""")
        val findings = dateien.filter { fach.containsMatchIn(Quellen.withoutComments(it.readText())) }.map { it.relativeTo(root).path }
        assertTrue("core-ui kennt Fachmodelle: $findings", findings.isEmpty())
        // Die Kamera-Bausteine heissen noch ui.screens; neue Bildschirme oder Bausteine kommen nicht dorthin.
        val screens = File(root, "ch/brickinventoryapp/ui/screens").listFiles().orEmpty().map { it.name }.sorted()
        assertEquals("core-ui/ui/screens enthält nur die Kamera-Bausteine", listOf("KameraAufbau.kt", "KameraErlaubnis.kt"), screens)
    }

    /**
     * Die Regel selbst, an Kanten, die es im Baum nicht gibt.
     *
     * Gegenproben (mit kotlinc gemessen):
     *   gegenproben/kantenregel-ohne-testausnahme.patch: Testkonfigurationen zählen mit → rot hier
     *   die api-Zeile gestrichen → rot hier, „Modulkanten per api …“ fehlt
     *   core-ui in kerne["core-state"] eingetragen → rot hier
     *   gegenproben/tiefe-kerne-offen.patch: die Regel zu depthCores gestrichen → rot hier
 *   gegenproben/wire-format-fuer-alle.patch: die Regel zu wireKenner gestrichen → rot hier
     *
     *   in uiViolation `modul in withoutUi &&` gestrichen → rot hier (core-navigation)
     *   gegenproben/zustand-darf-oberflaeche.patch: core-state fehlt in withoutUi → rot hier
     */
    @Test
    fun `die Kantenregel verbietet Bereich an Bereich, falsche Schichtung, api und core-testing im Hauptcode`() {
        fun pruefe(von: String, configuration: String, nach: String) = Modulkanten.violations(listOf(Modulkante(von, configuration, nach)))
        assertEquals(listOf("feature-parts hängt an feature-catalog"), pruefe("feature-parts", "implementation", "feature-catalog"))
        assertEquals(listOf("feature-parts hängt an app"), pruefe("feature-parts", "implementation", "app"))
        assertEquals(listOf("Schichtung der Kernmodule: core-state hängt an core-ui"), pruefe("core-state", "implementation", "core-ui"))
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
        // Erlaubt: Tests sehen mehr, die App sieht alles ausser den Testhilfen, die Schichtung nach unten.
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
    fun `core-model bleibt ohne Android`() {
        val bau = module().getValue("core-model")
        val plugins = Regex("""alias\(libs\.plugins\.([\w.]+)\)""").findAll(bau).map { it.groupValues[1] }.toSet()
        assertTrue("core-model ist kein reines Kotlin-Modul: $plugins", "brickinventory.jvm.library" in plugins)
        // Die JVM-Konvention selbst wendet kotlin.jvm an und kein Android-Plugin.
        val convention = File(project, "build-logic/convention/src/main/kotlin/ch/brickinventoryapp/buildlogic/Konventionen.kt")
            .readText().substringAfter("class JvmLibraryKonvention").substringBefore("\n}\n")
        assertTrue("die JVM-Konvention wendet kotlin.jvm an", "pluginAusKatalog(\"kotlin.jvm\")" in convention)
        assertTrue("die JVM-Konvention bleibt ohne Android", "android" !in convention.lowercase())
        val android = plugins.filter { it in setOf("android.application", "android.library", "kotlin.compose", "hilt", "ksp") }
        assertTrue("core-model bleibt ohne Android: $android", android.isEmpty())
        val libraries = Regex("""\(libs\.([\w.]+)\)""").findAll(bau).map { it.groupValues[1] }.toList()
        assertTrue("core-model bleibt ohne Android: $libraries",
            libraries.none { it.startsWith("androidx") || it.startsWith("hilt") || it.startsWith("robolectric") })
        assertTrue("core-model hängt an anderen Modulen: ${mainDependencies(bau)}", mainDependencies(bau).isEmpty())
    }

    @Test
    fun `die App bindet jeden Bereich ein`() {
        val app = mainDependencies(module().getValue("app"))
        val areas = module().keys.filter { it.startsWith("feature-") }.toSet()
        assertEquals("ein Bereich ohne die App wäre toter Code", areas, app.filter { it.startsWith("feature-") }.toSet())
    }

    /** Plugins wie Abhängigkeiten: google() nur für Googles Gruppen, sonst mavenCentral. */
    @Test
    fun `google() liefert nur Googles Gruppen`() {
        // build-logic löst AGP und Kotlin für die Konventionen selbst auf.
        for (datei in listOf("settings.gradle.kts", "build-logic/settings.gradle.kts")) {
            val settings = File(project, datei).readText().lines()
                .filterNot { it.trim().startsWith("//") }.joinToString("\n")
            val google = Regex("""\bgoogle \{[^\n]*""").findAll(settings).map { it.value }.toList()
            assertEquals("$datei, pluginManagement und dependencyResolutionManagement: $google", 2, google.size)
            for (z in google) assertTrue("Ohne Inhaltsfilter in $datei: $z", z.startsWith("google { content {") &&
                listOf("com\\\\.android.*", "com\\\\.google.*", "androidx.*").all { z.contains("includeGroupByRegex(\"$it\")") })
            // Exklusiv: androidx, com.android und com.google.android nur von Google.
            val exclusive = Regex("""exclusiveContent \{\s*forRepository \{ google\(\) }\s*filter \{([^\n]*)}""")
                .findAll(settings).map { it.groupValues[1] }.toList()
            assertEquals("exclusiveContent je Block in $datei", 2, exclusive.size)
            for (f in exclusive) assertTrue("Exklusive Gruppen in $datei: $f",
                listOf("androidx\\\\..*", "com\\\\.android(\\\\..*)?", "com\\\\.google\\\\.android\\\\..*").all { f.contains("includeGroupByRegex(\"$it\")") })
        }
    }

    /**
     * Die Kanten liest dieser Test aus den Modulskripten. Trüge eine Konvention
     * selbst eine ein, gälte sie für jedes Modul mit diesem Plugin und stünde
     * hier nirgends.
     */
    @Test
    fun `Konventionen tragen keine Modulkanten ein`() {
        val quellen = File(project, "build-logic").walkTopDown()
            .filter { it.isFile && (it.extension == "kt" || it.name.endsWith(".gradle.kts")) }.toList()
        assertTrue("Nur ${quellen.size} Dateien unter build-logic — Suche veraltet?", quellen.size >= 4)
        val edge = Regex("""\bproject\s*\(""")
        val withEdge = quellen.filter { edge.containsMatchIn(Quellen.withoutComments(it.readText())) }.map { it.name }
        assertTrue("Konventionen tragen keine Modulkanten ein: $withEdge", withEdge.isEmpty())
    }

    /**
     * pdfium parst Dateien von Dritten; nur der Dienst im isolierten Prozess darf es. Zurück
     * kommen nur Pixel in einen Speicher fester Grösse, nie ein Bitmap-Parcel zum Auspacken.
     */
    @Test
    fun `PdfRenderer steht nur im isolierten Render-Dienst`() {
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
     * Ein Schlüssel mit Gruppen-Regex deckte jedes künftige Paket der Gruppe, ohne
     * Prüfsummeneintrag. Ein neuer Prüfsummenlauf schreibt wieder Regexe:
     * Dann hier rot, und im Pull-Request werden sie durch die Gruppen ersetzt.
     */
    @Test
    fun `kein Schluessel gilt fuer eine ganze Gruppe per Regex`() {
        val meta = File(project, "gradle/verification-metadata.xml").readText()
        assertTrue("verification-metadata.xml ohne Schlüssel — Pfad veraltet?", meta.contains("<trusted-key "))
        val regex = meta.lines().filter { "regex=\"true\"" in it }.map { it.trim() }
        assertEquals("Gruppen-Regex im Vertrauen: $regex", emptyList<String>(), regex)
    }

    /** Lücken im Bauwerkzeug sind begründet, befristet und betreffen eine Fassung, die es gibt. */
    @Test
    fun `jede Luecke im Bauwerkzeug ist begruendet, befristet und aktuell`() {
        val meta = File(project, "gradle/verification-metadata.xml").readText()
        val zeilen = File(project, "tools/bauwerkzeug-luecken.txt").readLines()
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
