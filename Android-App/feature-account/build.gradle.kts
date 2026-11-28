// Settings: account, household, storage locations, CSV and alerts.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.account"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-ui-state"))
    // Interfaces only: the implementation reaches the area through Hilt in the app.
    implementation(project(":core-data-api"))
    implementation(project(":core-ui"))
    implementation(project(":core-ui-inventory"))
    implementation(project(":core-state"))
    implementation(project(":core-navigation"))
    implementation(project(":core-session"))
    implementation(project(":core-resources"))

    testImplementation(project(":core-testing"))
    // The tests build the repositories themselves (core-data testFixtures).
    testImplementation(project(":core-data"))
    testImplementation(testFixtures(project(":core-state")))
}
