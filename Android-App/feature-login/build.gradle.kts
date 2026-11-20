// Anmelden, Server einrichten und QR-Anmeldung.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.login"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    // NetworkPolicy: die Serveradresse prüfen.
    implementation(project(":core-network"))
    implementation(project(":core-security"))
    implementation(project(":core-ui"))
    implementation(project(":core-state"))
    implementation(project(":core-session"))
    implementation(project(":core-resources"))
    implementation(libs.bundles.camera)
    implementation(libs.mlkit.barcode)
    // Passkeys über den Credential Manager (ui/CredentialManagerQuery.kt).
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services)

    testImplementation(project(":core-testing"))
}
