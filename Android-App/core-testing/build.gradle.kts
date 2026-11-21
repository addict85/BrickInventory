// Helpers for all modules' unit tests: test server, test services and
// reading source code. Pulled in only as testImplementation.
plugins {
    alias(libs.plugins.brickinventory.android.library)
}

android {
    namespace = "ch.brickinventoryapp.core.testing"
}

dependencies {
    // implementation only: a test names the modules whose types it itself uses.
    implementation(project(":core-state"))
    implementation(project(":core-session"))
    implementation(project(":core-data"))
    implementation(project(":core-security"))
    // Test store: lists and outbox in memory.
    implementation(project(":core-offline"))
    api(libs.bundles.unit.tests)
    api(libs.retrofit)
    api(libs.retrofit.kotlinx.serialization)
}
