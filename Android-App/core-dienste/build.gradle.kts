// Hintergrunddienste mit eigenem Android-Einstieg: der CSV-Import als
// Vordergrund-Dienst und der stündliche Preisalarm (WorkManager). Hängt an
// core-data (Repositories, Ablagen); core-data kennt dieses Modul nicht.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.brickinventory.android.hilt)
}

android {
    namespace = "ch.brickinventoryapp.core.dienste"
}

dependencies {
    implementation(project(":core-data"))
    // Texte und Symbol der Meldungen: Die R-Klassen sind nicht transitiv.
    implementation(project(":core-ressourcen"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.work)
    // @HiltWorker: Der Preisalarm-Arbeiter bekommt seine Abholung im Konstruktor.
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)

    testImplementation(project(":core-testing"))
}
