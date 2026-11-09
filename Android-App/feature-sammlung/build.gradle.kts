// Die eigenen Sets: Galerie, Set-Detail, Merkliste, Käufe, Vergleich und Erfassen per Scanner.
// Hängt nur an core-* und feature-gemeinsam; was ein anderer Bereich braucht, liegt
// dort, in core-ui oder core-zustand, sonst kennten sich die Bereiche (ModulgrenzenTest).
plugins {
    alias(libs.plugins.brickinventory.android.feature)
}

android {
    namespace = "ch.brickinventoryapp.feature.sammlung"
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    implementation(project(":core-ui"))
    implementation(project(":feature-gemeinsam"))
    implementation(project(":core-zustand"))
    implementation(project(":core-ressourcen"))
    implementation(libs.bundles.camera)
    implementation(libs.mlkit.barcode)
    implementation(libs.mlkit.textrec)

    testImplementation(project(":core-testing"))
}
