// Was jeder Bereich von der App braucht, um seine Ziele zu zeigen (Bereichsumgebung).
// Eigenes Modul, weil es Compose, Navigation und Coil kennt: core-state bleibt so
// ohne Oberfläche (Modulkanten.withoutUi).
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.compose)
}

android {
    namespace = "ch.brickinventoryapp.core.navigation"
}

dependencies {
    api(project(":core-model"))
    implementation(project(":core-session"))
    implementation(project(":core-state"))
    implementation(libs.kotlinx.coroutines.android)
}
