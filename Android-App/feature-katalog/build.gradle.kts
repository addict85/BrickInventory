// Der Set-Katalog mit Detailansicht.
// Hängt nur an core-*; was ein anderer Bereich braucht, liegt in core-ui oder
// core-zustand, sonst kennten sich die Bereiche (ModulgrenzenTest).
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

android {
    namespace = "ch.brickinventoryapp.feature.katalog"
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
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    implementation(project(":core-ui"))
    implementation(project(":core-zustand"))
    implementation(project(":core-ressourcen"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.bundles.compose)

    testImplementation(project(":core-testing"))
    testImplementation(libs.bundles.unit.tests)
}
