// Was Geheimnisse schützt: Token-Tresor im Keystore, Ablageschlüssel und
// verschlüsselte Ablagen, das TLS-Vertrauen zum eigenen Server, geheime
// Zwischenablage, Passwort- und Passkey-Regeln. Kennt weder Repositories noch
// Room: core-offline und core-data bauen darauf auf, nie umgekehrt (ModulgrenzenTest).
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.brickinventory.android.hilt)
}

android {
    namespace = "ch.brickinventoryapp.core.sicherheit"
}

dependencies {
    implementation(project(":core-model"))
    // Protokoll: Warnungen des Tresors nur im Debug-Build.
    implementation(project(":core-netz"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.okhttp)
    // Allein griffe das Modul auf arch-core 2.0.0 und tracing 1.1.0 zurück; geprüft
    // sind nur die Fassungen, die der Rest der App ohnehin nimmt.
    constraints {
        implementation(libs.androidx.arch.core.common)
        implementation(libs.androidx.arch.core.runtime)
        implementation(libs.androidx.tracing)
    }

    testImplementation(project(":core-testing"))
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
}
