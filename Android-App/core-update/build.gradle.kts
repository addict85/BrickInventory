// Self-update from the GitHub release: check description, load APK,
// compare signature, install. Depends on core-data (update client, storage);
// core-data doesn't know this module, so the Hilt modules are bound here.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.brickinventory.android.hilt)
}

android {
    namespace = "ch.brickinventoryapp.core.update"

    // InstallationsSessionTest runs under Robolectric and reads the receiver's texts.
    testOptions.unitTests.isIncludeAndroidResources = true
}

dependencies {
    implementation(project(":core-data"))
    // R.string and R.raw.beschreibungs_schluessel: the R classes are not transitive.
    implementation(project(":core-resources"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.serialization.json)
    // Only for the bare update client; no module above sees OkHttp.
    implementation(libs.okhttp)
    implementation(libs.kotlinx.coroutines.android)
    // UpdateStore remembers the state in the app's DataStore.
    implementation(libs.androidx.datastore)

    testImplementation(project(":core-testing"))
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
}
