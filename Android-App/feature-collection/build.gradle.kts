// One's own sets: gallery, set detail, watchlist, purchases, comparison and entry by scanner.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.collection"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    // openExtern and ownAddress.
    implementation(project(":core-network"))
    implementation(project(":core-ui"))
    implementation(project(":core-ui-inventory"))
    implementation(project(":core-state"))
    implementation(project(":core-navigation"))
    implementation(project(":core-session"))
    implementation(project(":core-resources"))
    implementation(libs.bundles.camera)
    implementation(libs.mlkit.barcode)
    implementation(libs.mlkit.textrec)

    testImplementation(project(":core-testing"))
    testImplementation(testFixtures(project(":core-state")))
    // The test servers answer in wire format.
    testImplementation(project(":core-contract"))
    // The tests build the cache and edits themselves.
    testImplementation(project(":core-offline"))
}
