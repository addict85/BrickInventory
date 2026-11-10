// Hilfen für die Unit-Tests aller Module: Testserver, Testdienste und das
// Lesen von Quelltext. Nur als testImplementation eingebunden.
plugins {
    alias(libs.plugins.brickinventory.android.library)
}

android {
    namespace = "ch.brickinventoryapp.core.testing"
}

dependencies {
    // Nur implementation: Ein Test nennt die Module, deren Typen er selbst benutzt.
    implementation(project(":core-zustand"))
    implementation(project(":core-data"))
    implementation(project(":core-sicherheit"))
    // Testablage: Listen und Ausgang im Speicher.
    implementation(project(":core-offline"))
    api(libs.bundles.unit.tests)
    api(libs.retrofit)
    api(libs.retrofit.kotlinx.serialization)
}
