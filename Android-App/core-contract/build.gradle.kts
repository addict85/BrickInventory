// The wire format: requests and responses of the server (@Serializable) and their mapping
// to the display types in core-model. Without Android like core-model; it knows core-model,
// not the other way round, so that domain and display types do not depend on the network format.
plugins {
    alias(libs.plugins.brickinventory.jvm.library)
    alias(libs.plugins.kotlin.serialization)
    // The app's Lint (checkDependencies) only includes the module with this plugin.
    alias(libs.plugins.android.lint)
    // Generated test builders for the responses (ContractSamples.kt): only tests may fill in values.
    `java-test-fixtures`
}

dependencies {
    api(project(":core-model"))
    api(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
}
