package ch.brickinventoryapp.collection.ui.dialogs

// Sammel-Importe wie im Nachbardialog (BarcodeResultDialog.kt): `Modifier.size`
// steckt in foundation.layout, und das `by` vor collectAsStateWithLifecycle
// braucht runtime.getValue — beides kommt über die Sternchen mit.
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
 * „Wird geprüft“ — die Anzeige zwischen Scan und Zwischendialog. Ein Dialog statt einer Snackbar:
 * Die verschwände, während die Prüfung noch läuft, und hielte nichts an — man könnte schon das
 * nächste Set scannen.
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
        // Nicht per Tipp daneben schliessbar: Das Anhalten IST der Zweck. Wer
        // wirklich weiter will, nimmt den Knopf — dann ist es eine Entscheidung
        // und kein verrutschter Finger.
        onDismissRequest = { },
        title = { Text(titel, Modifier.semantics { heading() }, fontWeight = FontWeight.Bold) },
        icon = { CircularProgressIndicator(Modifier.size(24.dp)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                Text(
                    when (schritt.phase) {
                        CheckPhase.BARCODE -> stringResource(R.string.pruef_barcode, schritt.identifier)
                        CheckPhase.BESTAND -> stringResource(R.string.pruef_bestand, schritt.identifier)
                        // Kein `else`: Ein neuer Schritt soll den Uebersetzer
                        // aufwecken und nicht stillschweigend in einem
                        // Sammelzweig verschwinden.
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
            // Kein „OK": Es gibt nichts zu bestätigen. Der einzige sinnvolle
            // Ausweg ist das Abbrechen — und der gehört an die Stelle, an der
            // man ihn erwartet.
            TextButton(onClick = { aktionen.abortCheckAb() }) {
                Text(stringResource(R.string.common_cancel))
            }
        }
    )
}
