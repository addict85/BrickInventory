// The app's session: server, sign-in, account settings, and the service
// that follows them across screens. Below core-state: state and
// scopes read the session, the session knows neither filters nor ViewModels.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.brickinventory.android.hilt)
}

android {
    namespace = "ch.brickinventoryapp.core.session"
    // A session without Hilt and a sign-out fake, for the tests above.
    testFixtures.enable = true
}

dependencies {
    api(project(":core-model"))
    implementation(project(":core-data"))
    // NetworkPolicy: address of a failed sign-out, plaintext legacy stock.
    implementation(project(":core-network"))
    implementation(project(":core-resources"))
    // Own flows (the session's StateFlow); without this entry Gradle resolves to an old version.
    implementation(libs.kotlinx.coroutines.android)

    testFixturesImplementation(project(":core-data"))
    testFixturesImplementation(libs.kotlinx.coroutines.android)
    // SessionService is tested in core-state: its tests assemble it together with the scope.
}
