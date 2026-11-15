// Finanzen, Gutscheine und der PDF-Betrachter.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.finanzen"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    // pdfImBetrachter.
    implementation(project(":core-netz"))
    implementation(project(":core-ui"))
    implementation(project(":core-ui-bestand"))
    implementation(project(":core-zustand"))
    implementation(project(":core-navigation"))
    implementation(project(":core-sitzung"))
    implementation(project(":core-ressourcen"))

    testImplementation(project(":core-testing"))
    // Die Testfabriken nennen die Ablagechiffre in ihren Signaturen.
    testImplementation(project(":core-sicherheit"))
}
