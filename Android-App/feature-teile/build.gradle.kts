// Teile und Minifiguren, eigene Einträge und Teilelisten.
// Hängt nur an core-*; was ein anderer Bereich braucht, liegt in core-ui-bestand,
// core-ui oder core-zustand, sonst kennten sich die Bereiche (ModulgrenzenTest).
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.teile"
    // Oberflächentests unter Robolectric lesen Texte und Schriften aus den Ressourcen.
    testOptions.unitTests.isIncludeAndroidResources = true
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    implementation(project(":core-ui"))
    implementation(project(":core-ui-bestand"))
    implementation(project(":core-zustand"))
    implementation(project(":core-sitzung"))
    implementation(project(":core-ressourcen"))

    testImplementation(project(":core-testing"))
    // Die Tests bauen Ablage und Bearbeitungen selbst.
    testImplementation(project(":core-offline"))
    // Die Erfassen-Dialoge werden unter Robolectric bedient, nicht nur gelesen.
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.androidx.ui.test.junit4)
    debugImplementation(libs.androidx.ui.test.manifest)
}
