package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.automirrored.filled.Label
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.Preisalarm
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.util.resolveThumbUrl
import coil3.ImageLoader
import ch.brickinventoryapp.ui.AppViewModel
import ch.brickinventoryapp.ui.viewmodel.EinstellungenViewModel
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.theme.Abstaende
import kotlinx.coroutines.launch

/**
 * Alle Preisalarme an einem Ort — ändern und löschen, wie die Rubrik der Webapp.
 * Der Zustand steht in der Zeile, weil ein Set zwei Alarme haben kann; der letzte
 * Preis steht dabei, weil eine Schwelle ohne ihn nicht zu beurteilen ist.
 * Gespeichert wird beim Knopf, nicht beim Tippen. Löschen fragt nach; die Zeile
 * öffnet das Set nur, wenn es in der Sammlung liegt (ein Alarm überlebt das
 * Entfernen des Sets).
 */
@Composable
internal fun PreisalarmeCard(
    vm: EinstellungenViewModel,
    imageLoader: ImageLoader,
    serverUrl: String,
    onSetClick: (String) -> Unit,
) {
    val uebersicht by vm.alarmUebersicht.collectAsStateWithLifecycle()
    // Die Rueckfrage haelt die ZEILE fest, nicht nur ein Ja/Nein: Der Text
    // nennt das Set, und beim Bestaetigen braucht es beide Teile des
    // Schluessels (Set und Zustand).
    var fragtLoeschen by remember { mutableStateOf<Preisalarm?>(null) }

    LaunchedEffect(Unit) { vm.ladeAlarmUebersicht() }

    SettingsCard(
        title = stringResource(R.string.alerts_group),
        icon = Icons.Default.NotificationsActive,
    ) {
        Text(stringResource(R.string.alerts_intro),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = Abstaende.klein))

        // `geladen` und nicht nur „Liste leer": Beim Aufbau stuende sonst kurz
        // „keine Alarme gesetzt", obwohl noch gar nichts abgerufen wurde.
        if (uebersicht.geladen && uebersicht.alarme.isEmpty()) {
            Text(stringResource(R.string.alerts_empty),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (a in uebersicht.alarme) {
            // Schluessel ist (Set, Zustand) — beides, sonst traegt das Feld des
            // einen Alarms den Wert des anderen, wenn ein Set beide hat.
            var wert by rememberSaveable(a.setNumber + a.condition) {
                mutableStateOf(a.schwelle.toString())
            }
            // Reihenfolge wie in den Finanzen und in der Webapp: heruntergeladene
            // Kopie, eigene Adresse, Katalog. Fuer ein Set, das man nicht besitzt,
            // bleibt nur die letzte — und das ist beim Preisalarm der haeufige Fall.
            val bildUrl = resolveThumbUrl(serverUrl, a.imageLocal, a.imageUrl)
                ?: a.setImgUrl
            // Nur anklickbar, wenn es die Detailansicht ueberhaupt gibt. `Modifier`
            // ohne `clickable` heisst zugleich: kein Wellenschlag beim Tippen, also
            // sieht man dem Eintrag an, dass da nichts kommt.
            val zeile = if (a.besitzt)
                Modifier.fillMaxWidth().clickable(role = Role.Button) { onSetClick(a.setNumber) }
            else Modifier.fillMaxWidth()
            // Abstand innerhalb eines Alarms: Er ist ein Kind der Karte, deren Abstände hier
            // nicht greifen. Aussen zwischen Kopf und Schwelle, innen haarfein zwischen
            // Nummer, Name und Plakette, damit die drei eine Einheit bleiben.
            Column(zeile.padding(vertical = Abstaende.winzig),
                   verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    FinanzBild(bildUrl, imageLoader, a.name)
                    Column(Modifier.weight(1f),
                           verticalArrangement = Arrangement.spacedBy(Abstaende.haar)) {
                        // Erst benennen, dann setzen: Eine Zeichenkette mit
                        // mehrzeiliger Interpolation ist gueltig und trotzdem
                        // die Zeile, die beim naechsten Anfassen kippt.
                        val zustand = if (a.condition == "U")
                            stringResource(R.string.condition_used)
                        else stringResource(R.string.condition_new)
                        Text("${a.setNumber}  $zustand",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold)
                        a.name?.let {
                            Text(it, style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                            AlarmZustandPlakette(a.ausgeloest)
                            a.zuletztPreis?.let {
                                Text(stringResource(R.string.alerts_last,
                                        ch.brickinventoryapp.util.fmtMoney(it, a.currencyCode)),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    IconButton(onClick = { fragtLoeschen = a }) {
                        Icon(Icons.Default.Delete, stringResource(R.string.alerts_delete),
                            tint = MaterialTheme.colorScheme.error)
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    Text(if (a.richtung == "unter") stringResource(R.string.alerts_below)
                         else stringResource(R.string.alerts_above),
                        style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(
                        value = wert,
                        // Der Filter fehlte hier, die Zahlentastatur stand schon
                        // da. Das ist die gefaehrlichere Haelfte: Die
                        // Tastaturwahl ist eine Bitte, keine Zusicherung —
                        // angestoepselte Tastatur und Zwischenablage liefern
                        // trotzdem Buchstaben, und unten wurde daraus eine 0.
                        onValueChange = { wert = NumericInput.price(it) },
                        singleLine = true,
                        suffix = { Text(a.currencyCode) },
                        keyboardOptions = NumericInput.preisTastatur(),
                        modifier = Modifier.weight(1f),
                    )
                    // Der Knopf erscheint nur, wenn eine andere Zahl im Feld steht — ein dauerhaft
                    // sichtbarer Haken las sich wie „scharf“. Verglichen wird die Zahl, nicht der
                    // Text. Ohne lesbare Zahl gibt es keinen Knopf: Eine Schwelle von 0 meldet nie
                    // oder immer.
                    val zahl = wert.replace(',', '.').toDoubleOrNull()
                    if (zahl != null && zahl != a.schwelle) {
                        IconButton(onClick = {
                            vm.aendereAlarmSchwelle(a.setNumber, a.condition, a.richtung, zahl)
                        }) {
                            Icon(Icons.Default.Save, stringResource(R.string.settings_save),
                                tint = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            }
        }
    }

    // Rueckfrage vor dem Loeschen — wie in der Webapp. Ein Alarm ist mit einem
    // Fingertipp weg und kommt nicht wieder; die Schwelle muesste man neu suchen.
    fragtLoeschen?.let { a ->
        AlertDialog(
            onDismissRequest = { fragtLoeschen = null },
            title = { Text(stringResource(R.string.alerts_delete)) },
            text = { Text(stringResource(R.string.alerts_confirm_delete, a.setNumber)) },
            confirmButton = {
                TextButton(onClick = {
                    fragtLoeschen = null
                    vm.loescheAlarm(a.setNumber, a.condition)
                }) {
                    Text(stringResource(R.string.common_delete),
                         color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { fragtLoeschen = null }) {
                    Text(stringResource(R.string.common_cancel))
                }
            },
        )
    }
}

/**
 * „scharf“ oder „unscharf“ ohne Farbe lesbar: Wort, Form (gefüllt/umrandet) und
 * Zeichen (● / ○) tragen es je einzeln. Farbe nur als Zugabe und nicht grün gegen
 * rot — bei Rot-Grün-Schwäche wäre das zweimal dasselbe. `secondaryContainer`
 * bringt jedes Design als „hervorgehoben, nicht dringend“ mit.
 */
@Composable
private fun AlarmZustandPlakette(ausgeloest: Boolean) {
    val text = stringResource(if (ausgeloest) R.string.alerts_fired else R.string.alerts_armed)
    // Gefuellt = scharf, umrandet = unscharf. Die Flaeche ist der Unterschied,
    // den man auch dann sieht, wenn die beiden Farben gleich aussehen.
    Surface(
        shape = Formen.chip,
        color = if (ausgeloest) Color.Transparent
                else MaterialTheme.colorScheme.secondaryContainer,
        border = if (ausgeloest)
            BorderStroke(1.dp, MaterialTheme.colorScheme.outline) else null,
    ) {
        Text(
            text,
            style = MaterialTheme.typography.labelSmall,
            // Auch das Gewicht traegt mit: Ein scharfer Alarm ist der Zustand,
            // auf den es ankommt.
            fontWeight = if (ausgeloest) FontWeight.Normal else FontWeight.SemiBold,
            color = if (ausgeloest) MaterialTheme.colorScheme.onSurfaceVariant
                    else MaterialTheme.colorScheme.onSecondaryContainer,
            modifier = Modifier.padding(
                horizontal = Abstaende.winzig, vertical = Abstaende.haar),
        )
    }
}

/**
 * Der Schalter für die Preisalarm-Meldungen auf diesem Gerät; die E-Mail des
 * Servers ist die kontobezogene Hälfte. Die Berechtigung (ab Android 13) wird erst
 * hier erfragt, wo daneben steht, wofür sie ist. Der Schalter bleibt an, auch wenn
 * sie verweigert wird: Er sagt „ich will das“, die Berechtigung „das System lässt
 * es zu“ — wer sie später erteilt, bekommt die Meldungen ohne weiteres Zutun.
 */
@Composable
internal fun PreisalarmCard(vm: AppViewModel) {
    val context = androidx.compose.ui.platform.LocalContext.current
    // Siehe AcquisitionManagementScreen: LocalResources statt Context, weil
    // Lint LocalContextGetResourceValueCall als ERROR meldet und der
    // Platzhalter erst aus der Ausnahme entsteht.
    val resn = androidx.compose.ui.platform.LocalResources.current
    val bereich = rememberCoroutineScope()
    // Direkt aus den Einstellungen, nicht ueber AppUiState: eine
    // Geraete-Einstellung, genau wie die drei Netzerlaubnisse in
    // MonitoringSections. Ein weiteres Feld im gemeinsamen Zustand waere nur
    // eine zweite Fassung derselben Wahrheit.
    val an by vm.prefs.alarmMeldungenAn.collectAsStateWithLifecycle(initialValue = false)

    val frage = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission()
    ) { /* Antwort egal — Begruendung im Kommentar ueber dieser Funktion. */ }

    SettingsCard(
        title = stringResource(R.string.detail_alert),
        icon = Icons.Default.Notifications,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.alert_notify), style = MaterialTheme.typography.bodyMedium)
                Text(stringResource(R.string.alert_notify_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Switch(
                checked = an,
                onCheckedChange = { neu ->
                    // Die Berechtigung ZUERST und auf dem Hauptthread: Sie
                    // oeffnet einen Systemdialog, und der gehoert nicht hinter
                    // eine Hintergrundarbeit.
                    if (neu && android.os.Build.VERSION.SDK_INT >= 33) {
                        frage.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                    }
                    bereich.launch {
                        vm.prefs.setzeAlarmMeldungen(neu)
                        // ── Nicht auf dem Hauptthread ──
                        //
                        // Der Auftrag folgt dem Schalter sofort, sonst wäre „eingeschaltet“ eine
                        // Stunde lang ohne Wirkung. Beim ersten Zugriff liest WorkManager von der
                        // Platte; auf dem Hauptthread brachte genau das die App zum Absturz.
                        // einplanen() fängt selbst und gibt den Fehler zurück, damit ein Schalter
                        // auf „an“ ohne Wirkung nicht unbemerkt bleibt.
                        val fehler = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                            ch.brickinventoryapp.alarm.PreisalarmWorker.einplanen(context, neu)
                        }
                        if (fehler != null) {
                            // Klasse und Meldung: Erst der Klassenname sagt, ob etwas fehlt oder
                            // etwas schiefging.
                            vm.showSnackbar(resn.getString(
                                R.string.alert_schedule_failed,
                                "${fehler::class.java.simpleName}: ${fehler.message ?: "—"}"))
                        }
                    }
                },
            )
        }
    }
}
