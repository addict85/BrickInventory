package ch.brickinventoryapp.buildlogic

import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.artifacts.Configuration
import org.gradle.api.file.FileCollection
import org.gradle.api.tasks.Classpath
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.Optional
import org.gradle.api.tasks.JavaExec
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.process.CommandLineArgumentProvider
import java.io.File

/**
 * Task `detekt`: checks src/main, src/test and src/testFixtures of the module against config/detekt/detekt.yml
 * and fails on every finding that is not in config/detekt/baseline.xml. The
 * baseline only records length and branching; tools/detekt-limit.txt lets it shrink. The command line instead of the Gradle plugin:
 * it only needs the source folders and brings its own Kotlin, the plugin would have to
 * hook into the source sets of AGP 9 with built-in Kotlin.
 */
class DetektConvention : Plugin<Project> {
    override fun apply(target: Project) {
        val version = target.libs.findVersion("detekt").get().requiredVersion
        val tool = detektConfiguration(target, "detektWerkzeug")
        val ruleset = detektConfiguration(target, "detektRegeln")
        target.dependencies.add(tool.name, "io.gitlab.arturbosch.detekt:detekt-cli:$version")
        target.dependencies.add(ruleset.name, "io.gitlab.arturbosch.detekt:detekt-formatting:$version")

        val sources = target.files(
            listOf("src/main/java", "src/main/kotlin", "src/test/java", "src/test/kotlin", "src/testFixtures/java").map { target.file(it) },
        ).filter { it.isDirectory }
        val report = target.layout.buildDirectory.file("reports/detekt/detekt.txt")
        val detekt = target.tasks.register("detekt", JavaExec::class.java) { task ->
            task.group = "verification"
            task.description = "Prüft den Kotlin-Code mit detekt (Regeln: config/detekt/detekt.yml)."
            task.classpath = tool
            task.mainClass.set("io.gitlab.arturbosch.detekt.cli.Main")
            task.argumentProviders.add(
                DetektArguments(
                    sources, target.rootDir.resolve("config/detekt/detekt.yml"),
                    target.rootDir.resolve("config/detekt/baseline.xml"), ruleset, report.map { it.asFile },
                    target.providers.gradleProperty("detektAutoCorrect").isPresent,
                    target.providers.gradleProperty("detektNewBaseline").map { File(it, target.name + ".xml").absolutePath }.orNull,
                ),
            )
            task.outputs.file(report)
            // Without source folders (core-resources) detekt would otherwise read the whole module including build/.
            task.onlyIf("das Modul hat Kotlin-Quellen") { !sources.isEmpty }
        }
        target.tasks.matching { it.name == "check" }.configureEach { it.dependsOn(detekt) }
    }

    /**
     * detekt 1.23 brings its compiler as a library and only runs with the Kotlin
     * version it is built against; the catalog names it (detektKotlin) so that no
     * other Kotlin in the build raises it.
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

/** The command line of detekt; the fields are at the same time the task's inputs. */
internal class DetektArguments(
    @get:InputFiles @get:PathSensitive(PathSensitivity.RELATIVE) val sources: FileCollection,
    @get:InputFile @get:PathSensitive(PathSensitivity.NONE) val rules: File,
    @get:InputFile @get:PathSensitive(PathSensitivity.NONE) val baseline: File,
    @get:Classpath val ruleset: FileCollection,
    @get:Internal val report: org.gradle.api.provider.Provider<File>,
    /** `-PdetektAutoCorrect`: let the formatting rules (import order) rewrite the files instead of only reporting. */
    @get:Input val autoCorrect: Boolean,
    /** `-PdetektNewBaseline=<dir>`: write this module's findings as a baseline there, to merge by hand. */
    @get:Input @get:Optional val newBaseline: String?,
) : CommandLineArgumentProvider {
    override fun asArguments(): Iterable<String> = listOf(
        "--input", sources.files.joinToString(",") { it.absolutePath },
        "--config", rules.absolutePath,
        "--build-upon-default-config",
        "--baseline", newBaseline ?: baseline.absolutePath,
        "--plugins", ruleset.files.joinToString(",") { it.absolutePath },
        "--report", "txt:" + report.get().absolutePath,
    ) + (if (autoCorrect) listOf("--auto-correct") else emptyList()) +
        (if (newBaseline != null) listOf("--create-baseline") else emptyList())
}
