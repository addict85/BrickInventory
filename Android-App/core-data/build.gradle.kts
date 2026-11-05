// Netz (Retrofit, OkHttp), Ablage (Room, DataStore), Repositories, Ausgang und
// die Hilt-Module dafür. Kennt keine Oberfläche: Was die App beisteuern muss
// (Startziel, AppFassung), kommt über Hilt herein.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.brickinventory.android.hilt)
}

ksp {
    // Room legt hier das Schema je Fassung ab; eingecheckt, damit eine Migration
    // gegen die frühere Fassung geprüft werden kann (BestandMigrationTest).
    arg("room.schemaLocation", "$projectDir/schemas")
}

android {
    namespace = "ch.brickinventoryapp.core.data"

    buildFeatures {
        buildConfig = true
    }

    // Die Room-Tests laufen unter Robolectric und lesen die Ressourcen.
    testOptions.unitTests.isIncludeAndroidResources = true
}

dependencies {
    api(project(":core-model"))
    implementation(project(":core-ressourcen"))
    implementation(libs.androidx.core.ktx)
    api(libs.kotlinx.coroutines.android)
    // In der öffentlichen Schnittstelle: Repositories und Dienste reichen
    // OkHttpClient, ImageLoader und Retrofit-Antworten nach oben.
    api(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    api(libs.okhttp.logging)
    api(libs.okhttp.sse)
    api(libs.coil.core)
    implementation(libs.coil.network.okhttp)
    // PreferencesManager nennt seine Schlüssel als Preferences.Key nach aussen.
    api(libs.androidx.datastore)
    api(libs.androidx.work)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    implementation(libs.sqlcipher.android)
    ksp(libs.androidx.room.compiler)

    testImplementation(project(":core-testing"))
    // Room-Tests laufen unter Robolectric (BestandDatenbankTest, BestandMigrationTest).
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
}
