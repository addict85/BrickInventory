// Background work with its own Android entry point, all on WorkManager: following the CSV
// import and the PDF export, and the hourly price alert. Depends on
// core-data (repositories, stores); core-data does not know this module.
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.brickinventory.android.hilt)
}

android {
    namespace = "ch.brickinventoryapp.core.services"
}

dependencies {
    implementation(project(":core-data"))
    implementation(project(":core-data-api"))
    // Texts and icon of the notifications: the R classes are not transitive.
    implementation(project(":core-resources"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.work)
    // WorkManager alone would pull in Lifecycle 2.5.1; the checksums only know the order of the other modules.
    implementation(libs.androidx.lifecycle.runtime.ktx)
    // @HiltWorker: the price-alert worker gets its fetcher injected via the constructor.
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)

}
