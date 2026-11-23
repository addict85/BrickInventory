package ch.brickinventoryapp.buildlogic

/**
 * The SDK levels of all Android modules in one place. compileSdk and targetSdk
 * run the same so that it stays visible which behavior changes are active;
 * below 37 checkDebugAarMetadata breaks (okhttp 5.5, coil 3.6). Why minSdk 30
 * applies stands in TargetSdkConfigTest, which reads this file.
 */
internal object Sdk {
    const val compileSdk = 37
    // Compose from BOM 2026.11 (1.13) compiles only against 37.1 (checkDebugAarMetadata);
    // a minor level adds APIs but no behavior change, so targetSdk stays at 37.
    const val compileSdkMinor = 1
    const val targetSdk = 37
    const val minSdk = 30
}
