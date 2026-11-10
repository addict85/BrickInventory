package ch.brickinventoryapp.konto.ui.screens

import ch.brickinventoryapp.model.fach.Zustand
import android.os.Build
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import ch.brickinventoryapp.ui.components.SperrGrund
import ch.brickinventoryapp.ui.components.SegmentWahl
import ch.brickinventoryapp.ui.components.Rueckfrage
import ch.brickinventoryapp.ui.components.Ansage
import ch.brickinventoryapp.ui.components.SchalterZeile
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.ui.model.PreisalarmAnsicht
import androidx.compose.foundation.text.KeyboardActions
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.model.util.resolveThumbUrl
import coil3.ImageLoader
import ch.brickinventoryapp.konto.ui.viewmodel.EinstellungenAktionen
import ch.brickinventoryapp.konto.ui.*
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.zustand.ui.*
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.ErklaerText
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.ui.util.fmtEingabe
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.gemeinsam.ui.FinanzBild
import ch.brickinventoryapp.ui.components.SettingsCard
import ch.brickinventoryapp.gemeinsam.ui.Zustandszeile

/**
 * Alle Preisalarme an einem Ort — ändern und löschen wie im Web. Der letzte Preis
 * steht dabei, weil eine Schwelle ohne ihn nicht zu beurteilen ist; die Zeile
 * öffnet das Set nur, wenn es in der Sammlung liegt.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun PreisalarmeCard(
    uebersicht: AlarmUebersichtUiState,
    aktionen: EinstellungenAktionen,
    imageLoader: ImageLoader,
    serverUrl: String,
    onSetClick: (String) -> Unit,
) {
    // Die Rueckfrage haelt die ZEILE fest, nicht nur ein Ja/Nein: Der Text
    // nennt das Set, und beim Bestaetigen braucht es beide Teile des
    // Schluessels (Set und Zustand).
    var fragtLoeschen by remember { mutableStateOf<PreisalarmAnsicht?>(null) }

    SettingsCard(
        title = stringResource(R.string.alerts_liste_titel),
        icon = Icons.Default.NotificationsActive,
    ) {
        ErklaerText(stringResource(R.string.alerts_intro),
            stringResource(R.string.alerts_intro_more), stil = MaterialTheme.typography.bodySmall,
            thema = stringResource(R.string.alerts_group))

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
            // Als Betrag wie überall („750.00“), nicht als Rohzahl „750.0“.
            var wert by rememberSaveable(a.setNumber + a.condition) {
                mutableStateOf(fmtEingabe(a.schwelle))
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
                Modifier.fillMaxWidth().clickable(onClickLabel = stringResource(R.string.cd_set_oeffnen), role = Role.Button) { onSetClick(a.setNumber) }
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
                        // Der Name zuerst wie in der Sammlung; Nummer und Zustand leiser
                        // darunter. Ohne Namen trägt die Nummer die Zeile.
                        val zustand = if (a.condition == Zustand.GEBRAUCHT)
                            stringResource(R.string.condition_used)
                        else stringResource(R.string.condition_new)
                        Text(a.name ?: a.setNumber,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold)
                        Text(if (a.name != null) "${a.setNumber} · $zustand" else zustand,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        // FlowRow: In einer Row nahm die Plakette die ganze Breite, und „zuletzt …“
                        // brach Zeichen für Zeichen um. So rückt der Preis darunter, wenn es eng wird.
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                            verticalArrangement = Arrangement.spacedBy(Abstaende.haar)) {
                            AlarmZustandPlakette(a.ausgeloest)
                            a.zuletztPreis?.let {
                                Text(stringResource(R.string.alerts_last,
                                        fmtMoney(it, a.currencyCode)),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    // Leise wie jede Zeilenaktion: Rot je Zeile übertönte die Preise; die
                    // Rückfrage danach trägt das Gewicht.
                    MitTooltip(stringResource(R.string.alerts_delete_fuer, a.name ?: a.setNumber)) {
                        IconButton(onClick = { fragtLoeschen = a }) {
                            Icon(Icons.Default.Delete, stringResource(R.string.alerts_delete_fuer, a.name ?: a.setNumber),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                // Ein Speichermodell wie im Set- und Merkposten-Detail: Getipptes speichert nach
                // der Ruhezeit von selbst (im ViewModel, damit es das Verlassen übersteht), die
                // Zeile darunter bestätigt. Die Richtung steht als Beschriftung im Feld, so
                // beginnen alle Felder an derselben Stelle.
                val zahl = Alarmeingabe.zahl(wert)
                // Die Richtung umschaltbar wie in der Web-App; gespeichert wird sofort.
                SegmentWahl(
                    optionen = listOf("unter" to stringResource(R.string.detail_alert_chip_below),
                                      "ueber" to stringResource(R.string.detail_alert_chip_above)),
                    gewaehlt = a.richtung,
                    onWahl = { neu -> if (neu != a.richtung) aktionen.aendereAlarmSchwelle(a.setNumber, a.condition, neu, zahl ?: a.schwelle) },
                    modifier = Modifier.widthIn(max = BETRAG_BREITE),
                )
                OutlinedTextField(
                    value = wert,
                    onValueChange = { roh ->
                        wert = NumericInput.price(roh)
                        aktionen.setzeAlarmSchwelle(a.setNumber, a.condition, a.richtung, wert)
                    },
                    singleLine = true,
                    label = { Text(stringResource(if (a.richtung == "unter") R.string.detail_alert_chip_below
                                                  else R.string.detail_alert_chip_above)) },
                    // Vorangestellt wie jeder Betrag der App („CHF 750.00“).
                    prefix = { Text(a.currencyCode + "\u00A0") },
                    // Nur „Gespeichert“: Richtung, Betrag und Zustand stehen schon in Feld und
                    // Plakette, die ganze Wiederholung darunter verdoppelte jede Zeile.
                    supportingText = {
                        if (zahl == a.schwelle) Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Abstaende.haar)) {
                            Icon(Icons.Default.Check, null, Modifier.size(mitSchrift(14.dp)))
                            Text(stringResource(R.string.vm_saved))
                        } else Text(stringResource(R.string.detail_alert_hint))
                    },
                    keyboardOptions = NumericInput.preisTastatur(),
                    // „Fertig“ speichert sofort, ohne die Ruhezeit abzuwarten.
                    keyboardActions = KeyboardActions(onDone = {
                        if (zahl != null && zahl != a.schwelle) aktionen.aendereAlarmSchwelle(a.setNumber, a.condition, a.richtung, zahl)
                    }),
                    shape = Formen.feld,
                    // Ein Betrag, keine Zeile Text: auf dem Tablet nicht über die ganze Karte.
                    modifier = Modifier.widthIn(max = BETRAG_BREITE).fillMaxWidth(),
                )
                Ansage(if (zahl == a.schwelle) stringResource(R.string.vm_saved) else null)
            }
        }
        AlarmAnlegen(aktionen)
    }

    // Rueckfrage vor dem Loeschen — wie in der Webapp. Ein Alarm ist mit einem
    // Fingertipp weg und kommt nicht wieder; die Schwelle muesste man neu suchen.
    fragtLoeschen?.let { a ->
        Rueckfrage(
            titel = stringResource(R.string.alerts_delete),
            text = stringResource(R.string.alerts_confirm_delete, a.name ?: a.setNumber),
            bestaetigen = stringResource(R.string.common_delete),
            onBestaetigen = {
                fragtLoeschen = null
                aktionen.loescheAlarm(a.setNumber, a.condition)
            },
            onAbbrechen = { fragtLoeschen = null },
        )
    }
}

/**
 * „Preisalarm anlegen“ wie in der Web-App: Setnummer, Zustand, Richtung und Schwelle.
 * Ohne Nummer oder Schwelle bleibt der Knopf gesperrt, und der Satz darüber sagt warum.
 */
@Composable
private fun AlarmAnlegen(aktionen: EinstellungenAktionen) {
    var nummer by rememberSaveable { mutableStateOf("") }
    var zustand by rememberSaveable { mutableStateOf(Zustand.NEU) }
    var richtung by rememberSaveable { mutableStateOf("unter") }
    var schwelle by rememberSaveable { mutableStateOf("") }
    HorizontalDivider()
    Text(stringResource(R.string.alerts_anlegen_titel), style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
    OutlinedTextField(
        value = nummer, onValueChange = { nummer = NumericInput.setNumber(it) },
        label = { Text(stringResource(R.string.gallery_set_number)) }, singleLine = true,
        keyboardOptions = NumericInput.setnummerTastatur(), shape = Formen.feld,
        modifier = Modifier.widthIn(max = BETRAG_BREITE).fillMaxWidth(),
    )
    Zustandszeile(zustand = zustand, onZustand = { zustand = it }, modifier = Modifier.widthIn(max = BETRAG_BREITE))
    SegmentWahl(
        optionen = listOf("unter" to stringResource(R.string.detail_alert_chip_below),
                          "ueber" to stringResource(R.string.detail_alert_chip_above)),
        gewaehlt = richtung, onWahl = { richtung = it }, modifier = Modifier.widthIn(max = BETRAG_BREITE),
    )
    OutlinedTextField(
        value = schwelle, onValueChange = { schwelle = NumericInput.price(it) },
        label = { Text(stringResource(R.string.wanted_threshold)) }, singleLine = true,
        keyboardOptions = NumericInput.preisTastatur(), shape = Formen.feld,
        modifier = Modifier.widthIn(max = BETRAG_BREITE).fillMaxWidth(),
    )
    val bereit = nummer.isNotBlank() && (Alarmeingabe.zahl(schwelle) ?: 0.0) > 0.0
    if (!bereit) SperrGrund(stringResource(R.string.alerts_anlegen_sperrgrund))
    Button(
        onClick = { aktionen.legeAlarmAn(nummer, zustand, richtung, schwelle); nummer = ""; schwelle = "" },
        enabled = bereit, modifier = Modifier.widthIn(max = BETRAG_BREITE).fillMaxWidth(),
    ) { Text(stringResource(R.string.alerts_anlegen)) }
}

/** Breite eines Betragsfelds: Platz für Beschriftung, fünf Stellen und Währung. */
private val BETRAG_BREITE = 320.dp

/**
 * „Aktiv“ oder „Ausgelöst“ ohne Farbe lesbar: Wort und Form (gefüllt/umrandet) tragen
 * es je einzeln. Farbe nur als Zugabe und nicht grün gegen rot — bei Rot-Grün-Schwäche
 * wäre das zweimal dasselbe. `secondaryContainer` bringt jedes Design als
 * „hervorgehoben, nicht dringend“ mit.
 */
@Composable
private fun AlarmZustandPlakette(ausgeloest: Boolean) {
    val text = stringResource(if (ausgeloest) R.string.alerts_fired else R.string.alerts_armed)
    // Gefuellt = aktiv, umrandet = ausgeloest. Die Flaeche ist der Unterschied,
    // den man auch dann sieht, wenn die beiden Farben gleich aussehen.
    Surface(
        shape = Formen.chip,
        color = if (ausgeloest) Color.Transparent
                else MaterialTheme.colorScheme.secondaryContainer,
        border = if (ausgeloest)
            BorderStroke(1.dp, MaterialTheme.colorScheme.outline) else null,
    ) {
        // Ein Wort, eine Zeile: Was der ausgelöste Alarm abwartet, sagt die Zeile unter dem Feld.
        Text(
            text,
            maxLines = 1,
            style = MaterialTheme.typography.bodySmall,
            // Auch das Gewicht traegt mit: Ein aktiver Alarm ist der Zustand,
            // auf den es ankommt.
            fontWeight = if (ausgeloest) FontWeight.Normal else FontWeight.SemiBold,
            color = if (ausgeloest) MaterialTheme.colorScheme.onSurfaceVariant
                    else MaterialTheme.colorScheme.onSecondaryContainer,
            // Innenabstand wie ein Chip: Mit 4 dp berührte „Ausgelöst“ den Rand.
            modifier = Modifier.padding(
                horizontal = Abstaende.klein, vertical = Abstaende.haar),
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
fun PreisalarmCard(an: Boolean, onUmschalten: (Boolean) -> Unit) {
    val frage = androidx.activity.compose.rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* Antwort egal — Begruendung im Kommentar ueber dieser Funktion. */ }

    SettingsCard(
        title = stringResource(R.string.detail_alert),
        icon = Icons.Default.Notifications,
    ) {
        SchalterZeile(stringResource(R.string.alert_notify), an, { neu ->
            // Die Berechtigung ZUERST und auf dem Hauptthread: Sie öffnet einen
            // Systemdialog, und der gehört nicht hinter eine Hintergrundarbeit.
            if (neu && Build.VERSION.SDK_INT >= 33) {
                frage.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            }
            onUmschalten(neu)
        }, hinweis = stringResource(R.string.alert_notify_hint))
    }
}
