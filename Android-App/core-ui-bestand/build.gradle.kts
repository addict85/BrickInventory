// Fachliche Bausteine, die mehrere Bereiche teilen: Filterblatt, Haushalt- und
// Lagerortwahl, eigene Einträge, Preisdiagramm und Wertkacheln. Ein Kernmodul, kein
// Bereich: nur Darstellung, kennt Modelle, Texte und core-ui, aber weder Daten- noch
// Zustandsschicht (ModulgrenzenTest), damit kein Bereich hierüber an einen anderen kommt.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.brickinventory.android.compose)
}

android {
    namespace = "ch.brickinventoryapp.core.uibestand"
    // Oberflächentests unter Robolectric lesen Texte und Schriften aus den Ressourcen.
    testOptions.unitTests.isIncludeAndroidResources = true
}

dependencies {
    api(project(":core-model"))
    implementation(project(":core-ui"))
    implementation(project(":core-ressourcen"))

    testImplementation(project(":core-testing"))
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.androidx.ui.test.junit4)
    debugImplementation(libs.androidx.ui.test.manifest)
}
