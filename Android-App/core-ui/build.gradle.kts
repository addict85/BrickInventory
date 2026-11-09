// Theme, gemeinsame Composables (Karten, Zeilen, Filter, Kamera-Bausteine) und
// reine Anzeigeregeln. Kennt nur die Modelle, keine Daten- oder Zustandsschicht.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.brickinventory.android.compose)
}

android {
    namespace = "ch.brickinventoryapp.core.ui"
}

dependencies {
    api(project(":core-model"))
    implementation(project(":core-ressourcen"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.bundles.camera)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.biometric)

    testImplementation(project(":core-testing"))
}
