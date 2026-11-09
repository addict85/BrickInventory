// Fachliche Bausteine, die mehrere Bereiche teilen: Filterblatt, Haushalt- und
// Lagerortwahl, eigene Einträge, Preisdiagramm und Wertkacheln. Nur Darstellung:
// kennt Modelle, Texte und core-ui, aber weder Daten- noch Zustandsschicht
// (ModulgrenzenTest), damit kein Bereich über diesen Weg an einen anderen kommt.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.brickinventory.android.compose)
}

android {
    namespace = "ch.brickinventoryapp.feature.gemeinsam"
}

dependencies {
    api(project(":core-model"))
    implementation(project(":core-ui"))
    implementation(project(":core-ressourcen"))

    testImplementation(project(":core-testing"))
}
