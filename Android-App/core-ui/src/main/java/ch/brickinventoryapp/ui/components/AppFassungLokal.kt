package ch.brickinventoryapp.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.model.util.AppVersion
import ch.brickinventoryapp.resources.R

/**
 * The running version for the UI; MainActivity sets it. Without a provider
 * (preview, screenshot) an empty version sits there instead of a crash.
 */
val LocalAppVersion = staticCompositionLocalOf { AppVersion(name = "", code = 0) }

/** The running version's name for display; without a name „unknown“ instead of „Installed: “ with nothing after it. */
@Composable
fun versionsName(): String = LocalAppVersion.current.name.ifBlank { stringResource(R.string.update_version_unbekannt) }
