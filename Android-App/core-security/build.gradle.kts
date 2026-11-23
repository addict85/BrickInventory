// What protects secrets: the token vault in the Keystore, store keys and
// encrypted stores, TLS trust towards the app's own server, secret
// clipboard, password and passkey rules. Knows neither repositories nor
// Room: core-offline and core-data build on it, never the other way round (ModuleBoundariesTest).
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.brickinventory.android.hilt)
}

android {
    namespace = "ch.brickinventoryapp.core.security"
}

dependencies {
    implementation(project(":core-model"))
    // Logging: vault warnings only in the debug build.
    implementation(project(":core-network"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.okhttp)

    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
}
