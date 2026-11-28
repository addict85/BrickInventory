// What the areas share without knowing each other: the scope (Scope.kt), texts, the foundation
// of the area ViewModels and the AppViewModel — without Compose; the surroundings of destinations
// live in core-navigation. What only the app knows (widget) comes in as an interface.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.brickinventory.android.hilt)
}

android {
    namespace = "ch.brickinventoryapp.core.state"
    // The scope ViewModels' shared services (TestServices) for the areas' tests.
    testFixtures.enable = true
}

dependencies {
    api(project(":core-model"))
    implementation(project(":core-ui-state"))
    // Internal: the areas name core-data themselves.
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

    testFixturesApi(testFixtures(project(":core-data")))
    testFixturesApi(testFixtures(project(":core-session")))
    testFixturesImplementation(project(":core-data"))
    testFixturesImplementation(project(":core-ui-state"))
    testFixturesImplementation(project(":core-session"))
    testFixturesImplementation(project(":core-offline"))
    testImplementation(project(":core-testing"))
    // The test servers answer in the wire format.
    testImplementation(project(":core-contract"))
    testImplementation(testFixtures(project(":core-contract")))
    // OutboxSyncTest builds the store and the outbox in memory.
    testImplementation(project(":core-offline"))
}
