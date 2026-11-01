// Theme, gemeinsame Composables (Karten, Zeilen, Filter, Kamera-Bausteine) und
// reine Anzeigeregeln. Kennt nur die Modelle, keine Daten- oder Zustandsschicht.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

android {
    namespace = "ch.brickinventoryapp.core.ui"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

    testOptions {
        // Wie in app/: android.util.Log & Co. laufen im JVM-Test still ins Leere.
        unitTests.isReturnDefaultValues = true
        unitTests.isIncludeAndroidResources = false
        unitTests.all { test ->
            test.testLogging {
                exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
                showCauses = true
                showStackTraces = true
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    api(project(":core-model"))
    implementation(project(":core-ressourcen"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.bundles.compose)
    implementation(libs.bundles.camera)
    implementation(libs.androidx.appcompat)

    testImplementation(project(":core-testing"))
    testImplementation(libs.bundles.unit.tests)
}
