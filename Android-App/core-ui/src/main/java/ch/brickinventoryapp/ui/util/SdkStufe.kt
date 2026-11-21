package ch.brickinventoryapp.ui.util

import android.os.Build
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * The Android level the UI picks protection by. As a composition value instead
 * of Build.VERSION.SDK_INT in the screen: Robolectric here only runs against API 35,
 * and the branches for older devices should still be checked.
 */
val LocalSdkLevel = staticCompositionLocalOf { Build.VERSION.SDK_INT }
