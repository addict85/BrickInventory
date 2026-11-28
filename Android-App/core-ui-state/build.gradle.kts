// What screens and ViewModels hold as state (Load, Operation, scroll memory, list view):
// UI state without Compose, so the state layer can hold it without knowing a Compose module.
// Below it only core-model; the wire format and the data layer never see it.
plugins {
    alias(libs.plugins.brickinventory.jvm.library)
    alias(libs.plugins.kotlin.serialization)
    // The app's lint (checkDependencies) includes the module only with this plugin.
    alias(libs.plugins.android.lint)
}

dependencies {
    api(project(":core-model"))
    testImplementation(libs.junit)
}
