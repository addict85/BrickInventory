// Server- und UI-Modelle samt reiner Regeln: ohne Android, damit keine Schicht
// darunter hängen kann und die Tests ohne Robolectric auf der JVM laufen.
plugins {
    alias(libs.plugins.brickinventory.jvm.library)
    alias(libs.plugins.kotlin.serialization)
    // Lint der App (checkDependencies) schliesst das Modul nur mit diesem Plugin ein.
    alias(libs.plugins.android.lint)
}

dependencies {
    api(libs.kotlinx.serialization.json)
    // Nur @Qualifier für die Dispatcher-Qualifier (model.koroutinen); kein Hilt, kein Android.
    implementation(libs.javax.inject)
    testImplementation(libs.junit)
}
