// The set catalog with a detail view.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.catalog"
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
    // The test servers answer in wire format.
    testImplementation(project(":core-contract"))
    testImplementation(testFixtures(project(":core-contract")))
}
