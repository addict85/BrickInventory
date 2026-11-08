// Die Regeln, nach denen die App mit dem Server spricht: Wächter-Interceptor,
// Netzrichtlinie, Adressprüfung. Kennt weder Room noch Repositories noch Hilt;
// was der Wächter vom Gerät braucht (Token, Adresse), kommt über Zugangslage herein.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
}

android {
    namespace = "ch.brickinventoryapp.core.netz"

    buildFeatures {
        // NetworkPolicy.entwicklung liest BuildConfig.DEBUG dieses Moduls.
        buildConfig = true
    }
}

dependencies {
    // Fehlerrumpf zeigt Fehlercode nach aussen.
    api(project(":core-model"))
    // OkHttp nur als implementation: Kein Modul darüber soll es sehen (wie in core-data).
    implementation(libs.okhttp)
    // oeffneExtern: Uri-Erweiterung.
    implementation(libs.androidx.core.ktx)
}
