// Netz (Retrofit, OkHttp), Ablage (Room, DataStore), Repositories, Ausgang und
// die Hilt-Module dafür. Kennt keine Oberfläche: Was die App beisteuern muss
// (Startziel, AppFassung), kommt über Hilt herein.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

ksp {
    // Room legt hier das Schema je Fassung ab; eingecheckt, damit eine Migration
    // gegen die frühere Fassung geprüft werden kann (BestandMigrationTest).
    arg("room.schemaLocation", "$projectDir/schemas")
}

android {
    namespace = "ch.brickinventoryapp.core.data"
    compileSdk = 37

    defaultConfig {
        minSdk = 30
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    testOptions {
        // Wie in app/: android.util.Log & Co. laufen im JVM-Test still ins Leere.
        unitTests.isReturnDefaultValues = true
        unitTests.isIncludeAndroidResources = true
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
    api(libs.kotlinx.coroutines.android)
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    // In der öffentlichen Schnittstelle: Repositories und Dienste reichen
    // OkHttpClient, ImageLoader und Retrofit-Antworten nach oben.
    api(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    api(libs.okhttp.logging)
    api(libs.okhttp.sse)
    api(libs.coil.core)
    implementation(libs.coil.network.okhttp)
    // PreferencesManager nennt seine Schlüssel als Preferences.Key nach aussen.
    api(libs.androidx.datastore)
    api(libs.androidx.work)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    testImplementation(project(":core-testing"))
    testImplementation(libs.bundles.unit.tests)
    // Room-Tests laufen unter Robolectric (BestandDatenbankTest, BestandMigrationTest).
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
}
