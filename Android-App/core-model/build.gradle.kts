// Domain and display types including pure rules: without Android, so that no layer
// below can hang on it and the tests run on the JVM without Robolectric.
plugins {
    alias(libs.plugins.brickinventory.jvm.library)
    alias(libs.plugins.kotlin.serialization)
    // The app's lint (checkDependencies) includes the module only with this plugin.
    alias(libs.plugins.android.lint)
}

dependencies {
    api(libs.kotlinx.serialization.json)
    // Only @Qualifier for the dispatcher qualifiers (model.koroutinen); no Hilt, no Android.
    implementation(libs.javax.inject)
    testImplementation(libs.junit)
}
