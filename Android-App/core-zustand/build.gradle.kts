// Was die Bereiche teilen, ohne einander zu kennen: Sitzung, Blickfeld,
// Bestandssignal, Texte, die Grundlage der Bereichs-ViewModels und der
// AppViewModel. Was nur die App kennt (Widget), kommt als Schnittstelle herein.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.brickinventory.android.compose)
    alias(libs.plugins.brickinventory.android.hilt)
    // Die Navigationsziele (ui/Navigation.kt) sind @Serializable-Routen.
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "ch.brickinventoryapp.core.zustand"
}

dependencies {
    api(project(":core-model"))
    // Innen: Die Bereiche nennen core-data selbst.
    implementation(project(":core-data"))
    implementation(project(":core-sicherheit"))
    // CsvImportDienst: Der CSV-Import startet und beendet seinen Vordergrund-Dienst.
    implementation(project(":core-dienste"))
    implementation(project(":core-ressourcen"))
    implementation(libs.androidx.core.ktx)
    api(libs.androidx.lifecycle.runtime.ktx)
    // Die ViewModels hier sind öffentliche Basis aller Bereiche; wer sie
    // erweitert oder im Test startet, braucht ViewModel und viewModelScope.
    api(libs.androidx.lifecycle.viewmodel)

    testImplementation(project(":core-testing"))
}
