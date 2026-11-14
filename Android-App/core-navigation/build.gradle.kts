// Was jeder Bereich von der App braucht, um seine Ziele zu zeigen (Bereichsumgebung).
// Eigenes Modul, weil es Compose, Navigation und Coil kennt: core-zustand bleibt so
// ohne Oberfläche (Modulkanten.ohneOberflaeche).
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.compose)
}

android {
    namespace = "ch.brickinventoryapp.core.navigation"
}

dependencies {
    api(project(":core-model"))
    implementation(project(":core-sitzung"))
    implementation(project(":core-zustand"))
    implementation(libs.kotlinx.coroutines.android)
}
