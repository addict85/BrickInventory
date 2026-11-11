// Die eigenen Sets: Galerie, Set-Detail, Merkliste, Käufe, Vergleich und Erfassen per Scanner.
// Hängt nur an core-*; was ein anderer Bereich braucht, liegt in core-ui-bestand,
// core-ui oder core-zustand, sonst kennten sich die Bereiche (ModulgrenzenTest).
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.sammlung"
    // Oberflächentests unter Robolectric lesen Texte und Schriften aus den Ressourcen.
    testOptions.unitTests.isIncludeAndroidResources = true
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    // oeffneExtern und eigeneAdresse.
    implementation(project(":core-netz"))
    implementation(project(":core-ui"))
    implementation(project(":core-ui-bestand"))
    implementation(project(":core-zustand"))
    implementation(project(":core-ressourcen"))
    implementation(libs.bundles.camera)
    implementation(libs.mlkit.barcode)
    implementation(libs.mlkit.textrec)

    testImplementation(project(":core-testing"))
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.androidx.ui.test.junit4)
    debugImplementation(libs.androidx.ui.test.manifest)
    // Die Tests bauen Ablage und Bearbeitungen selbst.
    testImplementation(project(":core-offline"))
}
