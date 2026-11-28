// The set catalog with a detail view.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.catalog"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    // openExtern.
    implementation(project(":core-network"))
    implementation(project(":core-ui"))
    implementation(project(":core-ui-inventory"))
    implementation(project(":core-state"))
    implementation(project(":core-navigation"))
    implementation(project(":core-session"))
    implementation(project(":core-resources"))

    testImplementation(project(":core-testing"))
    testImplementation(testFixtures(project(":core-state")))
    // The test servers answer in wire format.
    testImplementation(project(":core-contract"))
    testImplementation(testFixtures(project(":core-contract")))
}
