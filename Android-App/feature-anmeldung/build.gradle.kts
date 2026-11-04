// Anmelden, Server einrichten und QR-Anmeldung.
// Hängt nur an core-*; was ein anderer Bereich braucht, liegt in core-ui oder
// core-zustand, sonst kennten sich die Bereiche (ModulgrenzenTest).
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.anmeldung"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    implementation(project(":core-ui"))
    implementation(project(":core-zustand"))
    implementation(project(":core-ressourcen"))
    implementation(libs.bundles.camera)
    implementation(libs.mlkit.barcode)
    // Passkeys über den Credential Manager (ui/CredentialManagerAbfrage.kt).
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services)

    testImplementation(project(":core-testing"))
}
