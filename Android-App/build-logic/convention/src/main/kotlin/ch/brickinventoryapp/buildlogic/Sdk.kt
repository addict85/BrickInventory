package ch.brickinventoryapp.buildlogic

/**
 * Die SDK-Stände aller Android-Module an einer Stelle. compileSdk und targetSdk
 * laufen gleich, damit sichtbar bleibt, welche Verhaltensänderungen aktiv sind;
 * unter 37 bricht checkDebugAarMetadata (okhttp 5.5, coil 3.6). Warum minSdk 30
 * gilt, steht in TargetSdkConfigTest, der diese Datei liest.
 */
internal object Sdk {
    const val compileSdk = 37
    const val targetSdk = 37
    const val minSdk = 30
}
