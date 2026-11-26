package ch.brickinventoryapp.ui.components

import androidx.compose.runtime.staticCompositionLocalOf
import ch.brickinventoryapp.model.util.AppVersion

/**
 * The running version for the UI; MainActivity sets it. Without a provider
 * (preview, screenshot) an empty version sits there instead of a crash.
 */
val LocalAppVersion = staticCompositionLocalOf { AppVersion(name = "", code = 0) }

