// What every area needs from the app to show its destinations (AreaEnvironment).
// Own module because it knows Compose, Navigation and Coil: core-state thus stays
// without UI (ModuleEdges.withoutUi).
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.compose)
}

android {
    namespace = "ch.brickinventoryapp.core.navigation"
}

dependencies {
    api(project(":core-model"))
    implementation(project(":core-session"))
    implementation(project(":core-state"))
    implementation(libs.kotlinx.coroutines.android)
}
