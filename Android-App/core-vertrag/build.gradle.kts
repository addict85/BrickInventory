// Das Wire-Format: Anfragen und Antworten des Servers (@Serializable) und ihre Abbildung
// auf die Anzeigetypen in core-model. Ohne Android wie core-model; es kennt core-model,
// nicht umgekehrt, damit Fach- und Anzeigetypen nicht am Netzformat hängen.
plugins {
    alias(libs.plugins.brickinventory.jvm.library)
    alias(libs.plugins.kotlin.serialization)
    // Lint der App (checkDependencies) schliesst das Modul nur mit diesem Plugin ein.
    alias(libs.plugins.android.lint)
}

dependencies {
    api(project(":core-model"))
    api(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
}
