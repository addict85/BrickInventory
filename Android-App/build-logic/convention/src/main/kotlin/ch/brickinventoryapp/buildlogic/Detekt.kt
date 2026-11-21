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
 * Aufgabe `detekt`: prüft src/main und src/test des Moduls nach config/detekt/detekt.yml
 * und scheitert bei jedem Fund, der nicht in config/detekt/baseline.xml steht. Die
 * Baseline hält nur Länge und Verzweigung fest; tools/detekt-limit.txt lässt sie schrumpfen. Die Kommandozeile statt des Gradle-Plugins:
 * Sie braucht nur die Quellordner und bringt ihr eigenes Kotlin mit, das Plugin müsste
 * sich an die Quellsätze von AGP 9 mit eingebautem Kotlin hängen.
 */
class DetektKonvention : Plugin<Project> {
    override fun apply(target: Project) {
        val fassung = target.libs.findVersion("detekt").get().requiredVersion
        val tool = detektConfiguration(target, "detektWerkzeug")
        val ruleset = detektConfiguration(target, "detektRegeln")
        target.dependencies.add(tool.name, "io.gitlab.arturbosch.detekt:detekt-cli:$fassung")
        target.dependencies.add(ruleset.name, "io.gitlab.arturbosch.detekt:detekt-formatting:$fassung")

        val quellen = target.files(
            listOf("src/main/java", "src/main/kotlin", "src/test/java", "src/test/kotlin").map { target.file(it) },
        ).filter { it.isDirectory }
        val report = target.layout.buildDirectory.file("reports/detekt/detekt.txt")
        val detekt = target.tasks.register("detekt", JavaExec::class.java) { task ->
            task.group = "verification"
            task.description = "Prüft den Kotlin-Code mit detekt (Regeln: config/detekt/detekt.yml)."
            task.classpath = tool
            task.mainClass.set("io.gitlab.arturbosch.detekt.cli.Main")
            task.argumentProviders.add(
                DetektArguments(
                    quellen, target.rootDir.resolve("config/detekt/detekt.yml"),
                    target.rootDir.resolve("config/detekt/baseline.xml"), ruleset, report.map { it.asFile },
                ),
            )
            task.outputs.file(report)
            // Ohne Quellordner (core-resources) läse detekt sonst das ganze Modul samt build/.
            task.onlyIf("das Modul hat Kotlin-Quellen") { !quellen.isEmpty }
        }
        target.tasks.matching { it.name == "check" }.configureEach { it.dependsOn(detekt) }
    }

    /**
     * detekt 1.23 bringt seinen Übersetzer als Bibliothek mit und läuft nur mit der Kotlin-
     * Fassung, gegen die es gebaut ist; der Katalog nennt sie (detektKotlin), damit kein
     * anderes Kotlin im Bau sie anhebt.
     */
    private fun detektConfiguration(target: Project, name: String): Configuration {
        val kotlin = target.libs.findVersion("detektKotlin").get().requiredVersion
        return target.configurations.create(name) { configuration ->
            configuration.isCanBeConsumed = false
            configuration.resolutionStrategy.eachDependency { dependency ->
                if (dependency.requested.group == "org.jetbrains.kotlin") dependency.useVersion(kotlin)
            }
        }
    }
}

/** Die Aufrufzeile von detekt; die Felder sind zugleich die Eingaben der Aufgabe. */
internal class DetektArguments(
    @get:InputFiles @get:PathSensitive(PathSensitivity.RELATIVE) val quellen: FileCollection,
    @get:InputFile @get:PathSensitive(PathSensitivity.NONE) val rules: File,
    @get:InputFile @get:PathSensitive(PathSensitivity.NONE) val baseline: File,
    @get:Classpath val ruleset: FileCollection,
    @get:Internal val report: org.gradle.api.provider.Provider<File>,
) : CommandLineArgumentProvider {
    override fun asArguments(): Iterable<String> = listOf(
        "--input", quellen.files.joinToString(",") { it.absolutePath },
        "--config", rules.absolutePath,
        "--build-upon-default-config",
        "--baseline", baseline.absolutePath,
        "--plugins", ruleset.files.joinToString(",") { it.absolutePath },
        "--report", "txt:" + report.get().absolutePath,
    )
}
