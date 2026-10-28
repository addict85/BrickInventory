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
 * Alle Preisalarme — aendern und loeschen.
 *
 * ── Marcos Frage vom 25.09. ──────────────────────────────────────
 *
 *   „Wie finde ich alle Preisalarme?"
 *
 * Gar nicht, war die Antwort: Ein Alarm war nur im Detail SEINES Sets zu
 * sehen. Wer fuenfzig setzt, hatte keinen Ort, an dem sie zusammen stehen, und
 * keinen, an dem er sieht, welche noch scharf sind.
 *
 * ── Dieselbe Rubrik wie in der Webapp ──────────────────────────────
 *
 * Gleiche Reihenfolge (vor den Lagerorten), gleiche Zeile: Setnummer und Name,
 * Zustand daneben — derselbe Set kann zwei Alarme haben, und die Zeilen
 * unterschieden sich sonst nur an einem Buchstaben. Der letzte Preis steht
 * dabei, weil eine Schwelle ohne ihn nicht zu beurteilen ist: „unter 30"
 * heisst etwas anderes bei einem Set, das bei 28 steht, als bei einem, das bei
 * 300 steht.
 *
 * Gespeichert wird beim Knopf und nicht beim Tippen — anders als das
 * Wunsch-Detail (Nachtrag 133), weil hier jeder Tastendruck sonst eine
 * Schreibanfrage ausloeste, waehrend man die Zahl noch eintippt.
 *
 * ── Marcos Nachtrag vom 26.09. ─────────────────────────────────────
 *
 * Vier Dinge, alle aus einer Sitzung vor der App:
 *
 *  1. „Beim Loeschen soll noch nachgefragt werden." Die Webapp fragt seit
 *     jeher (`confirm`), die App loeschte sofort. Ein Alarm ist schnell
 *     angetippt und nicht wiederherstellbar.
 *  2. Ein Vorschaubild je Zeile, wie in den Finanzen — deshalb auch
 *     dasselbe [FinanzBild] und nicht ein zweites, das anders beschnitten
 *     ist.
 *  3. Die Zeile oeffnet die Detailansicht des Sets. Anklickbar ist sie nur,
 *     wenn das Set in der Sammlung liegt: Ein Alarm ueberlebt das Entfernen
 *     des Sets, und der Klick landete sonst auf einer Adresse, die es nicht
 *     gibt.
 *  4. „Das ‚scharf' analog der Webapp mit einem Label anzeigen." Der gruene
 *     Haken, den Marco dafuer hielt, war der SPEICHERN-Knopf — er stand
 *     dauerhaft gruen neben dem Zahlenfeld und sah aus wie eine Zusage. Er
 *     wird jetzt erst sichtbar, wenn der Wert wirklich geaendert wurde, und
 *     der Zustand steht als Plakette da, wie in der Webapp.
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
            // ── Der Abstand INNERHALB eines Alarms (Marcos Befund vom 16.10.) ──
            //
            //   „Bei den Preisalarm kommt das label scharf noch immer direkt
            //    am Feld an."
            //
            // Stimmt, und der Abstand, den SettingsCard seit dem Umbau
            // zwischen seinen Kindern legt, kann hier nichts ausrichten: Ein
            // Alarm ist EIN Kind — eine Spalte aus Kopfzeile und Zeile mit der
            // Schwelle. Innerhalb davon stand gar nichts, und so klebte die
            // Plakette „scharf" (letztes Stueck der Kopfzeile) unmittelbar auf
            // dem Eingabefeld darunter.
            //
            // Der Abstand gehoert deshalb an BEIDE Spalten: an die aeussere
            // zwischen Kopf und Schwelle, an die innere zwischen Nummer, Name
            // und Plakette. Letzterer ist haarfein — die drei gehoeren
            // zusammen und sollen eine Einheit bleiben, nur keine Masse.
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
                                        "${a.currencyCode} ${"%.2f".format(it)}"),
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
                    // Der Knopf erscheint erst, wenn wirklich etwas anderes im
                    // Feld steht — vorher stand hier ein dauerhaft gruener Haken,
                    // und der las sich wie eine Zustandsanzeige („scharf") statt
                    // wie ein Knopf. Verglichen wird die ZAHL und nicht der Text:
                    // „30" und „30.0" sind dasselbe.
                    //
                    // Steht KEINE Zahl im Feld, erscheint der Knopf gar nicht
                    // mehr. Vorher hiess „nicht lesbar" hier `?: true`, also
                    // Knopf da — und ein Druck darauf schrieb ueber `?: 0.0`
                    // eine Schwelle von 0. Die ist keine Schwelle: „unter 0"
                    // meldet nie, „ueber 0" meldet immer. Beides faellt erst
                    // Wochen spaeter auf.
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
 * „scharf" oder „unscharf" — ein Label, das ohne Farbe auskommt.
 *
 * ── Marcos Befund vom 26.09. ───────────────────────────────────────────────
 *
 *   „Ok entschuldige ich habe eine rot grün schwäche. Deshalb sind labels mit
 *    scharf / unscharf für mich einfacher."
 *
 * Bis hierher trugen BEIDE Oberflaechen die Aussage in der Farbe: gruen heisst
 * scharf, grau heisst nicht mehr scharf. Fuer rund acht Prozent der Maenner
 * ist das keine Aussage, sondern zweimal dasselbe. Und der Entschuldigung
 * widerspricht die Sache: Nicht das Auge ist der Fehler, sondern eine
 * Oberflaeche, die eine Information NUR in die Farbe legt.
 *
 * Drei Unterschiede tragen sie jetzt, von denen jeder EINZELN reicht:
 *
 *   1. Das WORT. „scharf" und „unscharf" sind ein Paar — vorher stand dort
 *      „scharf" gegen „hat gemeldet", zwei Saetze ueber verschiedene Dinge.
 *      Was „unscharf" bedeutet, sagt der Einleitungstext der Rubrik, und die
 *      Zeile „zuletzt CHF 28.50" daneben steht ohnehin nur bei einem Alarm,
 *      der gemeldet hat (preisalarm.ts setzt beides in derselben Anweisung).
 *   2. Die FORM: gefuellt gegen umrandet.
 *   3. Das ZEICHEN davor: ● gegen ○, gefuellt gegen hohl.
 *
 * Farbe bleibt, aber nur noch als Zugabe — und ausdruecklich NICHT gruen
 * gegen rot. Das Label nimmt `secondaryContainer`, also die Farbfamilie, die
 * jedes der fuenf Designs fuer „hervorgehoben, aber nicht dringend" mitbringt.
 * Ein gruenes Label waere derselbe Fehler noch einmal, nur freundlicher
 * gemeint.
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
 * Der Schalter fuer die Preisalarm-Meldungen auf DIESEM Geraet.
 *
 * ── Warum er nicht im Konto steht ───────────────────────────────────────────
 *
 * Der Server verschickt bei jedem gerissenen Alarm eine E-Mail — das ist die
 * kontobezogene Haelfte. Diese hier ist die geraetebezogene: Wer dasselbe
 * Konto am Telefon und am Tablet benutzt, will die Meldung in aller Regel nur
 * an einem der beiden. Genau dieselbe Ueberlegung wie beim Vorwaermen und beim
 * Kontofilter.
 *
 * ── Warum die Berechtigung erst hier erfragt wird ───────────────────────────
 *
 * Ab Android 13 ist POST_NOTIFICATIONS eine Laufzeitberechtigung. Sie gleich
 * beim ersten Start zu erfragen waere die uebliche und die schlechtere
 * Loesung: Die Frage kaeme, bevor irgendetwas sie erklaert, und ein Nein ist
 * danach nur noch ueber die Systemeinstellungen zu widerrufen. Hier steht
 * unmittelbar daneben, wofuer sie ist.
 *
 * Der Schalter wird auch dann umgelegt, wenn die Erlaubnis verweigert wird.
 * Das ist Absicht: Die Einstellung sagt „ich will das", die Berechtigung sagt
 * „das System laesst es zu" — zwei verschiedene Dinge. Wer die Erlaubnis
 * spaeter in den Systemeinstellungen nachreicht, bekommt seine Meldungen, ohne
 * hier noch einmal etwas tun zu muessen.
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
                        // ── Nicht auf dem Hauptthread ────────────────────────
                        //
                        // Der Auftrag folgt dem Schalter sofort und nicht erst
                        // beim naechsten App-Start: Sonst waere „eingeschaltet"
                        // eine Stunde lang eine Behauptung ohne Wirkung.
                        //
                        // Aber nicht hier vorne: Beim ERSTEN Zugriff faehrt
                        // WorkManager hoch und liest dabei von der Platte
                        // (der Manifest-Eintrag erklaert, warum das nicht mehr
                        // beim App-Start geschieht). Auf dem Hauptthread einer
                        // sichtbaren Oberflaeche ist das im besten Fall ein
                        // Ruckeln.
                        //
                        // Marcos Befund vom 25.09.: „Sobald ich den Schalter
                        // Preisalarm in der App aktivieren will, wird die App
                        // geschlossen." Dieser Aufruf stand hier ungesichert,
                        // waehrend derselbe Aufruf beim App-Start seit jeher in
                        // einem runCatching steckt. einplanen() faengt jetzt
                        // selbst und GIBT DEN FEHLER ZURUECK — verschluckt wird
                        // er nicht: Ein Schalter auf „an", von dem nie eine
                        // Meldung kommt, ist die zweite Haelfte desselben
                        // Fehlers.
                        val fehler = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                            ch.brickinventoryapp.alarm.PreisalarmWorker.einplanen(context, neu)
                        }
                        if (fehler != null) {
                            // Klasse UND Meldung: Am 25.09. reichte die
                            // Meldung allein („WorkDatabase_Impl.<init> []"),
                            // aber erst der Klassenname sagt, dass es eine
                            // NoSuchMethodException ist — und damit, ob etwas
                            // fehlt oder etwas schiefging. Die naechste
                            // Ursache ist vielleicht weniger gespraechig.
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
