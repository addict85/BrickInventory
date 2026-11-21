// Design system: theme, building blocks without domain knowledge (cards, rows, search field, dialogs,
// camera) and pure display rules. Domain building blocks live in core-ui-inventory.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.brickinventory.android.compose)
}

android {
    namespace = "ch.brickinventoryapp.core.ui"
    // The dialog tests read texts from the resources.
    testOptions.unitTests.isIncludeAndroidResources = true
}

dependencies {
    api(project(":core-model"))
    implementation(project(":core-resources"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.bundles.camera)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.biometric)

    testImplementation(project(":core-testing"))
    // Clipboard and dialog windows are checked under Robolectric.
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.androidx.ui.test.junit4)
    debugImplementation(libs.androidx.ui.test.manifest)
}
