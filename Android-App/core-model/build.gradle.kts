// Server- und UI-Modelle samt reiner Regeln: ohne Android, damit keine Schicht
// darunter hängen kann und die Tests ohne Robolectric auf der JVM laufen.
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    // Lint der App (checkDependencies) schliesst das Modul nur mit diesem Plugin ein.
    alias(libs.plugins.android.lint)
    alias(libs.plugins.brickinventory.detekt)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

tasks.withType<Test>().configureEach {
    testLogging {
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
        showCauses = true
        showStackTraces = true
    }
}

dependencies {
    api(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
}
