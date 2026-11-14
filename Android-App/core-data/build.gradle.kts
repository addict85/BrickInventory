// Netz (Retrofit, OkHttp), DataStore, Repositories, das Senden des Ausgangs und
// die Hilt-Module dafür. Room und Offlineablage liegen in core-offline, Tresor und
// TLS-Vertrauen in core-sicherheit. Kennt keine Oberfläche: Was die App beisteuern
// muss (Startziel, AppFassung), kommt über Hilt herein.
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

    // Die Robolectric-Tests lesen die Ressourcen.
    testOptions.unitTests.isIncludeAndroidResources = true
}

dependencies {
    api(project(":core-model"))
    // Die Repositories liefern Antworttypen; wer sie aufruft, braucht sie.
    api(project(":core-vertrag"))
    // Wächter und Netzrichtlinie. Wer selbst etwas daraus nennt (NetworkPolicy, Protokoll),
    // bindet core-netz selbst ein; über core-data reicht nichts davon hinaus.
    implementation(project(":core-netz"))
    // Tresor, Ablageschlüssel und TLS-Vertrauen; die Bereiche, die davon etwas zeigen, nennen es selbst.
    implementation(project(":core-sicherheit"))
    // Room und Offlineablage nur innen: Die Repositories liefern Lokal aus core-model,
    // den Ausgang sieht die Oberfläche über Ausgangslage.
    implementation(project(":core-offline"))
    implementation(project(":core-ressourcen"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.android)
    // Netz nur als implementation: Kein Modul darüber soll OkHttp oder Retrofit sehen,
    // es nimmt die Repositories. Tests bekommen beides über core-testing.
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp.logging)
    implementation(libs.okhttp.sse)
    // Coil, DataStore und WorkManager nur hier: Bereiche bekommen Coil über Compose,
    // wer DataStore oder WorkManager selbst nennt (App, core-dienste, core-update), bindet sie selbst ein.
    implementation(libs.coil.core)
    implementation(libs.coil.network.okhttp)
    implementation(libs.androidx.datastore)
    implementation(libs.androidx.work)
    // @HiltWorker: Die Worker bekommen ihre Abhängigkeiten im Konstruktor.
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)
    implementation(libs.androidx.appcompat)

    testImplementation(project(":core-testing"))
    // AbmeldenRaeumtAllesTest prüft das Abmelden samt Sitzung und Blickfeld.
    testImplementation(project(":core-zustand"))
    testImplementation(project(":core-sitzung"))
    // Robolectric-Tests (BestandDatenbankTest, Ablagen, Netz-Clients).
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
}
