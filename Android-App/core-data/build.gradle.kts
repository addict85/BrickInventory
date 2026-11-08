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
    // Wächter und Netzrichtlinie: api, weil die Bereiche sie über core-data erreichen
    // (NetworkPolicy, Zugangslage) und kein Bereich eine eigene Kante dorthin bekommt.
    api(project(":core-netz"))
    implementation(project(":core-ressourcen"))
    implementation(libs.androidx.core.ktx)
    api(libs.kotlinx.coroutines.android)
    // Netz nur als implementation: Kein Modul darüber soll OkHttp oder Retrofit sehen,
    // es nimmt die Repositories. Tests bekommen beides über core-testing.
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp.logging)
    implementation(libs.okhttp.sse)
    api(libs.coil.core)
    implementation(libs.coil.network.okhttp)
    api(libs.androidx.datastore)
    api(libs.androidx.work)
    // @HiltWorker: Die Worker bekommen ihre Abhängigkeiten im Konstruktor.
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)
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
