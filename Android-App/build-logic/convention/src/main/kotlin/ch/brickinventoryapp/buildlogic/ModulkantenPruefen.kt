package ch.brickinventoryapp.buildlogic

import ch.brickinventoryapp.buildlogic.kanten.Modulkante
import ch.brickinventoryapp.buildlogic.kanten.Modulkanten
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.Project
import org.gradle.api.artifacts.ProjectDependency
import org.gradle.api.provider.ListProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction

/**
 * Prüft die Modulkanten eines Moduls gegen [Modulkanten]. Gradle bricht nur bei einem
 * Zyklus ab, nicht bei einer Kante in die falsche Richtung; diese Aufgabe hängt an `check`
 * und läuft in der CI für alle Module. Die Kanten selbst trägt weiter das Modulskript ein.
 */
abstract class ModulkantenPruefen : DefaultTask() {
    @get:Input abstract val modul: Property<String>

    /** Je Kante „konfiguration ziel“, ohne führenden Doppelpunkt. */
    @get:Input abstract val kanten: ListProperty<String>

    @TaskAction
    fun pruefe() {
        val alle = kanten.get().map { val (konfiguration, nach) = it.split(" "); Modulkante(modul.get(), konfiguration, nach) }
        val verstoesse = Modulkanten.verstoesse(alle)
        if (verstoesse.isNotEmpty()) throw GradleException("Modulkanten verletzt:\n  " + verstoesse.joinToString("\n  "))
    }
}

/** Registriert `modulkantenPruefen` und hängt es an `check`; die Kanten liest es erst beim Bau des Aufgabengraphen. */
internal fun Project.modulkantenPruefen() {
    val aufgabe = tasks.register("modulkantenPruefen", ModulkantenPruefen::class.java) { t ->
        t.group = "verification"
        t.description = "Prüft, ob das Modul nur von erlaubten Modulen abhängt (buildlogic/kanten/Modulkanten.kt)."
        t.modul.set(name)
        t.kanten.set(provider {
            configurations.flatMap { c ->
                c.dependencies.withType(ProjectDependency::class.java).map { "${c.name} ${it.path.removePrefix(":")}" }
            }.distinct()
        })
    }
    tasks.matching { it.name == "check" }.configureEach { it.dependsOn(aufgabe) }
}
