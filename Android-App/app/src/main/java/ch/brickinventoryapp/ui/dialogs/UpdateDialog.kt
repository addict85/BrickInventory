package ch.brickinventoryapp.ui.dialogs

// Sammel-Importe wie in den Nachbardialogen (BarcodeResultDialog.kt,
// SetPruefungDialog.kt) — siehe die Begruendung dort.
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.viewmodel.UpdateViewModel

/**
 * „Es gibt eine neue Fassung — jetzt aktualisieren?“ Ein Dialog beim Start, weil
 * ein Punkt am Konto-Symbol leicht übersehen wird. Geladen wird trotzdem nie von
 * allein: Der Dialog fragt, der Ladevorgang beginnt erst auf „Jetzt aktualisieren“
 * — fragen ist nicht automatisch handeln.
 *
 * Er bleibt offen, während geladen wird: Wer hier „Ja“ sagt, hat den Vorgang hier
 * angestossen; der Fortschritt stünde sonst nur in den Einstellungen, wo dieser
 * Nutzer gerade nicht ist. Er begleitet den Weg: fragen, laden, installieren
 * lassen.
 *
 * Er erscheint nicht, solange nichts gefunden wurde, und nicht mehr nach „Später“
 * (für diesen App-Lauf, siehe UpdateUiState.dialogAbgelehnt). Während des Ladens
 * schliesst ihn kein Tippen daneben — ein halb geladenes APK ohne sichtbaren
 * Vorgang wäre schlechter als ein Dialog, der stehen bleibt.
 */
@Composable
fun UpdateDialog(selbstUpdate: UpdateViewModel) {
    val zustand by selbstUpdate.updateState.collectAsStateWithLifecycle()
    val neuere = zustand.neuereFassung ?: return
    if (zustand.dialogAbgelehnt) return
    val ctx = LocalContext.current

    val laedt = zustand.fortschritt != null
    val schliessen = { selbstUpdate.updateHinweisSchliessen() }

    AlertDialog(
        // Waehrend des Ladens nicht wegtippbar — siehe der Kopf dieser Datei.
        onDismissRequest = { if (!laedt) schliessen() },
        title = { Text(stringResource(R.string.update_dialog_title)) },
        text = {
            Column {
                Text(stringResource(R.string.update_dialog_text,
                    neuere.versionName, ch.brickinventoryapp.BuildConfig.VERSION_NAME))
                zustand.fortschritt?.let { p ->
                    Spacer(Modifier.height(Abstaende.mittel))
                    Text(stringResource(R.string.update_downloading, p),
                        style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(Abstaende.winzig))
                    LinearProgressIndicator(
                        progress = { p / 100f },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (zustand.erlaubnisFehlt) {
                    Spacer(Modifier.height(Abstaende.mittel))
                    Text(stringResource(R.string.update_permission_needed),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                zustand.fehler?.let { f ->
                    Spacer(Modifier.height(Abstaende.mittel))
                    Text(f, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = {
            when {
                // Die Systemerlaubnis fehlt: Der einzige Knopf, der jetzt
                // weiterhilft, fuehrt in die Systemeinstellungen.
                zustand.erlaubnisFehlt -> TextButton(onClick = {
                    ctx.startActivity(ch.brickinventoryapp.util.erlaubnisAbsicht(ctx))
                }) { Text(stringResource(R.string.update_permission_grant)) }
                // Liegt schon auf der Platte (etwa weil der System-Installer
                // abgebrochen wurde): nicht noch einmal laden.
                zustand.bereitZurInstallation -> TextButton(onClick = { selbstUpdate.starteInstallation() }) {
                    Text(stringResource(R.string.update_install))
                }
                laedt -> {}
                else -> TextButton(onClick = { selbstUpdate.ladeUpdate() }) {
                    Text(stringResource(R.string.update_dialog_now))
                }
            }
        },
        dismissButton = {
            // Waehrend des Ladens kein „Spaeter": Der Vorgang laeuft, und ein
            // Knopf, der ihn nicht anhaelt, aber so aussieht, waere eine
            // Zusage, die der Dialog nicht einhalten kann.
            if (!laedt) TextButton(onClick = schliessen) {
                Text(stringResource(R.string.update_dialog_later))
            }
        },
    )
}
