package ch.brickinventoryapp.buildlogic

/**
 * The SDK levels of all Android modules in one place. compileSdk and targetSdk
 * run the same so that it stays visible which behavior changes are active;
 * below 37 checkDebugAarMetadata breaks (okhttp 5.5, coil 3.6). Why minSdk 30
 * applies stands in TargetSdkConfigTest, which reads this file.
 */
internal object Sdk {
    const val compileSdk = 37
    const val targetSdk = 37
    const val minSdk = 30
}
