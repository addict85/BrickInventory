// Selbstaktualisierung aus dem GitHub-Release: Beschreibung prüfen, APK laden,
// Signatur vergleichen, installieren. Hängt an core-data (Update-Client, Ablage);
// core-data kennt dieses Modul nicht, darum binden die Hilt-Module hier.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.brickinventory.android.hilt)
}

android {
    namespace = "ch.brickinventoryapp.core.update"

    // InstallationsSitzungTest läuft unter Robolectric und liest die Texte des Empfängers.
    testOptions.unitTests.isIncludeAndroidResources = true
}

dependencies {
    implementation(project(":core-data"))
    // R.string und R.raw.beschreibungs_schluessel: Die R-Klassen sind nicht transitiv.
    implementation(project(":core-ressourcen"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.serialization.json)
    // Nur für den blanken Update-Client; kein Modul darüber sieht OkHttp.
    implementation(libs.okhttp)
    implementation(libs.kotlinx.coroutines.android)
    // UpdateAblage merkt sich den Stand im DataStore der App.
    implementation(libs.androidx.datastore)

    testImplementation(project(":core-testing"))
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
}
