// Finanzen, Gutscheine und der PDF-Betrachter.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.finances"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    // pdfInViewer.
    implementation(project(":core-network"))
    implementation(project(":core-ui"))
    implementation(project(":core-ui-inventory"))
    implementation(project(":core-state"))
    implementation(project(":core-navigation"))
    implementation(project(":core-session"))
    implementation(project(":core-resources"))

    testImplementation(project(":core-testing"))
    // Die Testserver antworten im Wire-Format.
    testImplementation(project(":core-contract"))
    // Die Testfabriken nennen die Ablagechiffre in ihren Signaturen.
    testImplementation(project(":core-security"))
}
