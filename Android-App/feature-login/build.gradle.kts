// Sign in, set up a server and QR sign-in.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.login"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    // NetworkPolicy: checking the server address.
    implementation(project(":core-network"))
    implementation(project(":core-security"))
    implementation(project(":core-ui"))
    implementation(project(":core-state"))
    implementation(project(":core-session"))
    implementation(project(":core-resources"))
    implementation(libs.bundles.camera)
    implementation(libs.mlkit.barcode)
    // Passkeys via the Credential Manager (ui/CredentialManagerQuery.kt).
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services)

    testImplementation(project(":core-testing"))
    testImplementation(testFixtures(project(":core-state")))
}
