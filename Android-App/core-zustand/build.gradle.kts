// Was die Bereiche teilen, ohne einander zu kennen: Sitzung, Blickfeld,
// Bestandssignal, Texte, die Grundlage der Bereichs-ViewModels und der
// AppViewModel. Was nur die App kennt (Widget), kommt als Schnittstelle herein.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

android {
    namespace = "ch.brickinventoryapp.core.zustand"
    compileSdk = 37

    defaultConfig {
        minSdk = 30
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
    api(project(":core-data"))
    api(project(":core-ui"))
    implementation(project(":core-ressourcen"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    api(libs.androidx.lifecycle.runtime.ktx)
    // Die ViewModels hier sind öffentliche Basis aller Bereiche; wer sie
    // erweitert oder im Test startet, braucht ViewModel und viewModelScope.
    api(libs.androidx.lifecycle.viewmodel)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.bundles.compose)

    testImplementation(project(":core-testing"))
    testImplementation(libs.bundles.unit.tests)
}
