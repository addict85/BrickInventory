// Hilfen für die Unit-Tests aller Module: Testserver, Testdienste und das
// Lesen von Quelltext. Nur als testImplementation eingebunden.
plugins {
    alias(libs.plugins.brickinventory.android.library)
}

android {
    namespace = "ch.brickinventoryapp.core.testing"
}

dependencies {
    api(project(":core-zustand"))
    // Testserver und Testdienste zeigen Typen aus beiden nach aussen.
    api(project(":core-data"))
    api(project(":core-sicherheit"))
    api(project(":core-ui"))
    api(libs.bundles.unit.tests)
    api(libs.retrofit)
    api(libs.retrofit.kotlinx.serialization)
}
