package ch.brickinventoryapp.app

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Die Modulgrenzen, gelesen aus settings.gradle.kts und den build.gradle.kts:
 * app → feature-* → core-*, kein Bereich kennt einen anderen (ohne Ausnahme),
 * feste Schichtung der Kernmodule, core-model ohne Android, core-ui ohne Fachwissen.
 * Gradle bricht bei einem Zyklus ab, aber nicht bei einer Kante, die nur in die
 * falsche Richtung zeigt — die fängt dieser Test.
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
 *   I in settings.gradle.kts ein exclusiveContent
 *      gestrichen → rot „exclusiveContent je Block in settings.gradle.kts“
 *   J ein `regex="true"` zurück in
 *      verification-metadata.xml → rot „kein Schlüssel gilt für eine ganze Gruppe …“
 *   K in bauwerkzeug-luecken.txt die Fassung auf 3.15.0
 *      → rot „jede Lücke im Bauwerkzeug …“ (steht nicht in verification-metadata.xml)
 *   H ein `PdfRenderer(` in PdfSeite.kt →
 *      rot „PdfRenderer steht nur im isolierten Render-Dienst“; ebenso
 *      gegenproben/pdf-bitmap-aus-dem-renderer.patch (wieder `Bitmap.CREATOR.createFromParcel`)
 *   L  gegenproben/netz-haengt-an-ablage.patch: core-netz bindet Room ein →
 *      rot „core-netz hängt an Ablage oder DI“ (Schichtung der Kernmodule);
 *      erst die CI misst es, lokal gibt es kein Gradle
 *   M  gegenproben/merge-rest-im-baum.patch: eine Datei `Rest.kt.orig` im Baum →
 *      rot „kein Merge-Rest liegt im Baum“ (jeder Modulordner ist eingebunden …)
 *   N  gegenproben/dienste-haengt-an-update.patch: core-dienste bindet core-update ein →
 *      rot „Schichtung der Kernmodule: core-dienste hängt an [core-update]“ (core-data →
 *      core-update fängt schon Gradle als Zyklus)
 *   P  gegenproben/zustand-haengt-an-ui.patch: core-zustand bindet core-ui ein →
 *      rot „Schichtung der Kernmodule: core-zustand hängt an [core-ui]“
 *   Q  gegenproben/gemeinsam-haengt-an-daten.patch: core-ui-bestand bindet core-data ein →
 *      rot „Schichtung der Kernmodule: core-ui-bestand hängt an [core-data]“
 *   U  gegenproben/offline-haengt-an-daten.patch: core-offline bindet core-ui ein →
 *      rot „Schichtung der Kernmodule: core-offline hängt an [core-ui]“ (core-data
 *      ginge nicht: Den Zyklus bricht schon Gradle ab, ohne Testbericht)
 *   T  gegenproben/bereich-kennt-bereich.patch: feature-teile bindet feature-katalog ein →
 *      rot „feature-teile hängt an feature-katalog“
 *   R  gegenproben/ui-kennt-ansicht.patch: eine core-ui-Datei importiert eine Ansicht aus
 *      model.ui.model → rot „core-ui kennt Fachmodelle“ (Schichtung der Kernmodule)
 *   S  gegenproben/ui-neuer-bildschirm.patch: eine neue Datei in core-ui/ui/screens →
 *      rot „core-ui/ui/screens enthält nur die Kamera-Bausteine“ (Schichtung …)
 *   O  gegenproben/fremder-paketstamm.patch: feature-teile bekommt eine Datei im Paket
 *      ch.brickinventoryapp.sammlung → rot „außerhalb des Paketstamms ihres Moduls“
 *   V  gegenproben/daten-reicht-netz-weiter.patch: core-data bindet core-netz per api ein →
 *      rot „Modulkanten per api nur zu core-model: [core-data → core-netz]“ (Schichtung …)
 *   X  gegenproben/netz-oeffnet-intent.patch: ExterneAdresse.kt importiert android.content.Intent →
 *      rot „core-netz importiert Ablage, Repositories, DI oder Android-Oberfläche“ (Schichtung …)
 *   W  gegenproben/route-im-kern.patch: eine Route in core-model, die Verwaltung öffnet sie →
 *      rot „feature-verwaltung nennt fremde Routentypen: [Zentralziel]“ (kein Bereich hängt …);
 *      lokal mit kotlinc gegen den Baum gemessen, in der CI über Gradle
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
    fun `jeder Modulordner ist eingebunden, jedes eingebundene Modul gibt es, kein Merge-Rest liegt im Baum, und jede Kotlin-Datei liegt im Paketstamm ihres Moduls`() {
        // Eine .orig/.rej wird nie kompiliert, zählt aber für jede Suche über den Baum mit.
        val wurzel: File = checkNotNull(projekt.parentFile)
        val reste = wurzel.walkTopDown()
            .onEnter { it.name !in setOf(".git", ".claude", ".gradle", "build", "node_modules") }
            .filter { it.isFile && it.extension in setOf("orig", "rej") }.map { it.relativeTo(wurzel).path }.toList()
        assertTrue("Merge-Reste im Baum, löschen: $reste", reste.isEmpty())
        val eingebunden = Regex("""include\("(:[\w-]+)"\)""")
            .findAll(File(projekt, "settings.gradle.kts").readText()).map { it.groupValues[1].removePrefix(":") }.toSet()
        val ordner = module().keys
        assertTrue("Nur ${ordner.size} Module gefunden — Suche veraltet?", ordner.size >= 12)
        assertEquals("jeder Modulordner ist eingebunden", ordner, eingebunden)
        // Jedes Modul hat seinen eigenen Paketstamm (Tabelle in README.md): Ein Import
        // verrät so das Modul, und kein Paket verteilt sich auf zwei Module.
        val stamm = mapOf(
            "app" to "app", "core-model" to "model", "core-netz" to "netz", "core-data" to "data",
            "core-sicherheit" to "sicherheit", "core-offline" to "offline",
            "core-update" to "update", "core-dienste" to "dienste", "core-ui" to "ui", "core-zustand" to "zustand",
            "core-testing" to "testing", "feature-anmeldung" to "anmeldung", "feature-katalog" to "katalog",
            "feature-sammlung" to "sammlung", "feature-teile" to "teile", "feature-finanzen" to "finanzen",
            "feature-konto" to "konto", "feature-verwaltung" to "verwaltung", "core-ui-bestand" to "gemeinsam",
        )
        assertEquals("kein Stamm ist doppelt vergeben", stamm.size, stamm.values.toSet().size)
        val paketZeile = Regex("""^package\s+([\w.]+)""", RegexOption.MULTILINE)
        val falsch = mutableListOf<String>()
        var n = 0
        for (m in Quellen.module) for (satz in listOf("main", "test")) {
            val basis = File(m, "src/$satz/java")
            if (!basis.isDirectory) continue
            for (f in basis.walkTopDown().filter { it.isFile && it.extension == "kt" }) {
                n++
                val rel = f.relativeTo(basis).invariantSeparatorsPath
                val paket = paketZeile.find(f.readText())?.groupValues?.get(1)
                val soll = stamm[m.name]?.let { "ch.brickinventoryapp.$it" }
                val ordnerPaket = rel.substringBeforeLast('/').replace('/', '.')
                if (soll == null || paket != ordnerPaket || !(paket == soll || paket.startsWith("$soll."))) {
                    falsch += "${m.name}/src/$satz: $rel (package $paket, Stamm ${soll ?: "fehlt"})"
                }
            }
        }
        assertTrue("Nur $n Kotlin-Dateien gefunden — Suche veraltet?", n >= 500)
        assertTrue("Dateien außerhalb des Paketstamms ihres Moduls:\n  " + falsch.joinToString("\n  "), falsch.isEmpty())
    }

    @Test
    fun `kein Bereich hängt an einem anderen Bereich oder an der App, keiner nennt fremde Routentypen`() {
        val bereiche = module().filterKeys { it.startsWith("feature-") }
        assertTrue("Nur ${bereiche.size} Bereichsmodule", bereiche.size >= 5)
        for ((name, bau) in bereiche) {
            // Ohne Ausnahme: Was mehrere Bereiche zeigen, liegt in core-ui-bestand.
            val falsch = hauptAbhaengigkeiten(bau).filter { it.startsWith("feature-") || it == "app" }
            assertTrue("$name hängt an ${falsch.joinToString()}", falsch.isEmpty())
            assertTrue("$name kennt keine Kernmodule — Muster veraltet?", hauptAbhaengigkeiten(bau).any { it.startsWith("core-") })
        }
        // Routen: Ein Bereich registriert und öffnet nur eigene Ziele, fremde über die Rückrufe
        // seiner Navigationsschnittstelle. Eine Route in einem Kernmodul wäre wieder die zentrale Liste.
        val routenAufruf = Regex("""\b(?:composable|navigation|popUpTo|getBackStackEntry|toRoute|hasRoute)<([A-Z]\w*)|\bnavigate\(\s*([A-Z]\w*)""")
        val deklaration = Regex("""\b(?:class|interface|object)\s+(\w+)""")
        for (name in bereiche.keys) {
            val quellen = File(projekt, "$name/src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }
                .map { Quellen.ohneKommentare(it.readText()) }.toList()
            val eigene = quellen.flatMap { q -> deklaration.findAll(q).map { it.groupValues[1] } }.toSet()
            val genannt = quellen.flatMap { q -> routenAufruf.findAll(q).map { it.groupValues[1].ifEmpty { it.groupValues[2] } } }.toSet()
            assertTrue("$name nennt keine Route — Muster veraltet?", genannt.isNotEmpty())
            assertTrue("$name nennt fremde Routentypen: ${genannt - eigene}", (genannt - eigene).isEmpty())
        }
    }

    @Test
    fun `Schichtung der Kernmodule`() {
        val erlaubt = mapOf(
            "core-model" to emptySet(),
            "core-ressourcen" to emptySet(),
            "core-netz" to setOf("core-model"),
            // Aus core-data abgespalten, darunter: Tresor und TLS-Vertrauen, dann Room und Offlineablage.
            "core-sicherheit" to setOf("core-model", "core-netz"),
            "core-offline" to setOf("core-model", "core-sicherheit"),
            "core-data" to setOf("core-model", "core-ressourcen", "core-netz", "core-sicherheit", "core-offline"),
            // Aus core-data abgespalten: Sie hängen an core-data, nie umgekehrt und nie aneinander.
            "core-update" to setOf("core-ressourcen", "core-data"),
            "core-dienste" to setOf("core-ressourcen", "core-data"),
            "core-ui" to setOf("core-model", "core-ressourcen"),
            // Fachliche Bausteine, nur Darstellung: Mit Daten oder Zustand würde es zum Umweg,
            // auf dem sich Bereiche doch kennen.
            "core-ui-bestand" to setOf("core-model", "core-ressourcen", "core-ui"),
            // Der Zustand liegt unter der Oberfläche: Bildschirme lesen ihn, er kennt kein Compose-Bauteil.
            "core-zustand" to setOf("core-model", "core-ressourcen", "core-netz", "core-data", "core-sicherheit"),
            "core-testing" to setOf("core-zustand", "core-data", "core-sicherheit", "core-offline"),
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
        // api reicht ein Modul an jeden weiter, der dieses kennt; nur die Modelle sind gemeinsame Sprache.
        val weitergereicht = module().flatMap { (name, bau) ->
            abhaengigkeiten(bau).filter { it.konfiguration == "api" && it.ziel != "core-model" }.map { "$name → ${it.ziel}" }
        }
        assertTrue("Modulkanten per api nur zu core-model: $weitergereicht", weitergereicht.isEmpty())
        // core-netz ist die untere Netz-Schicht: Ablage, Repositories und Hilt bleiben in core-data.
        val netz = kerne.getValue("core-netz")
        val bibliotheken = Regex("""\(libs\.([\w.]+)\)""").findAll(netz).map { it.groupValues[1] }.toList()
        val ablage = listOf("androidx.room", "sqlcipher", "hilt", "androidx.hilt", "androidx.datastore", "androidx.work", "retrofit")
        assertTrue("core-netz hängt an Ablage oder DI: $bibliotheken", bibliotheken.none { b -> ablage.any { b.startsWith(it) } })
        val importe = File(projekt, "core-netz/src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }.flatMap { f ->
            Regex("""^import\s+([\w.]+)""", RegexOption.MULTILINE).findAll(f.readText()).map { "${f.name}: ${it.groupValues[1]}" }
        }.toList()
        assertTrue("Nur ${importe.size} Importe in core-netz — Pfad veraltet?", importe.size > 20)
        // Ein Intent ist Oberfläche (core-ui), keine Netzregel.
        val fremd = importe.filter { Regex(""": (androidx\.room|dagger|javax\.inject|retrofit2|android\.content|ch\.brickinventoryapp\.data\.(repository|lokal|cache))\b""").containsMatchIn(it) }
        assertTrue("core-netz importiert Ablage, Repositories, DI oder Android-Oberfläche: $fremd", fremd.isEmpty())
        pruefeUiOhneFachwissen()
    }

    /**
     * core-ui ist das Design-System: Theme und Bausteine ohne Fachwissen. Wer eine Ansicht
     * (model.ui.model) oder ein Servermodell (model.data) braucht, ist ein fachlicher Baustein
     * und gehört in den Bereich oder nach core-ui-bestand.
     */
    private fun pruefeUiOhneFachwissen() {
        val wurzel = File(projekt, "core-ui/src/main/java")
        val dateien = wurzel.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        assertTrue("Nur ${dateien.size} Dateien in core-ui — Pfad veraltet?", dateien.size >= 40)
        val fach = Regex("""\bch\.brickinventoryapp\.model\.(data|ui\.model)\b""")
        val funde = dateien.filter { fach.containsMatchIn(Quellen.ohneKommentare(it.readText())) }.map { it.relativeTo(wurzel).path }
        assertTrue("core-ui kennt Fachmodelle: $funde", funde.isEmpty())
        // Die Kamera-Bausteine heissen noch ui.screens; neue Bildschirme oder Bausteine kommen nicht dorthin.
        val screens = File(wurzel, "ch/brickinventoryapp/ui/screens").listFiles().orEmpty().map { it.name }.sorted()
        assertEquals("core-ui/ui/screens enthält nur die Kamera-Bausteine", listOf("KameraAufbau.kt", "KameraErlaubnis.kt"), screens)
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
            val google = Regex("""\bgoogle \{[^\n]*""").findAll(settings).map { it.value }.toList()
            assertEquals("$datei, pluginManagement und dependencyResolutionManagement: $google", 2, google.size)
            for (z in google) assertTrue("Ohne Inhaltsfilter in $datei: $z", z.startsWith("google { content {") &&
                listOf("com\\\\.android.*", "com\\\\.google.*", "androidx.*").all { z.contains("includeGroupByRegex(\"$it\")") })
            // Exklusiv: androidx, com.android und com.google.android nur von Google.
            val exklusiv = Regex("""exclusiveContent \{\s*forRepository \{ google\(\) }\s*filter \{([^\n]*)}""")
                .findAll(settings).map { it.groupValues[1] }.toList()
            assertEquals("exclusiveContent je Block in $datei", 2, exklusiv.size)
            for (f in exklusiv) assertTrue("Exklusive Gruppen in $datei: $f",
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
        val quellen = File(projekt, "build-logic").walkTopDown()
            .filter { it.isFile && (it.extension == "kt" || it.name.endsWith(".gradle.kts")) }.toList()
        assertTrue("Nur ${quellen.size} Dateien unter build-logic — Suche veraltet?", quellen.size >= 4)
        val kante = Regex("""\bproject\s*\(""")
        val mitKante = quellen.filter { kante.containsMatchIn(Quellen.ohneKommentare(it.readText())) }.map { it.name }
        assertTrue("Konventionen tragen keine Modulkanten ein: $mitKante", mitKante.isEmpty())
    }

    /**
     * pdfium parst Dateien von Dritten; nur der Dienst im isolierten Prozess darf es. Zurück
     * kommen nur Pixel in einen Speicher fester Grösse, nie ein Bitmap-Parcel zum Auspacken.
     */
    @Test
    fun `PdfRenderer steht nur im isolierten Render-Dienst`() {
        val aufruf = Regex("""\bPdfRenderer\s*\(""")
        val auspacken = Regex("""\bBitmap\.CREATOR\b""")
        val quellen = Quellen.module.flatMap { m ->
            File(m, "src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }
                .map { it.name to Quellen.ohneKommentare(it.readText()) }.toList()
        }
        assertEquals(listOf("PdfRenderDienst.kt"), quellen.filter { aufruf.containsMatchIn(it.second) }.map { it.first })
        assertEquals("Ein Bitmap-Parcel wird ausgepackt", emptyList<String>(),
            quellen.filter { auspacken.containsMatchIn(it.second) }.map { it.first })
    }

    /**
     * Ein Schlüssel mit Gruppen-Regex deckte jedes künftige Paket der Gruppe, ohne
     * Prüfsummeneintrag. Ein neuer Prüfsummenlauf schreibt wieder Regexe:
     * Dann hier rot, und im Pull-Request werden sie durch die Gruppen ersetzt.
     */
    @Test
    fun `kein Schluessel gilt fuer eine ganze Gruppe per Regex`() {
        val meta = File(projekt, "gradle/verification-metadata.xml").readText()
        assertTrue("verification-metadata.xml ohne Schlüssel — Pfad veraltet?", meta.contains("<trusted-key "))
        val regex = meta.lines().filter { "regex=\"true\"" in it }.map { it.trim() }
        assertEquals("Gruppen-Regex im Vertrauen: $regex", emptyList<String>(), regex)
    }

    /** Lücken im Bauwerkzeug sind begründet, befristet und betreffen eine Fassung, die es gibt. */
    @Test
    fun `jede Luecke im Bauwerkzeug ist begruendet, befristet und aktuell`() {
        val meta = File(projekt, "gradle/verification-metadata.xml").readText()
        val zeilen = File(projekt, "tools/bauwerkzeug-luecken.txt").readLines()
        val eintrag = Regex("""^([\w.-]+):([\w.-]+):([\w.-]+) (CVE-\d{4}-\d+) bis:(\d{4}-\d{2}-\d{2})$""")
        var n = 0
        zeilen.forEachIndexed { i, z ->
            if (z.isBlank() || z.startsWith("#")) return@forEachIndexed
            val m = eintrag.matchEntire(z.trim())
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
