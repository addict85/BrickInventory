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
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.ladeUpdate
import ch.brickinventoryapp.ui.starteInstallation
import ch.brickinventoryapp.ui.updateHinweisSchliessen
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * „Es gibt eine neue Fassung — jetzt aktualisieren?"
 *
 * ── Marcos Wunsch, und die Vorgabe, die er damit ersetzt ────────────────────
 *
 * „Kannst du noch umsetzen, dass direkt beim Start ein Popup erscheint (mit
 * Updaten, Ja/Nein), wenn es eine neue Version gibt? Aktuell wird nur eine
 * Kugel in den Einstellungen angezeigt was oft übersehen wird."
 *
 * Frueher galt: „beim Start still pruefen, nie von allein laden" — und daraus
 * war ein Punkt am Konto-Symbol geworden, ausdruecklich MIT der Begruendung,
 * ein Dialog beim Start waere das Gegenteil davon (MainScaffold.kt). Der Punkt
 * hat den einen Teil erfuellt (nicht draengen) und den anderen verfehlt
 * (bemerkt werden).
 *
 * Die alte Vorgabe faellt damit nicht ganz weg, sondern nur zur Haelfte:
 * Geladen wird weiterhin NIE von allein. Dieser Dialog fragt; der Ladevorgang
 * beginnt erst auf „Jetzt aktualisieren". Das ist der Unterschied zwischen
 * „draengen" und „automatisch handeln", und nur das Zweite war je verboten.
 *
 * ── Warum der Dialog offen bleibt, waehrend geladen wird ────────────────────
 *
 * Wer hier „Ja" sagt, hat den Vorgang HIER angestossen. Faende er danach
 * nichts mehr vor, saehe der Knopf aus, als haette er nichts getan — der
 * Fortschritt steht sonst nur in den Einstellungen, wo dieser Nutzer gerade
 * nicht ist. Der Dialog begleitet deshalb den ganzen Weg: fragen, laden,
 * installieren lassen.
 *
 * ── Was er NICHT tut ────────────────────────────────────────────────────────
 *
 * Er erscheint nicht, solange nichts gefunden wurde, und nicht mehr, wenn der
 * Nutzer „Spaeter" gewaehlt hat (fuer diesen App-Lauf, siehe
 * UpdateUiState.dialogAbgelehnt). Er ist NICHT abbrechbar durch Tippen
 * daneben, waehrend geladen wird — ein halb geladenes APK ohne sichtbaren
 * Vorgang waere schlechter als ein Dialog, der stehen bleibt.
 */
@Composable
fun UpdateDialog(vm: MainViewModel) {
    val zustand by vm.updateState.collectAsStateWithLifecycle()
    val neuere = zustand.neuereFassung ?: return
    if (zustand.dialogAbgelehnt) return
    val ctx = LocalContext.current

    val laedt = zustand.fortschritt != null
    val schliessen = { vm.updateHinweisSchliessen() }

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
                zustand.bereitZurInstallation -> TextButton(onClick = { vm.starteInstallation() }) {
                    Text(stringResource(R.string.update_install))
                }
                laedt -> {}
                else -> TextButton(onClick = { vm.ladeUpdate() }) {
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
