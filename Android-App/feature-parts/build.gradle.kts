// Parts and minifigures, manual entries and parts lists.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.parts"
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
    testImplementation(testFixtures(project(":core-state")))
    // The test servers answer in the wire format.
    testImplementation(project(":core-contract"))
    testImplementation(testFixtures(project(":core-contract")))
    // The tests build the store and edits themselves.
    testImplementation(project(":core-offline"))
}
