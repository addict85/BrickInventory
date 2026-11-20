// Der Set-Katalog mit Detailansicht.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.katalog"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    // openExtern.
    implementation(project(":core-netz"))
    implementation(project(":core-ui"))
    implementation(project(":core-ui-bestand"))
    implementation(project(":core-zustand"))
    implementation(project(":core-navigation"))
    implementation(project(":core-sitzung"))
    implementation(project(":core-ressourcen"))

    testImplementation(project(":core-testing"))
    // Die Testserver antworten im Wire-Format.
    testImplementation(project(":core-vertrag"))
}
