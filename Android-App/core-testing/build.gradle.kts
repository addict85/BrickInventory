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
    api(libs.bundles.unit.tests)
    api(libs.retrofit)
    api(libs.retrofit.kotlinx.serialization)
}
