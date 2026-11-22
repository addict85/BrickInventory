// What the scopes share without knowing each other: Blickfeld, texts, the foundation
// of the scope ViewModels and the AppViewModel — without Compose; the surroundings of destinations
// live in core-navigation. What only the app knows (widget) comes in as an interface.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.brickinventory.android.hilt)
}

android {
    namespace = "ch.brickinventoryapp.core.state"
}

dependencies {
    api(project(":core-model"))
    // Innen: Die Bereiche nennen core-data selbst.
    implementation(project(":core-data"))
    implementation(project(":core-session"))
    implementation(project(":core-security"))
    // NetworkPolicy and the rule for who reports a 401.
    implementation(project(":core-network"))
    implementation(project(":core-resources"))
    implementation(libs.androidx.core.ktx)
    api(libs.androidx.lifecycle.runtime.ktx)
    // The ViewModels here are the public base of all scopes; whoever
    // extends them or starts them in a test needs ViewModel and viewModelScope.
    api(libs.androidx.lifecycle.viewmodel)

    testImplementation(project(":core-testing"))
    // The test servers answer in the wire format.
    testImplementation(project(":core-contract"))
    // OutboxSyncTest builds the store and the outbox in memory.
    testImplementation(project(":core-offline"))
}
