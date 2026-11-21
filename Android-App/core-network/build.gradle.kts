// The rules by which the app talks to the server: guard interceptor,
// network policy, address check. Knows neither Room nor repositories nor Hilt;
// what the guard needs from the device (token, address) comes in via Zugangslage.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
}

android {
    namespace = "ch.brickinventoryapp.core.network"

    buildFeatures {
        // NetworkPolicy.entwicklung liest BuildConfig.DEBUG dieses Moduls.
        buildConfig = true
    }
}

dependencies {
    api(project(":core-model"))
    // OkHttp only as implementation: no module above shall see it (as in core-data).
    implementation(libs.okhttp)
}
