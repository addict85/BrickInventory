// Finances, vouchers and the PDF viewer.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.finances"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    // pdfInViewer.
    implementation(project(":core-network"))
    implementation(project(":core-ui"))
    implementation(project(":core-ui-inventory"))
    implementation(project(":core-state"))
    implementation(project(":core-navigation"))
    implementation(project(":core-session"))
    implementation(project(":core-resources"))

    testImplementation(project(":core-testing"))
    testImplementation(testFixtures(project(":core-state")))
    // The test servers answer in the wire format.
    testImplementation(project(":core-contract"))
    // The test factories name the store cipher in their signatures.
    testImplementation(project(":core-security"))
}
