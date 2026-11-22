package ch.brickinventoryapp.buildlogic

import ch.brickinventoryapp.buildlogic.edges.ModuleEdge
import ch.brickinventoryapp.buildlogic.edges.ModuleEdges
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.Project
import org.gradle.api.artifacts.ProjectDependency
import org.gradle.api.provider.ListProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction

/**
 * Checks the module edges of a module against [ModuleEdges]. Gradle only aborts on a
 * cycle, not on an edge in the wrong direction; this task hangs on `check`
 * and runs in CI for all modules. The edges themselves are still added by the module script.
 */
abstract class ModuleEdgesCheck : DefaultTask() {
    @get:Input abstract val module: Property<String>

    /** Per edge „configuration target“, without a leading colon. */
    @get:Input abstract val edges: ListProperty<String>

    @TaskAction
    fun check() {
        val all = edges.get().map { val (configuration, after) = it.split(" "); ModuleEdge(module.get(), configuration, after) }
        val violations = ModuleEdges.violations(all)
        if (violations.isNotEmpty()) throw GradleException("Modulkanten verletzt:\n  " + violations.joinToString("\n  "))
    }
}

/** Registers `moduleEdgesCheck` and hangs it on `check`; it reads the edges only when the task graph is built. */
internal fun Project.moduleEdgesCheck() {
    val task = tasks.register("moduleEdgesCheck", ModuleEdgesCheck::class.java) { t ->
        t.group = "verification"
        t.description = "Prüft, ob das Modul nur von erlaubten Modulen abhängt (buildlogic/edges/ModuleEdges.kt)."
        t.module.set(name)
        t.edges.set(provider {
            configurations.flatMap { c ->
                c.dependencies.withType(ProjectDependency::class.java).map { "${c.name} ${it.path.removePrefix(":")}" }
            }.distinct()
        })
    }
    tasks.matching { it.name == "check" }.configureEach { it.dependsOn(task) }
}
