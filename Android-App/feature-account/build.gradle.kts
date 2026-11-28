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
    implementation(project(":core-data"))
    implementation(project(":core-ui"))
    implementation(project(":core-ui-inventory"))
    implementation(project(":core-state"))
    implementation(project(":core-navigation"))
    implementation(project(":core-session"))
    implementation(project(":core-resources"))

    testImplementation(project(":core-testing"))
    testImplementation(testFixtures(project(":core-state")))
}
