// Design-System: Theme, Bausteine ohne Fachwissen (Karten, Zeilen, Suchfeld, Dialoge,
// Kamera) und reine Anzeigeregeln. Fachliche Bausteine liegen in core-ui-bestand.
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
    // GeheimeZwischenablageTest liest die Zwischenablage unter Robolectric.
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
}
