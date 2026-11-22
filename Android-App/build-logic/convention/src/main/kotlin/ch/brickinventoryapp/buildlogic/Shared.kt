package ch.brickinventoryapp.buildlogic

import com.android.build.api.dsl.ApplicationExtension
import com.android.build.api.dsl.BuildFeatures
import com.android.build.api.dsl.CompileOptions
import com.android.build.api.dsl.LibraryExtension
import com.android.build.api.dsl.TestOptions
import org.gradle.api.JavaVersion
import org.gradle.api.Project
import org.gradle.api.artifacts.VersionCatalog
import org.gradle.api.artifacts.VersionCatalogsExtension
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile

internal val Project.libs: VersionCatalog
    get() = extensions.getByType(VersionCatalogsExtension::class.java).named("libs")

/** Plugin IDs come from the catalog so that they do not stand in two places. */
internal fun Project.pluginFromCatalog(alias: String) {
    pluginManager.apply(libs.findPlugin(alias).get().get().pluginId)
}

internal fun Project.library(configuration: String, alias: String) {
    dependencies.add(configuration, libs.findLibrary(alias).get())
}

/**
 * Guava comes into the app only indirectly. A constraint instead of force: it raises
 * an older version but adds Guava to no module that does not need it.
 */
internal fun Project.guavaAtLeast() {
    val version = libs.findVersion("guavaAtLeast").get().requiredVersion
    dependencies.constraints.add("implementation", "com.google.guava:guava:$version")
}

/**
 * A module with few dependencies would on its own fall back to arch-core 2.0.0, tracing 1.1.0,
 * emoji2 1.2.0 or (via navigation-runtime) activity-ktx 1.7.1, which are not in the
 * checksum list and are unsigned. Constraints as for Guava raise
 * them to the versions the app takes anyway. Not activity itself: that would raise
 * modules with activity 1.5.1 and pull lifecycle 2.6.1 along.
 */
internal fun Project.androidxAtLeast() {
    for (alias in listOf("androidx.arch.core.common", "androidx.arch.core.runtime", "androidx.tracing",
        "androidx.emoji2", "androidx.emoji2.views.helper", "androidx.activity.ktx")) {
        val bib = libs.findLibrary(alias).get().get()
        dependencies.constraints.add("implementation", "${bib.module}:${bib.versionConstraint.requiredVersion}")
    }
}

/**
 * What a module compiles against and ships is pinned in its gradle.lockfile: a version
 * that changes behind the catalog (a transitive raise, a dynamic range) fails the build
 * instead of slipping in. Renew after a change: `./gradlew resolveLockedClasspaths --write-locks`.
 */
internal fun Project.lockClasspaths() {
    val locked = { name: String -> name.endsWith("CompileClasspath") || name.endsWith("RuntimeClasspath") }
    configurations.configureEach { c ->
        if (locked(c.name)) c.resolutionStrategy.activateDependencyLocking()
    }
    tasks.register("resolveLockedClasspaths") { task ->
        task.group = "verification"
        task.description = "Resolves every locked classpath; with --write-locks it writes gradle.lockfile."
        task.notCompatibleWithConfigurationCache("resolves configurations at execution time")
        task.doLast {
            project.configurations.filter { it.isCanBeResolved && locked(it.name) }
                .forEach { it.incoming.resolutionResult.allDependencies }
        }
    }
}

internal fun Project.group(configuration: String, alias: String) {
    dependencies.add(configuration, libs.findBundle(alias).get())
}

/** What app and library configure the same, independent of their extension. */
internal class AndroidParts(
    val compileOptions: CompileOptions,
    val testOptions: TestOptions,
    val buildFeatures: BuildFeatures,
)

/**
 * Runs as soon as the module's Android plugin is applied. That way the
 * conventions do not depend on the order in the plugins block, and
 * `implementation` or `ksp` exist when they add dependencies.
 */
internal fun Project.atAndroid(action: (AndroidParts) -> Unit) {
    pluginManager.withPlugin("com.android.application") {
        val android = extensions.getByType(ApplicationExtension::class.java)
        action(AndroidParts(android.compileOptions, android.testOptions, android.buildFeatures))
    }
    pluginManager.withPlugin("com.android.library") {
        val android = extensions.getByType(LibraryExtension::class.java)
        action(AndroidParts(android.compileOptions, android.testOptions, android.buildFeatures))
    }
}

/** Java and Kotlin at 17, matching CI's JDK (android.yml). */
internal fun Project.java17(compileOptions: CompileOptions) {
    compileOptions.sourceCompatibility = JavaVersion.VERSION_17
    compileOptions.targetCompatibility = JavaVersion.VERSION_17
    tasks.withType(KotlinJvmCompile::class.java).configureEach {
        it.compilerOptions.jvmTarget.set(JvmTarget.JVM_17)
    }
}
