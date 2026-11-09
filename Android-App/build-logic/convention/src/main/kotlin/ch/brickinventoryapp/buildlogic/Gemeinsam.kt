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

/** Plugin-IDs kommen aus dem Katalog, damit sie nicht an zwei Stellen stehen. */
internal fun Project.pluginAusKatalog(alias: String) {
    pluginManager.apply(libs.findPlugin(alias).get().get().pluginId)
}

internal fun Project.bibliothek(konfiguration: String, alias: String) {
    dependencies.add(konfiguration, libs.findLibrary(alias).get())
}

/**
 * Guava kommt nur mittelbar in die App. Eine Einschränkung statt force: Sie hebt
 * eine ältere Fassung an, fügt Guava aber keinem Modul hinzu, das es nicht braucht.
 */
internal fun Project.guavaMindestens() {
    val fassung = libs.findVersion("guavaMindestens").get().requiredVersion
    dependencies.constraints.add("implementation", "com.google.guava:guava:$fassung")
}

/**
 * Ein Modul mit wenigen Abhängigkeiten griffe allein auf arch-core 2.0.0 und
 * tracing 1.1.0 zurück, die nicht im Prüfsummenverzeichnis stehen. Einschränkungen
 * wie bei Guava heben sie auf die Fassungen, die die App ohnehin nimmt.
 */
internal fun Project.androidxMindestens() {
    for (alias in listOf("androidx.arch.core.common", "androidx.arch.core.runtime", "androidx.tracing")) {
        val bib = libs.findLibrary(alias).get().get()
        dependencies.constraints.add("implementation", "${bib.module}:${bib.versionConstraint.requiredVersion}")
    }
}

internal fun Project.gruppe(konfiguration: String, alias: String) {
    dependencies.add(konfiguration, libs.findBundle(alias).get())
}

/** Was App und Bibliothek gleich einstellen, unabhängig von ihrer Erweiterung. */
internal class AndroidTeile(
    val compileOptions: CompileOptions,
    val testOptions: TestOptions,
    val buildFeatures: BuildFeatures,
)

/**
 * Läuft, sobald das Android-Plugin des Moduls angewendet ist. So hängen die
 * Konventionen nicht von der Reihenfolge im plugins-Block ab, und
 * `implementation` oder `ksp` gibt es, wenn sie Abhängigkeiten eintragen.
 */
internal fun Project.beiAndroid(aktion: (AndroidTeile) -> Unit) {
    pluginManager.withPlugin("com.android.application") {
        val android = extensions.getByType(ApplicationExtension::class.java)
        aktion(AndroidTeile(android.compileOptions, android.testOptions, android.buildFeatures))
    }
    pluginManager.withPlugin("com.android.library") {
        val android = extensions.getByType(LibraryExtension::class.java)
        aktion(AndroidTeile(android.compileOptions, android.testOptions, android.buildFeatures))
    }
}

/** Java und Kotlin auf 17, passend zum JDK der CI (android.yml). */
internal fun Project.java17(compileOptions: CompileOptions) {
    compileOptions.sourceCompatibility = JavaVersion.VERSION_17
    compileOptions.targetCompatibility = JavaVersion.VERSION_17
    tasks.withType(KotlinJvmCompile::class.java).configureEach {
        it.compilerOptions.jvmTarget.set(JvmTarget.JVM_17)
    }
}
