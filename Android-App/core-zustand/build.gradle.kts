// Was die Bereiche teilen, ohne einander zu kennen: Sitzung, Kontowerte, Blickfeld,
// Texte, die Grundlage der Bereichs-ViewModels und der
// AppViewModel. Was nur die App kennt (Widget), kommt als Schnittstelle herein.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.brickinventory.android.compose)
    alias(libs.plugins.brickinventory.android.hilt)
}

android {
    namespace = "ch.brickinventoryapp.core.zustand"
}

dependencies {
    api(project(":core-model"))
    // Innen: Die Bereiche nennen core-data selbst.
    implementation(project(":core-data"))
    implementation(project(":core-sicherheit"))
    // NetworkPolicy und die Regel, wer einen 401 meldet.
    implementation(project(":core-netz"))
    implementation(project(":core-ressourcen"))
    implementation(libs.androidx.core.ktx)
    api(libs.androidx.lifecycle.runtime.ktx)
    // Die ViewModels hier sind öffentliche Basis aller Bereiche; wer sie
    // erweitert oder im Test startet, braucht ViewModel und viewModelScope.
    api(libs.androidx.lifecycle.viewmodel)

    testImplementation(project(":core-testing"))
    // AusgangAbgleichTest baut Ablage und Ausgang im Speicher.
    testImplementation(project(":core-offline"))
}
