// Einstellungen: Konto, Haushalt, Lagerorte, CSV, Alarme und Aktualisierung.
// Hängt nur an core-* und feature-gemeinsam; was ein anderer Bereich braucht, liegt
// dort, in core-ui oder core-zustand, sonst kennten sich die Bereiche (ModulgrenzenTest).
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.konto"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    implementation(project(":core-update"))
    implementation(project(":core-ui"))
    implementation(project(":feature-gemeinsam"))
    implementation(project(":core-zustand"))
    implementation(project(":core-ressourcen"))

    testImplementation(project(":core-testing"))
}
