// Texte (beide Sprachen), Schriften und die Bilder, die der Code nennt: Jedes
// Modul liest dieselbe R-Klasse (ch.brickinventoryapp.ressourcen.R), statt dass
// Texte nach dem Modul getrennt werden, das sie zuerst brauchte.
plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "ch.brickinventoryapp.ressourcen"
    compileSdk = 37

    defaultConfig {
        minSdk = 30
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}
