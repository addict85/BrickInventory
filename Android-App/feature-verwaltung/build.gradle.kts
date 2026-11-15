// Monitoring für Verwalter: Zwischenspeicher, Kontingente, Protokoll, Jobs.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.verwaltung"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    implementation(project(":core-ui"))
    implementation(project(":core-ui-bestand"))
    implementation(project(":core-zustand"))
    implementation(project(":core-navigation"))
    implementation(project(":core-sitzung"))
    implementation(project(":core-ressourcen"))

    testImplementation(project(":core-testing"))
}
