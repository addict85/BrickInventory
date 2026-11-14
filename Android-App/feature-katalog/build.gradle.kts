// Der Set-Katalog mit Detailansicht.
// Hängt nur an core-*; was ein anderer Bereich braucht, liegt in core-ui-bestand,
// core-ui oder core-zustand, sonst kennten sich die Bereiche (ModulgrenzenTest).
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.katalog"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    // oeffneExtern.
    implementation(project(":core-netz"))
    implementation(project(":core-ui"))
    implementation(project(":core-ui-bestand"))
    implementation(project(":core-zustand"))
    implementation(project(":core-navigation"))
    implementation(project(":core-sitzung"))
    implementation(project(":core-ressourcen"))

    testImplementation(project(":core-testing"))
}
