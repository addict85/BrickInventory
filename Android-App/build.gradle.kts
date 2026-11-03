import org.gradle.api.services.BuildService
import org.gradle.api.services.BuildServiceParameters

// Top-level build file
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.android.lint) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.hilt) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.roborazzi) apply false
}

// KSP2 verliert bei parallelen Läufen in mehreren Modulen sporadisch Klassen eines
// Vormoduls („'BrickRepository' could not be resolved“), obwohl dessen Jar fertig ist.
// Ein gemeinsamer Dienst mit einem Platz lässt KSP-Aufgaben nacheinander laufen;
// Übersetzen und Tests bleiben parallel.
abstract class KspNacheinander : BuildService<BuildServiceParameters.None>

val kspNacheinander = gradle.sharedServices.registerIfAbsent("kspNacheinander", KspNacheinander::class) {
    maxParallelUsages.set(1)
}

subprojects {
    tasks.matching { it.name.startsWith("ksp") }.configureEach { usesService(kspNacheinander) }
}
