// Die lokale Wahrheit der Oberfläche: Listen und Ausgang je Konto in Room
// (SQLCipher), Offlineablage und die lokale Anwendung von Bearbeitungen. Kennt
// weder Netz noch Repositories: Das Senden (Abgleich, AusgangWorker) liegt in
// core-data, das hierauf aufbaut (ModulgrenzenTest).
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
    namespace = "ch.brickinventoryapp.core.offline"
    // Die Room-Tests laufen unter Robolectric und lesen die Ressourcen.
    testOptions.unitTests.isIncludeAndroidResources = true
}

dependencies {
    api(project(":core-model"))
    // Die Listen tragen Servermodelle (SetItem, Part …); wer sie liest, braucht die Typen.
    api(project(":core-vertrag"))
    // Der Schlüssel der Datenbank kommt aus dem Ablageschlüssel.
    implementation(project(":core-sicherheit"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    implementation(libs.sqlcipher.android)
    ksp(libs.androidx.room.compiler)

    testImplementation(project(":core-testing"))
    // Abgleich und Repositories gegen die echte Room-Ablage (BestandDatenbankTest, OhneNetzFilterTest).
    testImplementation(project(":core-data"))
    // Room-Tests laufen unter Robolectric (BestandMigrationTest).
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
}
