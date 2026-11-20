// Die Sitzung der App: Server, Anmeldung, Einstellungen des Kontos und der Dienst,
// der ihnen über die Bildschirme hinweg folgt. Unter core-state: Zustand und
// Bereiche lesen die Sitzung, die Sitzung kennt weder Filter noch ViewModels.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.brickinventory.android.hilt)
}

android {
    namespace = "ch.brickinventoryapp.core.session"
}

dependencies {
    api(project(":core-model"))
    implementation(project(":core-data"))
    // NetworkPolicy: Adresse einer gescheiterten Abmeldung, Klartext-Altbestand.
    implementation(project(":core-network"))
    implementation(project(":core-resources"))
    // Eigene Flows (AbgeleiteterZustand); ohne Eintrag löst Gradle eine alte Fassung auf.
    implementation(libs.kotlinx.coroutines.android)
    // Der SitzungsDienst wird in core-state geprüft: Seine Tests bauen ihn mit dem Blickfeld zusammen.
}
