package ch.brickinventoryapp.buildlogic

import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.artifacts.Configuration
import org.gradle.api.file.FileCollection
import org.gradle.api.tasks.Classpath
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.JavaExec
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.process.CommandLineArgumentProvider
import java.io.File

/**
 * Aufgabe `detekt`: prüft src/main und src/test des Moduls nach config/detekt/detekt.yml,
 * ohne Baseline, und scheitert bei jedem Fund. Die Kommandozeile statt des Gradle-Plugins:
 * Sie braucht nur die Quellordner und bringt ihr eigenes Kotlin mit, das Plugin müsste
 * sich an die Quellsätze von AGP 9 mit eingebautem Kotlin hängen.
 */
class DetektKonvention : Plugin<Project> {
    override fun apply(target: Project) {
        val fassung = target.libs.findVersion("detekt").get().requiredVersion
        val werkzeug = detektKonfiguration(target, "detektWerkzeug")
        val regelwerk = detektKonfiguration(target, "detektRegeln")
        target.dependencies.add(werkzeug.name, "io.gitlab.arturbosch.detekt:detekt-cli:$fassung")
        target.dependencies.add(regelwerk.name, "io.gitlab.arturbosch.detekt:detekt-formatting:$fassung")

        val quellen = target.files(
            listOf("src/main/java", "src/main/kotlin", "src/test/java", "src/test/kotlin").map { target.file(it) },
        ).filter { it.isDirectory }
        val bericht = target.layout.buildDirectory.file("reports/detekt/detekt.txt")
        val detekt = target.tasks.register("detekt", JavaExec::class.java) { aufgabe ->
            aufgabe.group = "verification"
            aufgabe.description = "Prüft den Kotlin-Code mit detekt (Regeln: config/detekt/detekt.yml)."
            aufgabe.classpath = werkzeug
            aufgabe.mainClass.set("io.gitlab.arturbosch.detekt.cli.Main")
            aufgabe.argumentProviders.add(
                DetektArgumente(quellen, target.rootDir.resolve("config/detekt/detekt.yml"), regelwerk, bericht.map { it.asFile }),
            )
            aufgabe.outputs.file(bericht)
            // Ohne Quellordner (core-ressourcen) läse detekt sonst das ganze Modul samt build/.
            aufgabe.onlyIf("das Modul hat Kotlin-Quellen") { !quellen.isEmpty }
        }
        target.tasks.matching { it.name == "check" }.configureEach { it.dependsOn(detekt) }
    }

    /**
     * detekt 1.23 bringt seinen Übersetzer als Bibliothek mit und läuft nur mit der Kotlin-
     * Fassung, gegen die es gebaut ist; der Katalog nennt sie (detektKotlin), damit kein
     * anderes Kotlin im Bau sie anhebt.
     */
    private fun detektKonfiguration(target: Project, name: String): Configuration {
        val kotlin = target.libs.findVersion("detektKotlin").get().requiredVersion
        return target.configurations.create(name) { konfiguration ->
            konfiguration.isCanBeConsumed = false
            konfiguration.resolutionStrategy.eachDependency { abhaengigkeit ->
                if (abhaengigkeit.requested.group == "org.jetbrains.kotlin") abhaengigkeit.useVersion(kotlin)
            }
        }
    }
}

/** Die Aufrufzeile von detekt; die Felder sind zugleich die Eingaben der Aufgabe. */
internal class DetektArgumente(
    @get:InputFiles @get:PathSensitive(PathSensitivity.RELATIVE) val quellen: FileCollection,
    @get:InputFile @get:PathSensitive(PathSensitivity.NONE) val regeln: File,
    @get:Classpath val regelwerk: FileCollection,
    @get:Internal val bericht: org.gradle.api.provider.Provider<File>,
) : CommandLineArgumentProvider {
    override fun asArguments(): Iterable<String> = listOf(
        "--input", quellen.files.joinToString(",") { it.absolutePath },
        "--config", regeln.absolutePath,
        "--build-upon-default-config",
        "--plugins", regelwerk.files.joinToString(",") { it.absolutePath },
        "--report", "txt:" + bericht.get().absolutePath,
    )
}
