// Die eigenen Sets: Galerie, Set-Detail, Merkliste, Käufe, Vergleich und Erfassen per Scanner.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.sammlung"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    // oeffneExtern und eigeneAdresse.
    implementation(project(":core-netz"))
    implementation(project(":core-ui"))
    implementation(project(":core-ui-bestand"))
    implementation(project(":core-zustand"))
    implementation(project(":core-navigation"))
    implementation(project(":core-sitzung"))
    implementation(project(":core-ressourcen"))
    implementation(libs.bundles.camera)
    implementation(libs.mlkit.barcode)
    implementation(libs.mlkit.textrec)

    testImplementation(project(":core-testing"))
    // Die Tests bauen Ablage und Bearbeitungen selbst.
    testImplementation(project(":core-offline"))
}
