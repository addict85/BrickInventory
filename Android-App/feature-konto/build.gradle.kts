// Einstellungen: Konto, Haushalt, Lagerorte, CSV, Alarme und Aktualisierung.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.konto"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    implementation(project(":core-update"))
    implementation(project(":core-ui"))
    implementation(project(":core-ui-bestand"))
    implementation(project(":core-zustand"))
    implementation(project(":core-navigation"))
    implementation(project(":core-sitzung"))
    implementation(project(":core-ressourcen"))

    testImplementation(project(":core-testing"))
    // UpdateViewModelTest baut eine Vertrauensablage (PinAblage aus core-sicherheit).
    testImplementation(project(":core-sicherheit"))
}
