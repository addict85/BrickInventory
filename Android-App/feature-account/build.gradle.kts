// Einstellungen: Konto, Haushalt, Lagerorte, CSV, Alarme und Aktualisierung.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.account"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    implementation(project(":core-update"))
    implementation(project(":core-ui"))
    implementation(project(":core-ui-inventory"))
    implementation(project(":core-state"))
    implementation(project(":core-navigation"))
    implementation(project(":core-session"))
    implementation(project(":core-resources"))

    testImplementation(project(":core-testing"))
    // UpdateViewModelTest baut eine Vertrauensablage (PinStore aus core-security).
    testImplementation(project(":core-security"))
}
