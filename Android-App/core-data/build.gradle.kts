// Network (Retrofit, OkHttp), DataStore, repositories, sending the outbox and
// the Hilt modules for it. Room and the offline store lie in core-offline, vault and
// TLS trust in core-security. Knows no UI: what the app has to contribute
// (start destination, AppVersion) comes in via Hilt.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.brickinventory.android.hilt)
}

android {
    namespace = "ch.brickinventoryapp.core.data"

    buildFeatures {
        buildConfig = true
    }

    // The Robolectric tests read the resources.
    testOptions.unitTests.isIncludeAndroidResources = true
}

dependencies {
    api(project(":core-model"))
    // Only internally: the repositories map the wire format to domain and view types.
    implementation(project(":core-contract"))
    // Guards and network policy. Whoever names something from it themselves (NetworkPolicy, Protokoll)
    // includes core-network themselves; nothing of it reaches beyond core-data.
    implementation(project(":core-network"))
    // Vault, store key and TLS trust; the areas that show something of it name it themselves.
    implementation(project(":core-security"))
    // Room and offline store only internally: the repositories deliver Lokal from core-model,
    // the UI sees the outbox via Ausgangslage.
    implementation(project(":core-offline"))
    implementation(project(":core-resources"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.android)
    // Network only as implementation: no module above should see OkHttp or Retrofit,
    // it takes the repositories. Tests get both via core-testing.
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp.logging)
    implementation(libs.okhttp.sse)
    // Coil, DataStore and WorkManager only here: areas get Coil via Compose,
    // whoever names DataStore or WorkManager themselves (app, core-services, core-update) includes them themselves.
    implementation(libs.coil.core)
    implementation(libs.coil.network.okhttp)
    implementation(libs.androidx.datastore)
    implementation(libs.androidx.work)
    // @HiltWorker: the workers get their dependencies in the constructor.
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)
    implementation(libs.androidx.appcompat)

    testImplementation(project(":core-testing"))
    // LogoutCleansEverythingTest checks sign-out including session and view.
    testImplementation(project(":core-state"))
    testImplementation(project(":core-session"))
    // Robolectric-Tests (InventoryDatabaseTest, Ablagen, Netz-Clients).
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
}
