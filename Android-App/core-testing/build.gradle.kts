// Hilfen für die Unit-Tests aller Module: Testserver, Testdienste und das
// Lesen von Quelltext. Nur als testImplementation eingebunden.
plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "ch.brickinventoryapp.core.testing"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    api(project(":core-zustand"))
    api(libs.bundles.unit.tests)
    api(libs.retrofit)
    api(libs.retrofit.kotlinx.serialization)
}
