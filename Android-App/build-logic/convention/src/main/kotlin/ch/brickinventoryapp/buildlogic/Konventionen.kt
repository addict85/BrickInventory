package ch.brickinventoryapp.buildlogic

import com.android.build.api.dsl.ApplicationExtension
import com.android.build.api.dsl.LibraryExtension
import org.gradle.api.JavaVersion
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.plugins.JavaPluginExtension
import org.gradle.api.services.BuildService
import org.gradle.api.services.BuildServiceParameters
import org.gradle.api.tasks.testing.Test
import org.gradle.api.tasks.testing.logging.TestExceptionFormat
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile

// Die Konventionen setzen nur, was in mehreren Modulen gleich war. Modulkanten
// (`project(":…")`) bleiben im Skript des Moduls: Dort liest sie
// ModulgrenzenTest, und eine neue Kante steht im Diff des Moduls, nicht hier.

/** com.android.library mit den SDK-Ständen, Java/Kotlin 17 und detekt. */
class AndroidLibraryKonvention : Plugin<Project> {
    override fun apply(target: Project) {
        target.pluginAusKatalog("android.library")
        target.pluginManager.apply(DetektKonvention::class.java)
        val android = target.extensions.getByType(LibraryExtension::class.java)
        android.compileSdk = Sdk.compileSdk
        android.defaultConfig.minSdk = Sdk.minSdk
        target.java17(android.compileOptions)
        target.guavaMindestens()
    }
}

/** com.android.application mit denselben Ständen, targetSdk und detekt. */
class AndroidApplicationKonvention : Plugin<Project> {
    override fun apply(target: Project) {
        target.pluginAusKatalog("android.application")
        target.pluginManager.apply(DetektKonvention::class.java)
        val android = target.extensions.getByType(ApplicationExtension::class.java)
        android.compileSdk = Sdk.compileSdk
        android.defaultConfig.minSdk = Sdk.minSdk
        android.defaultConfig.targetSdk = Sdk.targetSdk
        target.java17(android.compileOptions)
        target.guavaMindestens()
    }
}

/**
 * JVM-Unit-Tests: android.util.Log & Co. laufen still ins Leere statt zu werfen,
 * damit ein Test an seiner Regel scheitert und nicht an einer Protokollzeile.
 * Der volle Stack steht im CI-Protokoll, weil der Testbericht nur als Artefakt
 * vorliegt. Wer Robolectric-Ressourcen braucht, schaltet sie im Modul ein.
 */
class AndroidUnittestKonvention : Plugin<Project> {
    override fun apply(target: Project) {
        target.beiAndroid { android ->
            val unitTests = android.testOptions.unitTests
            unitTests.isReturnDefaultValues = true
            unitTests.isIncludeAndroidResources = false
            unitTests.all { test ->
                testprotokoll(test)
                // Die Fototests der App allein dauern Minuten; zwei Forks auf dem Runner der CI.
                test.maxParallelForks = (Runtime.getRuntime().availableProcessors() / 2).coerceAtLeast(1)
            }
            target.gruppe("testImplementation", "unit.tests")
        }
    }
}

/** Reines Kotlin ohne Android (core-model): dieselben Fassungen, dasselbe Testprotokoll, detekt. */
class JvmLibraryKonvention : Plugin<Project> {
    override fun apply(target: Project) {
        target.pluginAusKatalog("kotlin.jvm")
        target.pluginManager.apply(DetektKonvention::class.java)
        val java = target.extensions.getByType(JavaPluginExtension::class.java)
        java.sourceCompatibility = JavaVersion.VERSION_17
        java.targetCompatibility = JavaVersion.VERSION_17
        target.tasks.withType(KotlinJvmCompile::class.java).configureEach {
            it.compilerOptions.jvmTarget.set(JvmTarget.JVM_17)
        }
        target.tasks.withType(Test::class.java).configureEach { testprotokoll(it) }
    }
}

/** Der volle Stack im CI-Protokoll: Der Testbericht liegt dort nur als Artefakt vor. */
internal fun testprotokoll(test: Test) {
    test.testLogging.exceptionFormat = TestExceptionFormat.FULL
    test.testLogging.showCauses = true
    test.testLogging.showStackTraces = true
}

/** Compose-Übersetzer, buildFeatures.compose und die Compose-Gruppe samt BOM. */
class AndroidComposeKonvention : Plugin<Project> {
    override fun apply(target: Project) {
        target.beiAndroid { android ->
            target.pluginAusKatalog("kotlin.compose")
            android.buildFeatures.compose = true
            val bom = target.libs.findLibrary("androidx.compose.bom").get()
            target.dependencies.add("implementation", target.dependencies.platform(bom))
            target.gruppe("implementation", "compose")
        }
    }
}

/** Hilt über KSP (kein kapt). */
class AndroidHiltKonvention : Plugin<Project> {
    override fun apply(target: Project) {
        target.beiAndroid {
            target.pluginAusKatalog("ksp")
            target.pluginAusKatalog("hilt")
            target.bibliothek("implementation", "hilt.android")
            target.bibliothek("ksp", "hilt.compiler")
            kspNacheinander(target)
        }
    }

    /**
     * KSP2 verliert bei parallelen Läufen in mehreren Modulen sporadisch Klassen eines
     * Vormoduls („… could not be resolved“). Ein gemeinsamer Dienst mit einem Platz
     * lässt nur die KSP-Aufgaben nacheinander laufen; Übersetzen und Tests bleiben parallel.
     */
    private fun kspNacheinander(target: Project) {
        val dienst = target.gradle.sharedServices.registerIfAbsent("kspNacheinander", KspNacheinander::class.java) {
            it.maxParallelUsages.set(1)
        }
        target.tasks.matching { it.name.startsWith("ksp") }.configureEach { it.usesService(dienst) }
    }
}

/** Platzhalter für den Dienst, der KSP-Aufgaben einzeln laufen lässt. */
abstract class KspNacheinander : BuildService<BuildServiceParameters.None>

/** Ein Bereich: Bibliothek mit Tests, Compose und Hilt. Namespace und Kanten setzt das Modul. */
class AndroidFeatureKonvention : Plugin<Project> {
    override fun apply(target: Project) {
        target.pluginManager.apply(AndroidLibraryKonvention::class.java)
        target.pluginManager.apply(AndroidComposeKonvention::class.java)
        target.pluginManager.apply(AndroidHiltKonvention::class.java)
        target.pluginManager.apply(AndroidUnittestKonvention::class.java)
        target.bibliothek("implementation", "androidx.core.ktx")
    }
}
