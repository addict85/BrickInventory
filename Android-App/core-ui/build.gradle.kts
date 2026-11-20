// Design-System: Theme, Bausteine ohne Fachwissen (Karten, Zeilen, Suchfeld, Dialoge,
// Kamera) und reine Anzeigeregeln. Fachliche Bausteine liegen in core-ui-inventory.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.brickinventory.android.compose)
}

android {
    namespace = "ch.brickinventoryapp.core.ui"
    // Die Dialogtests lesen Texte aus den Ressourcen.
    testOptions.unitTests.isIncludeAndroidResources = true
}

dependencies {
    api(project(":core-model"))
    implementation(project(":core-resources"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.bundles.camera)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.biometric)

    testImplementation(project(":core-testing"))
    // Zwischenablage und Dialogfenster werden unter Robolectric geprüft.
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.androidx.ui.test.junit4)
    debugImplementation(libs.androidx.ui.test.manifest)
}
