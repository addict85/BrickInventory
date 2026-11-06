// Finanzen, Gutscheine und der PDF-Betrachter.
// Hängt nur an core-*; was ein anderer Bereich braucht, liegt in core-ui oder
// core-zustand, sonst kennten sich die Bereiche (ModulgrenzenTest).
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.finanzen"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    implementation(project(":core-ui"))
    implementation(project(":core-zustand"))
    implementation(project(":core-ressourcen"))

    testImplementation(project(":core-testing"))
}
