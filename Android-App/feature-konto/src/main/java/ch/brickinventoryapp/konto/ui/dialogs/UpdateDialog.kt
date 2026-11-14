package ch.brickinventoryapp.konto.ui.dialogs

import ch.brickinventoryapp.ui.satz
// Sammel-Importe wie in den Nachbardialogen (BarcodeResultDialog.kt,
// SetPruefungDialog.kt) — siehe die Begruendung dort.
import ch.brickinventoryapp.konto.ui.UpdateUiState
import ch.brickinventoryapp.konto.ui.viewmodel.UpdateAktionen
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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.konto.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.ui.components.LocalAppFassung
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.update.util.erlaubnisAbsicht

/**
 * „Es gibt eine neue Fassung — jetzt aktualisieren?“ Ein Dialog beim Start, weil
 * ein Punkt am Konto-Symbol leicht übersehen wird. Geladen wird trotzdem nie von
 * allein: Der Dialog fragt, der Ladevorgang beginnt erst auf „Jetzt aktualisieren“
 * — fragen ist nicht automatisch handeln.
 */
@Composable
fun UpdateRoute(selbstUpdate: UpdateViewModel) {
    val zustand by selbstUpdate.updateState.collectAsStateWithLifecycle()
    UpdateDialog(zustand, selbstUpdate)
}

@Composable
internal fun UpdateDialog(zustand: UpdateUiState, selbstUpdate: UpdateAktionen) {
    val neuere = zustand.neuereFassung ?: return
    if (zustand.dialogAbgelehnt) return
    val ctx = LocalContext.current

    val laedt = zustand.fortschritt != null
    val schliessen = { selbstUpdate.updateHinweisSchliessen() }

    val titel = stringResource(R.string.update_dialog_title)
    AlertDialog(
        modifier = Modifier.semantics { paneTitle = titel },
        // Waehrend des Ladens nicht wegtippbar — siehe der Kopf dieser Datei.
        onDismissRequest = { if (!laedt) schliessen() },
        title = { Text(titel, Modifier.semantics { heading() }) },
        text = {
            Ueberdeckungsschutz()
            UpdateInhalt(zustand, neuere.versionName)
        },
        confirmButton = {
            when {
                // Die Systemerlaubnis fehlt: Der einzige Knopf, der jetzt
                // weiterhilft, fuehrt in die Systemeinstellungen.
                zustand.erlaubnisFehlt -> TextButton(onClick = {
                    ctx.startActivity(erlaubnisAbsicht(ctx))
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

/** Fassung, Fortschritt und was fehlt — der Text des Dialogs, getrennt vom Rahmen und den Knöpfen. */
@Composable
private fun UpdateInhalt(zustand: UpdateUiState, versionName: String) {
    Column {
        Text(stringResource(R.string.update_dialog_text, versionName, LocalAppFassung.current.name))
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
            Text(f.satz(), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }
    }
}
