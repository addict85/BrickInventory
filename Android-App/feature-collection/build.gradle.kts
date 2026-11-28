// One's own sets: gallery, set detail, watchlist, purchases, comparison and entry by scanner.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.collection"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-ui-state"))
    implementation(project(":core-data"))
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
    // The real address rules (NetworkAddressRules) instead of a double.
    testImplementation(project(":core-network"))
    testImplementation(testFixtures(project(":core-state")))
    // The test servers answer in wire format.
    testImplementation(project(":core-contract"))
    testImplementation(testFixtures(project(":core-contract")))
    // The tests build the cache and edits themselves.
    testImplementation(project(":core-offline"))
}
