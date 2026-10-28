package ch.brickinventoryapp.ui.dialogs

// Sammel-Importe wie im Nachbardialog (BarcodeResultDialog.kt): `Modifier.size`
// steckt in foundation.layout, und das `by` vor collectAsStateWithLifecycle
// braucht runtime.getValue — beides kommt über die Sternchen mit.
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel
import ch.brickinventoryapp.ui.Pruefphase
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * „Wird geprüft“ — die Anzeige zwischen Scan und Zwischendialog. Ein Dialog statt
 * einer Snackbar, weil eine Snackbar:
 *
 *   1. nach ein paar Sekunden verschwindet, während die Prüfung weiterläuft — der Bildschirm sähe untätig aus;
 *   2. nichts anhält: Der Scanner ist schon geschlossen (nav/ToolsGraph.kt ruft `popBackStack()` vor der Auflösung), man könnte das nächste Set scannen, während das vorige noch geprüft wird;
 *   3. beim Texterkennungs-Weg nichts nennt.
 *
 * Der Dialog bleibt, solange die Frage offen ist, legt sich über den Weg zurück
 * zum Scanner und nennt die Nummer.
 *
 * Das Erfassen selbst zeigt er nicht: Es läuft im Hintergrund. Sobald die
 * Bestandsfrage beantwortet ist, ist er weg; Teile, Anleitungen und Preise lädt
 * der Server ohnehin nach. Der Bildschirm holt nichts selbst
 * (BildschirmHoltDatenNichtSelbstTest); er liest einen Fluss und ruft eine
 * ViewModel-Funktion.
 */
@Composable
fun SetPruefungDialog(vm: ErfassungViewModel) {
    val erfassung by vm.erfassungState.collectAsStateWithLifecycle()
    val schritt = erfassung.pruefung ?: return

    AlertDialog(
        // Nicht per Tipp daneben schliessbar: Das Anhalten IST der Zweck. Wer
        // wirklich weiter will, nimmt den Knopf — dann ist es eine Entscheidung
        // und kein verrutschter Finger.
        onDismissRequest = { },
        title = { Text(stringResource(R.string.pruef_titel), fontWeight = FontWeight.Bold) },
        icon = { CircularProgressIndicator(Modifier.size(24.dp)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                Text(
                    when (schritt.phase) {
                        Pruefphase.BARCODE -> stringResource(R.string.pruef_barcode, schritt.bezeichner)
                        Pruefphase.BESTAND -> stringResource(R.string.pruef_bestand, schritt.bezeichner)
                        // Kein `else`: Ein neuer Schritt soll den Uebersetzer
                        // aufwecken und nicht stillschweigend in einem
                        // Sammelzweig verschwinden.
                        Pruefphase.ANLEGEN_STAMMDATEN ->
                            stringResource(R.string.pruef_anlegen_stammdaten, schritt.bezeichner)
                        Pruefphase.ANLEGEN_BILD ->
                            stringResource(R.string.pruef_anlegen_bild, schritt.bezeichner)
                        Pruefphase.ANLEGEN_ABSCHLUSS ->
                            stringResource(R.string.pruef_anlegen_abschluss, schritt.bezeichner)
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
            TextButton(onClick = { vm.brichPruefungAb() }) {
                Text(stringResource(R.string.common_cancel))
            }
        }
    )
}
