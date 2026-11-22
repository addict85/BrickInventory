package ch.brickinventoryapp.account.ui.dialogs

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.account.ui.UpdateUiState
import ch.brickinventoryapp.account.ui.viewmodel.UpdateActions
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.OverlayGuard
import ch.brickinventoryapp.ui.components.versionsName
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.windowSurface
import ch.brickinventoryapp.update.util.permissionIntent

/**
 * "There's a new version — update now?" A dialog on start, because a
 * dot on the account icon is easy to overlook. Loading still never happens on
 * its own: the dialog asks, the load only begins on "Update now"
 * — asking is not the same as automatically acting.
 */
@Composable
fun UpdateRoute(selfUpdate: UpdateActions.WithState) {
    val condition by selfUpdate.uiState.collectAsStateWithLifecycle()
    UpdateDialog(condition, selfUpdate)
}

@Composable
internal fun UpdateDialog(condition: UpdateUiState, selfUpdate: UpdateActions) {
    val newer = condition.newerVersion ?: return
    if (condition.dialogRejected) return
    val ctx = LocalContext.current

    val loading = condition.progress != null
    val close = { selfUpdate.closeUpdateHint() }

    val title = stringResource(R.string.update_dialog_title)
    AlertDialog(
        containerColor = windowSurface(),
        modifier = Modifier.semantics { paneTitle = title },
        // Can't be dismissed by tapping away while loading — see the top of this file.
        onDismissRequest = { if (!loading) close() },
        title = { Text(title, Modifier.semantics { heading() }) },
        text = {
            OverlayGuard()
            UpdateContent(condition, newer.versionName)
        },
        confirmButton = {
            when {
                // The system permission is missing: the only button that
                // helps now leads into the system settings.
                condition.permissionAbsent -> TextButton(onClick = {
                    ctx.startActivity(permissionIntent(ctx))
                }) { Text(stringResource(R.string.update_permission_grant)) }
                // Already on disk (e.g. because the system installer
                // was cancelled): don't load it again.
                condition.readyToInstallation -> TextButton(onClick = { selfUpdate.startInstallation() }) {
                    Text(stringResource(R.string.update_install))
                }
                loading -> {}
                else -> TextButton(onClick = { selfUpdate.loadUpdate() }) {
                    Text(stringResource(R.string.update_dialog_now))
                }
            }
        },
        dismissButton = {
            // No "Later" while loading: the operation is running, and a
            // button that doesn't stop it but looks like it would would be a
            // promise the dialog can't keep.
            if (!loading) TextButton(onClick = close) {
                Text(stringResource(R.string.update_dialog_later))
            }
        },
    )
}

/** Version, progress and what's missing — the dialog's text, separate from the frame and buttons. */
@Composable
private fun UpdateContent(condition: UpdateUiState, versionName: String) {
    Column {
        Text(stringResource(R.string.update_dialog_text, versionName, versionsName()))
        condition.progress?.let { p ->
            Spacer(Modifier.height(Spacing.medium))
            Text(stringResource(R.string.update_downloading, p),
                style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(Spacing.tiny))
            LinearProgressIndicator(
                progress = { p / 100f },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (condition.permissionAbsent) {
            Spacer(Modifier.height(Spacing.medium))
            Text(stringResource(R.string.update_permission_needed),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        condition.error?.let { f ->
            Spacer(Modifier.height(Spacing.medium))
            Text(f.sentence(), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }
    }
}
