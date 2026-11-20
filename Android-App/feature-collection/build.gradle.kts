// Die eigenen Sets: Galerie, Set-Detail, Merkliste, Käufe, Vergleich und Erfassen per Scanner.
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.collection"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    // openExtern und ownAddress.
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
    // Die Testserver antworten im Wire-Format.
    testImplementation(project(":core-contract"))
    // Die Tests bauen Ablage und Bearbeitungen selbst.
    testImplementation(project(":core-offline"))
}
