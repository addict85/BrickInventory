// Sign in, set up a server and QR sign-in.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.login"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-ui-state"))
    // Interfaces only: the implementation reaches the area through Hilt in the app.
    implementation(project(":core-data-api"))
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
    // The tests build the repositories themselves (core-data testFixtures).
    testImplementation(project(":core-data"))
    // The real address rules (NetworkAddressRules) instead of a double.
    testImplementation(project(":core-network"))
    testImplementation(testFixtures(project(":core-state")))
}
