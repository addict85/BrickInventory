// Domain building blocks shared by several scopes: filter sheet, household and
// storage-location choice, own entries, price chart and value tiles. A core module, not a
// scope: display only, knows models, texts and core-ui, but neither the data nor
// the state layer (ModuleBoundariesTest), so no scope can reach another one through this.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.brickinventory.android.compose)
}

android {
    namespace = "ch.brickinventoryapp.core.uiinventory"
    // UI tests under Robolectric read texts and fonts from the resources.
    testOptions.unitTests.isIncludeAndroidResources = true
}

dependencies {
    api(project(":core-model"))
    implementation(project(":core-ui"))
    implementation(project(":core-resources"))

    testImplementation(project(":core-testing"))
    // The chart test builds its points from server responses; only the test knows the contract.
    testImplementation(project(":core-contract"))
    testImplementation(testFixtures(project(":core-contract")))
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.androidx.ui.test.junit4)
    debugImplementation(libs.androidx.ui.test.manifest)
}
