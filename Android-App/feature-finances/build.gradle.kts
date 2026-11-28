// Finances, vouchers and the PDF viewer.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.finances"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-ui-state"))
    implementation(project(":core-data"))
    implementation(project(":core-ui"))
    implementation(project(":core-ui-inventory"))
    implementation(project(":core-state"))
    implementation(project(":core-navigation"))
    implementation(project(":core-session"))
    implementation(project(":core-resources"))

    testImplementation(project(":core-testing"))
    // The real address rules (NetworkAddressRules) instead of a double.
    testImplementation(project(":core-network"))
    testImplementation(testFixtures(project(":core-state")))
    // The test servers answer in the wire format.
    testImplementation(project(":core-contract"))
    testImplementation(testFixtures(project(":core-contract")))
    // The test factories name the store cipher in their signatures.
    testImplementation(project(":core-security"))
}
