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
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.Pruefphase
import ch.brickinventoryapp.ui.brichPruefungAb

/**
 * „Wird geprüft" — die Anzeige zwischen Scan und Zwischendialog.
 *
 * ── Warum ein Dialog und keine Schnellmeldung ───────────────────────────────
 * Vorher stand hier eine Snackbar („Suche Set für …"). Die hat drei Nachteile,
 * und alle drei sind genau das, was Marco gemeldet hat:
 *
 *   1. Sie verschwindet nach ein paar Sekunden von selbst — die Prüfung läuft
 *      aber weiter. Danach sieht der Bildschirm untätig aus, obwohl er es
 *      nicht ist.
 *   2. Sie hält nichts an. Der Scanner-Bildschirm ist zu diesem Zeitpunkt
 *      bereits geschlossen (nav/ToolsGraph.kt ruft `popBackStack()` vor der
 *      Auflösung), man kann ihn also sofort wieder öffnen und das nächste Set
 *      scannen, während das vorige noch geprüft wird.
 *   3. Sie nennt beim Texterkennungs-Weg gar nichts, weil es dort nie eine gab.
 *
 * Ein Dialog löst alle drei: Er bleibt, solange die Frage offen ist, er legt
 * sich über den Weg zurück zum Scanner, und er nennt die Nummer, um die es
 * geht.
 *
 * ── Was er NICHT anzeigt ────────────────────────────────────────────────────
 * Das Erfassen selbst. Marcos Regel: „Erst das effektive Hinzufügen soll im
 * Hintergrund passieren." Sobald die Bestandsfrage beantwortet ist, ist der
 * Dialog weg — Teile, Anleitungen und Preise lädt der Server ohnehin im
 * Hintergrund nach.
 *
 * Der Bildschirm holt hier nichts selbst (BildschirmHoltDatenNichtSelbstTest);
 * er liest einen Fluss und ruft eine ViewModel-Funktion.
 */
@Composable
fun SetPruefungDialog(vm: MainViewModel) {
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
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    when (schritt.phase) {
                        Pruefphase.BARCODE -> stringResource(R.string.pruef_barcode, schritt.bezeichner)
                        Pruefphase.BESTAND -> stringResource(R.string.pruef_bestand, schritt.bezeichner)
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
