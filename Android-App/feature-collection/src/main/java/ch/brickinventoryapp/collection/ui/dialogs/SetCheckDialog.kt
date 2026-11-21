package ch.brickinventoryapp.collection.ui.dialogs

// Bulk imports as in the neighboring dialog (BarcodeResultDialog.kt): `Modifier.size`
// lives in foundation.layout, and the `by` before collectAsStateWithLifecycle
// needs runtime.getValue — both come along with the star imports.
import ch.brickinventoryapp.collection.ui.EntryUiState
import ch.brickinventoryapp.ui.theme.fensterFlaeche
import ch.brickinventoryapp.collection.ui.viewmodel.ErfassungAktionen
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.collection.ui.CheckPhase
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * "Checking" — the display between scan and interim dialog. A dialog instead of a snackbar:
 * that would vanish while the check is still running and wouldn't hold anything up — you could
 * already scan the next set.
 */
@Composable
internal fun SetCheckRoute(vm: EntryViewModel) {
    val erfassung by vm.entryState.collectAsStateWithLifecycle()
    SetCheckDialog(erfassung, vm)
}

@Composable
internal fun SetCheckDialog(erfassung: EntryUiState, aktionen: ErfassungAktionen) {
    val schritt = erfassung.check ?: return

    val titel = stringResource(R.string.pruef_titel)
    AlertDialog(
        containerColor = fensterFlaeche(),
        modifier = Modifier.semantics { paneTitle = titel },
        // Can't be dismissed by tapping outside: the halt IS the point. Whoever
        // really wants to continue uses the button — then it's a decision
        // and not a slipped finger.
        onDismissRequest = { },
        title = { Text(titel, Modifier.semantics { heading() }, fontWeight = FontWeight.Bold) },
        icon = { CircularProgressIndicator(Modifier.size(24.dp)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                Text(
                    when (schritt.phase) {
                        CheckPhase.BARCODE -> stringResource(R.string.pruef_barcode, schritt.identifier)
                        CheckPhase.BESTAND -> stringResource(R.string.pruef_bestand, schritt.identifier)
                        // No `else`: a new step should wake up the
                        // translator, not vanish silently in a
                        // catch-all branch.
                        CheckPhase.ANLEGEN_STAMMDATEN ->
                            stringResource(R.string.pruef_anlegen_stammdaten, schritt.identifier)
                        CheckPhase.ANLEGEN_BILD ->
                            stringResource(R.string.pruef_anlegen_bild, schritt.identifier)
                        CheckPhase.ANLEGEN_ABSCHLUSS ->
                            stringResource(R.string.pruef_anlegen_abschluss, schritt.identifier)
                    },
                    style = MaterialTheme.typography.bodyMedium
                )
                Text(
                    stringResource(R.string.pruef_hinweis),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        confirmButton = {
            // No "OK": there's nothing to confirm. The only sensible
            // way out is canceling — and that belongs where
            // one expects it.
            TextButton(onClick = { aktionen.abortCheckAb() }) {
                Text(stringResource(R.string.common_cancel))
            }
        }
    )
}
