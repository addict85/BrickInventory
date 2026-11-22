package ch.brickinventoryapp.buildlogic

import com.android.build.api.dsl.ApplicationExtension
import com.android.build.api.dsl.LibraryExtension
import ch.brickinventoryapp.buildlogic.edges.ModuleEdges
import org.gradle.api.GradleException
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

// The conventions only set what was the same in several modules. Module edges
// (`project(":…")`) are added by the module's script so that a new edge stands in its
// diff; whether it is allowed is checked by the task moduleEdgesCheck (edges/ModuleEdges.kt).

/** com.android.library with the SDK levels, Java/Kotlin 17 and detekt. */
class AndroidLibraryConvention : Plugin<Project> {
    override fun apply(target: Project) {
        target.pluginFromCatalog("android.library")
        target.pluginManager.apply(DetektConvention::class.java)
        target.moduleEdgesCheck()
        val android = target.extensions.getByType(LibraryExtension::class.java)
        android.compileSdk = Sdk.compileSdk
        android.defaultConfig.minSdk = Sdk.minSdk
        target.java17(android.compileOptions)
        target.guavaAtLeast()
        target.androidxAtLeast()
        target.lockClasspaths()
    }
}

/** com.android.application with the same levels, targetSdk and detekt. */
class AndroidApplicationConvention : Plugin<Project> {
    override fun apply(target: Project) {
        target.pluginFromCatalog("android.application")
        target.pluginManager.apply(DetektConvention::class.java)
        target.moduleEdgesCheck()
        val android = target.extensions.getByType(ApplicationExtension::class.java)
        android.compileSdk = Sdk.compileSdk
        android.defaultConfig.minSdk = Sdk.minSdk
        android.defaultConfig.targetSdk = Sdk.targetSdk
        target.java17(android.compileOptions)
        target.guavaAtLeast()
        target.androidxAtLeast()
        target.lockClasspaths()
    }
}

/**
 * JVM unit tests without isReturnDefaultValues: an Android method without Robolectric throws
 * instead of silently returning null or 0, with which a test would otherwise confirm something wrong. The full
 * stack stands in the CI log because the test report exists only as an artifact. Whoever
 * needs Robolectric resources switches them on in the module.
 */
class AndroidUnittestConvention : Plugin<Project> {
    override fun apply(target: Project) {
        target.atAndroid { android ->
            val unitTests = android.testOptions.unitTests
            unitTests.isIncludeAndroidResources = false
            unitTests.all { test ->
                testLog(test)
                // The app's photo tests alone take minutes; two forks on the CI runner.
                test.maxParallelForks = (Runtime.getRuntime().availableProcessors() / 2).coerceAtLeast(1)
            }
            target.group("testImplementation", "unit.tests")
        }
    }
}

/** Pure Kotlin without Android (core-model): the same versions, the same test log, detekt. */
class JvmLibraryConvention : Plugin<Project> {
    override fun apply(target: Project) {
        target.pluginFromCatalog("kotlin.jvm")
        target.pluginManager.apply(DetektConvention::class.java)
        target.moduleEdgesCheck()
        val java = target.extensions.getByType(JavaPluginExtension::class.java)
        java.sourceCompatibility = JavaVersion.VERSION_17
        java.targetCompatibility = JavaVersion.VERSION_17
        target.tasks.withType(KotlinJvmCompile::class.java).configureEach {
            it.compilerOptions.jvmTarget.set(JvmTarget.JVM_17)
        }
        target.tasks.withType(Test::class.java).configureEach { testLog(it) }
        target.lockClasspaths()
    }
}

/** The full stack in the CI log: the test report exists there only as an artifact. */
internal fun testLog(test: Test) {
    test.testLogging.exceptionFormat = TestExceptionFormat.FULL
    test.testLogging.showCauses = true
    test.testLogging.showStackTraces = true
}

/** Compose compiler, buildFeatures.compose and the Compose group including BOM. */
class AndroidComposeConvention : Plugin<Project> {
    override fun apply(target: Project) {
        ModuleEdges.uiViolation(target.name, listOf("brickinventory.android.compose"))?.let { throw GradleException(it) }
        target.atAndroid { android ->
            target.pluginFromCatalog("kotlin.compose")
            android.buildFeatures.compose = true
            val bom = target.libs.findLibrary("androidx.compose.bom").get()
            target.dependencies.add("implementation", target.dependencies.platform(bom))
            target.group("implementation", "compose")
        }
    }
}

/** Hilt via KSP (no kapt). */
class AndroidHiltConvention : Plugin<Project> {
    override fun apply(target: Project) {
        target.atAndroid {
            target.pluginFromCatalog("ksp")
            target.pluginFromCatalog("hilt")
            target.library("implementation", "hilt.android")
            target.library("ksp", "hilt.compiler")
            kspSequential(target)
        }
    }

    /**
     * KSP2 sporadically loses classes of a preceding module in parallel runs in several modules
     * („… could not be resolved“). A shared service with one slot
     * lets only the KSP tasks run one after another; compiling and tests stay parallel.
     */
    private fun kspSequential(target: Project) {
        val service = target.gradle.sharedServices.registerIfAbsent("kspSequential", KspSequential::class.java) {
            it.maxParallelUsages.set(1)
        }
        target.tasks.matching { it.name.startsWith("ksp") }.configureEach { it.usesService(service) }
    }
}

/** Placeholder for the service that lets KSP tasks run one at a time. */
abstract class KspSequential : BuildService<BuildServiceParameters.None>

/**
 * An area: library with tests, Compose and Hilt. Namespace and edges are set by the module.
 * Serialization and navigation, because every area holds its destinations as @Serializable routes
 * itself; the UI tests, because every area operates screens under Robolectric.
 */
class AndroidFeatureConvention : Plugin<Project> {
    override fun apply(target: Project) {
        target.pluginManager.apply(AndroidLibraryConvention::class.java)
        target.pluginFromCatalog("kotlin.serialization")
        target.pluginManager.apply(AndroidComposeConvention::class.java)
        target.pluginManager.apply(AndroidHiltConvention::class.java)
        target.pluginManager.apply(AndroidUnittestConvention::class.java)
        target.library("implementation", "androidx.core.ktx")
        target.library("implementation", "androidx.navigation.compose")
        target.atAndroid { android ->
            // Robolectric reads texts and fonts from the resources.
            android.testOptions.unitTests.isIncludeAndroidResources = true
            val bom = target.libs.findLibrary("androidx.compose.bom").get()
            target.dependencies.add("testImplementation", target.dependencies.platform(bom))
            for (alias in listOf("robolectric", "androidx.test.ext.junit", "androidx.ui.test.junit4"))
                target.library("testImplementation", alias)
            target.library("debugImplementation", "androidx.ui.test.manifest")
        }
    }
}
