package ch.brickinventoryapp.account.ui.dialogs

import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.ui.theme.fensterFlaeche
// Bulk imports as in the neighboring dialogs (BarcodeResultDialog.kt,
// SetCheckDialog.kt) — see the reasoning there.
import ch.brickinventoryapp.account.ui.UpdateUiState
import ch.brickinventoryapp.account.ui.viewmodel.UpdateAktionen
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.versionsName
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.update.util.permissionIntent

/**
 * "There's a new version — update now?" A dialog on start, because a
 * dot on the account icon is easy to overlook. Loading still never happens on
 * its own: the dialog asks, the load only begins on "Update now"
 * — asking is not the same as automatically acting.
 */
@Composable
fun UpdateRoute(selbstUpdate: UpdateAktionen.WithState) {
    val zustand by selbstUpdate.zustand.collectAsStateWithLifecycle()
    UpdateDialog(zustand, selbstUpdate)
}

@Composable
internal fun UpdateDialog(zustand: UpdateUiState, selbstUpdate: UpdateAktionen) {
    val neuere = zustand.newerVersion ?: return
    if (zustand.dialogRejected) return
    val ctx = LocalContext.current

    val laedt = zustand.fortschritt != null
    val schliessen = { selbstUpdate.closeUpdateHint() }

    val titel = stringResource(R.string.update_dialog_title)
    AlertDialog(
        containerColor = fensterFlaeche(),
        modifier = Modifier.semantics { paneTitle = titel },
        // Can't be dismissed by tapping away while loading — see the top of this file.
        onDismissRequest = { if (!laedt) schliessen() },
        title = { Text(titel, Modifier.semantics { heading() }) },
        text = {
            Ueberdeckungsschutz()
            UpdateContent(zustand, neuere.versionName)
        },
        confirmButton = {
            when {
                // The system permission is missing: the only button that
                // helps now leads into the system settings.
                zustand.permissionAbsent -> TextButton(onClick = {
                    ctx.startActivity(permissionIntent(ctx))
                }) { Text(stringResource(R.string.update_permission_grant)) }
                // Already on disk (e.g. because the system installer
                // was cancelled): don't load it again.
                zustand.readyToInstallation -> TextButton(onClick = { selbstUpdate.startInstallation() }) {
                    Text(stringResource(R.string.update_install))
                }
                laedt -> {}
                else -> TextButton(onClick = { selbstUpdate.ladeUpdate() }) {
                    Text(stringResource(R.string.update_dialog_now))
                }
            }
        },
        dismissButton = {
            // No "Later" while loading: the operation is running, and a
            // button that doesn't stop it but looks like it would would be a
            // promise the dialog can't keep.
            if (!laedt) TextButton(onClick = schliessen) {
                Text(stringResource(R.string.update_dialog_later))
            }
        },
    )
}

/** Version, progress and what's missing — the dialog's text, separate from the frame and buttons. */
@Composable
private fun UpdateContent(zustand: UpdateUiState, versionName: String) {
    Column {
        Text(stringResource(R.string.update_dialog_text, versionName, versionsName()))
        zustand.fortschritt?.let { p ->
            Spacer(Modifier.height(Abstaende.mittel))
            Text(stringResource(R.string.update_downloading, p),
                style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(Abstaende.tiny))
            LinearProgressIndicator(
                progress = { p / 100f },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (zustand.permissionAbsent) {
            Spacer(Modifier.height(Abstaende.mittel))
            Text(stringResource(R.string.update_permission_needed),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        zustand.fehler?.let { f ->
            Spacer(Modifier.height(Abstaende.mittel))
            Text(f.satz(), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }
    }
}
