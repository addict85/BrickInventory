package ch.brickinventoryapp.collection.ui.dialogs

// Bulk imports as in the neighboring dialog (BarcodeResultDialog.kt): `Modifier.size`
// lives in foundation.layout, and the `by` before collectAsStateWithLifecycle
// needs runtime.getValue — both come along with the star imports.
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.collection.ui.CheckPhase
import ch.brickinventoryapp.collection.ui.EntryUiState
import ch.brickinventoryapp.collection.ui.viewmodel.EntryActions
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.windowSurface

/**
 * "Checking" — the display between scan and interim dialog. A dialog instead of a snackbar:
 * that would vanish while the check is still running and wouldn't hold anything up — you could
 * already scan the next set.
 */
@Composable
internal fun SetCheckRoute(vm: EntryViewModel) {
    val entryVm by vm.entryState.collectAsStateWithLifecycle()
    SetCheckDialog(entryVm, vm)
}

@Composable
internal fun SetCheckDialog(entryVm: EntryUiState, actions: EntryActions) {
    val step = entryVm.check ?: return

    val title = stringResource(R.string.check_title)
    AlertDialog(
        containerColor = windowSurface(),
        modifier = Modifier.semantics { paneTitle = title },
        // Can't be dismissed by tapping outside: the stop IS the point. Whoever
        // really wants to continue uses the button — then it's a decision
        // and not a slipped finger.
        onDismissRequest = { },
        title = { Text(title, Modifier.semantics { heading() }, fontWeight = FontWeight.Bold) },
        icon = { CircularProgressIndicator(Modifier.size(24.dp)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
                Text(
                    when (step.phase) {
                        CheckPhase.BARCODE -> stringResource(R.string.check_barcode, step.identifier)
                        CheckPhase.STOCK -> stringResource(R.string.check_stock, step.identifier)
                        // No `else`: a new step should wake up the
                        // translator, not vanish silently in a
                        // catch-all branch.
                        CheckPhase.CREATE_MASTER_DATA ->
                            stringResource(R.string.check_create_master_data, step.identifier)
                        CheckPhase.CREATE_IMAGE ->
                            stringResource(R.string.check_create_image, step.identifier)
                        CheckPhase.CREATE_COMPLETION ->
                            stringResource(R.string.check_create_completion, step.identifier)
                    },
                    style = MaterialTheme.typography.bodyMedium
                )
                Text(
                    stringResource(R.string.check_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        confirmButton = {
            // No "OK": there's nothing to confirm. The only sensible
            // way out is canceling — and that belongs where
            // one expects it.
            TextButton(onClick = { actions.cancelCheck() }) {
                Text(stringResource(R.string.common_cancel))
            }
        }
    )
}
