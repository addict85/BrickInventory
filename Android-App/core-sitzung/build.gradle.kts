// Die Sitzung der App: Server, Anmeldung, Einstellungen des Kontos und der Dienst,
// der ihnen über die Bildschirme hinweg folgt. Unter core-zustand: Zustand und
// Bereiche lesen die Sitzung, die Sitzung kennt weder Filter noch ViewModels.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.hilt)
}

android {
    namespace = "ch.brickinventoryapp.core.sitzung"
}

dependencies {
    api(project(":core-model"))
    implementation(project(":core-data"))
    // NetworkPolicy: Adresse einer gescheiterten Abmeldung, Klartext-Altbestand.
    implementation(project(":core-netz"))
    implementation(project(":core-ressourcen"))
    // Die Tests der Sitzung laufen in core-zustand: Sie bauen sie mit dem Blickfeld zusammen.
}
