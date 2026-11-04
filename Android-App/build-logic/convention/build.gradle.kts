import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// java-gradle-plugin mit dem Kotlin des Katalogs statt `kotlin-dsl`: kotlin-dsl
// brächte org.gradle.kotlin und einen zweiten Kotlin-Satz in der eingebetteten
// Fassung mit, die verification-metadata.xml nicht kennt. So löst dieser Bau
// nur auf, was die App ohnehin auflöst.
plugins {
    `java-gradle-plugin`
    alias(libs.plugins.kotlin.jvm)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

// Nur zum Übersetzen: Zur Laufzeit liefert die App AGP und Kotlin über die
// Plugins ihres Wurzelskripts, sonst lägen zwei Fassungen im Klassenpfad. Die
// Koordinaten stehen hier statt unter [libraries], weil Lint den Katalog prüft
// und die App-Module diese Artefakte nie benutzen; die Fassung bleibt die des Katalogs.
dependencies {
    compileOnly("com.android.tools.build:gradle-api:${libs.versions.agp.get()}")
    compileOnly("org.jetbrains.kotlin:kotlin-gradle-plugin:${libs.versions.kotlin.get()}")
}

gradlePlugin {
    plugins {
        register("androidApplication") {
            id = libs.plugins.brickinventory.android.application.get().pluginId
            implementationClass = "ch.brickinventoryapp.buildlogic.AndroidApplicationKonvention"
        }
        register("androidLibrary") {
            id = libs.plugins.brickinventory.android.library.get().pluginId
            implementationClass = "ch.brickinventoryapp.buildlogic.AndroidLibraryKonvention"
        }
        register("androidUnittests") {
            id = libs.plugins.brickinventory.android.unittests.get().pluginId
            implementationClass = "ch.brickinventoryapp.buildlogic.AndroidUnittestKonvention"
        }
        register("androidCompose") {
            id = libs.plugins.brickinventory.android.compose.get().pluginId
            implementationClass = "ch.brickinventoryapp.buildlogic.AndroidComposeKonvention"
        }
        register("androidHilt") {
            id = libs.plugins.brickinventory.android.hilt.get().pluginId
            implementationClass = "ch.brickinventoryapp.buildlogic.AndroidHiltKonvention"
        }
        register("androidFeature") {
            id = libs.plugins.brickinventory.android.feature.get().pluginId
            implementationClass = "ch.brickinventoryapp.buildlogic.AndroidFeatureKonvention"
        }
    }
}
