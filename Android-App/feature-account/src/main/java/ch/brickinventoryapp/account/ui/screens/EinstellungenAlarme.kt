package ch.brickinventoryapp.account.ui.screens

import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Zustand
import android.os.Build
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import ch.brickinventoryapp.ui.components.LockReason
import ch.brickinventoryapp.ui.components.SegmentChoice
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.components.Announcement
import ch.brickinventoryapp.ui.components.ToggleRow
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
import androidx.compose.ui.layout.layout
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.model.domain.PriceAlertView
import androidx.compose.foundation.text.KeyboardActions
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.model.util.resolveThumbUrl
import coil3.ImageLoader
import ch.brickinventoryapp.account.ui.viewmodel.EinstellungenAktionen
import ch.brickinventoryapp.account.ui.AlarmUebersichtUiState
import ch.brickinventoryapp.ui.titel
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.ErklaerText
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.util.fmtEingabe
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.shared.ui.FinanzBild
import ch.brickinventoryapp.ui.components.SettingsCard
import ch.brickinventoryapp.shared.ui.Zustandszeile

/**
 * All price alerts in one place — change and delete as in the web. The last price
 * sits alongside, because a threshold can't be judged without it; the row
 * only opens the set if it's in the collection.
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
    // The confirmation records the ROW, not just a yes/no: the text
    // names the set, and confirming needs both parts of the
    // key (set and condition).
    var deleteAsks by remember { mutableStateOf<PriceAlertView?>(null) }

    SettingsCard(
        title = stringResource(R.string.alerts_liste_titel),
        icon = Icons.Default.NotificationsActive,
    ) {
        ErklaerText(stringResource(R.string.alerts_intro),
            stringResource(R.string.alerts_intro_more), stil = MaterialTheme.typography.bodySmall,
            thema = stringResource(R.string.alerts_group))

        // `geladen`, not just "list empty": on build it would otherwise briefly
        // say "no alerts set", even though nothing has been fetched yet.
        if (uebersicht.geladen && uebersicht.alerts.isEmpty()) {
            Text(stringResource(R.string.alerts_empty),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (a in uebersicht.alerts) {
            // Key is (set, condition) — both, otherwise one alert's field would
            // carry the other's value when a set has both.
            // As an amount like everywhere else ("750.00"), not as a raw number "750.0".
            var wert by rememberSaveable(a.setNumber + a.condition) {
                mutableStateOf(fmtEingabe(a.schwelle))
            }
            // Order as in finances and the web app: downloaded
            // copy, own address, catalog. For a set one doesn't own, only
            // the last one is left — and that's the common case for a price alert.
            val bildUrl = resolveThumbUrl(serverUrl, a.imageLocal, a.imageUrl)
                ?: a.setImgUrl
            // Only clickable if the detail view even exists. `Modifier`
            // without `clickable` also means: no ripple on tap, so
            // the entry visibly shows there's nothing to go to.
            val zeile = if (a.besitzt)
                Modifier.fillMaxWidth().clickable(onClickLabel = stringResource(R.string.cd_set_oeffnen), role = Role.Button) { onSetClick(a.setNumber) }
            else Modifier.fillMaxWidth()
            // Spacing within an alert: it's a child of the card, whose spacings don't
            // apply here. Outside between header and threshold, inside hairline-thin between
            // number, name and badge, so the three stay a unit.
            Column(zeile.padding(vertical = Abstaende.tiny),
                   verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    FinanzBild(bildUrl, imageLoader, a.name)
                    Column(Modifier.weight(1f),
                           verticalArrangement = Arrangement.spacedBy(Abstaende.hairline)) {
                        // Name first as in the collection; number and condition quieter
                        // below. Without a name, the number carries the row.
                        val zustand = if (a.condition == Zustand.GEBRAUCHT)
                            stringResource(R.string.condition_used)
                        else stringResource(R.string.condition_new)
                        Text(a.name ?: a.setNumber,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold)
                        Text(if (a.name != null) "${a.setNumber} · $zustand" else zustand,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        // FlowRow: in a Row the badge took the whole width, and "last …"
                        // wrapped character by character. This way the price below moves when it gets tight.
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                            verticalArrangement = Arrangement.spacedBy(Abstaende.hairline)) {
                            AlarmZustandPlakette(a.ausgeloest)
                            a.lastlyPrice?.let {
                                Text(stringResource(R.string.alerts_last,
                                        fmtMoney(it, a.currencyCode)),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    // Quiet like every row action: red per row would drown out the prices; the
                    // confirmation afterward carries the weight.
                    MitTooltip(stringResource(R.string.alerts_delete_fuer, a.name ?: a.setNumber)) {
                        IconButton(onClick = { deleteAsks = a }) {
                            Icon(Icons.Default.Delete, stringResource(R.string.alerts_delete_fuer, a.name ?: a.setNumber),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                // A save model like in the set and watchlist detail: typed text saves on its own
                // after the quiet period (in the ViewModel, so it survives leaving), the
                // row below confirms it. The choice above names the direction; the field is called
                // "threshold" instead of naming it a second time.
                val zahl = Alarmeingabe.zahl(wert)
                // The direction can be toggled as in the web app; saved right away.
                SegmentChoice(
                    optionen = listOf(Alarmrichtung.UNTER to stringResource(R.string.detail_alert_chip_below),
                                      Alarmrichtung.UEBER to stringResource(R.string.detail_alert_chip_above)),
                    gewaehlt = a.richtung,
                    onWahl = { neu -> if (neu != a.richtung) aktionen.changeAlarmThreshold(a.setNumber, a.condition, neu, zahl ?: a.schwelle) },
                    modifier = Modifier.betragsbreite(),
                )
                OutlinedTextField(
                    value = wert,
                    onValueChange = { roh ->
                        wert = NumericInput.price(roh)
                        aktionen.setAlarmThreshold(a.setNumber, a.condition, a.richtung, wert)
                    },
                    singleLine = true,
                    label = { Text(stringResource(R.string.alerts_schwelle)) },
                    // Prefixed like every amount in the app ("CHF 750.00").
                    prefix = { Text(a.currencyCode.code + "\u00A0") },
                    // Just "Saved": direction, amount and condition already sit in the field and
                    // badge, repeating all of it below would double every line.
                    supportingText = {
                        if (zahl == a.schwelle) Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Abstaende.hairline)) {
                            Icon(Icons.Default.Check, null, Modifier.size(withFont(14.dp)))
                            Text(stringResource(R.string.vm_saved))
                        } else Text(stringResource(R.string.detail_alert_hint))
                    },
                    keyboardOptions = NumericInput.priceKeyboard(),
                    // "Done" saves right away, without waiting for the quiet period.
                    keyboardActions = KeyboardActions(onDone = {
                        if (zahl != null && zahl != a.schwelle) aktionen.changeAlarmThreshold(a.setNumber, a.condition, a.richtung, zahl)
                    }),
                    shape = Formen.feld,
                    // An amount, not a line of text: doesn't span the whole card on a tablet.
                    modifier = Modifier.betragsbreite(),
                )
                Announcement(if (zahl == a.schwelle) stringResource(R.string.vm_saved) else null)
            }
        }
        AlarmCreate(aktionen)
    }

    // Confirmation before deleting — as in the web app. An alert is gone with one
    // tap and doesn't come back; the threshold would have to be found again.
    deleteAsks?.let { a ->
        Prompt(
            titel = stringResource(R.string.alerts_delete),
            text = stringResource(R.string.alerts_confirm_delete, a.name ?: a.setNumber),
            bestaetigen = stringResource(R.string.common_delete),
            onBestaetigen = {
                deleteAsks = null
                aktionen.deleteAlarm(a.setNumber, a.condition)
            },
            onAbbrechen = { deleteAsks = null },
        )
    }
}

/**
 * "Create price alert" as in the web app: set number, condition, direction and threshold.
 * Without a number or a threshold the button stays disabled, and the line above says why.
 */
@Composable
private fun AlarmCreate(aktionen: EinstellungenAktionen) {
    var nummer by rememberSaveable { mutableStateOf("") }
    var zustand by rememberSaveable { mutableStateOf(Zustand.NEU) }
    var richtung by rememberSaveable { mutableStateOf(Alarmrichtung.UNTER) }
    var schwelle by rememberSaveable { mutableStateOf("") }
    HorizontalDivider()
    Text(stringResource(R.string.alerts_anlegen_titel), style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
    OutlinedTextField(
        value = nummer, onValueChange = { nummer = NumericInput.setNumber(it) },
        label = { Text(stringResource(R.string.gallery_set_number)) }, singleLine = true,
        keyboardOptions = NumericInput.setNumberKeyboard(), shape = Formen.feld,
        modifier = Modifier.betragsbreite(),
    )
    Zustandszeile(zustand = zustand, onZustand = { zustand = it }, modifier = Modifier.betragsbreite())
    SegmentChoice(
        optionen = listOf(Alarmrichtung.UNTER to stringResource(R.string.detail_alert_chip_below),
                          Alarmrichtung.UEBER to stringResource(R.string.detail_alert_chip_above)),
        gewaehlt = richtung, onWahl = { richtung = it }, modifier = Modifier.betragsbreite(),
    )
    OutlinedTextField(
        value = schwelle, onValueChange = { schwelle = NumericInput.price(it) },
        label = { Text(stringResource(R.string.alerts_schwelle)) }, singleLine = true,
        keyboardOptions = NumericInput.priceKeyboard(), shape = Formen.feld,
        modifier = Modifier.betragsbreite(),
    )
    val bereit = nummer.isNotBlank() && Alarmeingabe.zahl(schwelle) != null
    if (!bereit) LockReason(stringResource(R.string.alerts_anlegen_sperrgrund))
    Button(
        onClick = { aktionen.putAlarmAn(nummer, zustand, richtung, schwelle); nummer = ""; schwelle = "" },
        enabled = bereit, modifier = Modifier.betragsbreite(),
    ) { Text(stringResource(R.string.alerts_anlegen)) }
}

/**
 * Width of an alert's fields and choices: an amount across the whole tablet card would read
 * as a line of text, hence [AMOUNT_WIDTH]. If the card is barely wider (phone), they fill it
 * and end at the same edge as the header and divider, instead of a few dp before it.
 */
private fun Modifier.betragsbreite(): Modifier = layout { messbar, grenzen ->
    val breite = when {
        !grenzen.hasBoundedWidth -> AMOUNT_WIDTH.roundToPx()
        grenzen.maxWidth <= PHONE_CARD.roundToPx() -> grenzen.maxWidth
        else -> minOf(grenzen.maxWidth, AMOUNT_WIDTH.roundToPx())
    }
    val space = messbar.measure(grenzen.copy(minWidth = breite, maxWidth = breite))
    layout(space.width, space.height) { space.place(0, 0) }
}

private val AMOUNT_WIDTH = 320.dp
private val PHONE_CARD = 420.dp

/**
 * "Active" or "Triggered" readable without color: word and shape (filled/outlined) carry
 * it each on their own. Color only as an extra, and not green against red — with
 * red-green color blindness that would be the same thing twice. `secondaryContainer` brings
 * every design its own "highlighted, not urgent" look.
 */
@Composable
private fun AlarmZustandPlakette(ausgeloest: Boolean) {
    val text = stringResource(if (ausgeloest) R.string.alerts_fired else R.string.alerts_armed)
    // Filled = active, outlined = triggered. The surface is the difference
    // you still see even when the two colors look the same.
    Surface(
        shape = Formen.chip,
        color = if (ausgeloest) Color.Transparent
                else MaterialTheme.colorScheme.secondaryContainer,
        border = if (ausgeloest)
            BorderStroke(1.dp, MaterialTheme.colorScheme.outline) else null,
    ) {
        // One word, one line: the line below the field says what the triggered alert is waiting for.
        Text(
            text,
            maxLines = 1,
            style = MaterialTheme.typography.bodySmall,
            // The weight carries it too: an active alert is the state
            // that matters.
            fontWeight = if (ausgeloest) FontWeight.Normal else FontWeight.SemiBold,
            color = if (ausgeloest) MaterialTheme.colorScheme.onSurfaceVariant
                    else MaterialTheme.colorScheme.onSecondaryContainer,
            // Padding like a chip: at 4 dp "Triggered" touched the edge.
            modifier = Modifier.padding(
                horizontal = Abstaende.klein, vertical = Abstaende.hairline),
        )
    }
}

/**
 * The switch for price-alert notifications on this device; the server's email is
 * the account-wide half. The permission (from Android 13) is asked here for the
 * first time, right next to what it's for. The switch stays on even if
 * it's refused: it says "I want this", the permission "the system allows
 * it" — whoever grants it later gets the notifications without any further action.
 */
@Composable
fun PriceAlertCard(an: Boolean, toggleOn: (Boolean) -> Unit) {
    val frage = androidx.activity.compose.rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* The answer doesn't matter — reasoning in the comment above this function. */ }

    SettingsCard(
        title = stringResource(R.string.detail_alert),
        icon = Icons.Default.Notifications,
    ) {
        ToggleRow(stringResource(R.string.alert_notify), an, { neu ->
            // The permission FIRST and on the main thread: it opens a
            // system dialog, and that doesn't belong behind background work.
            if (neu && Build.VERSION.SDK_INT >= 33) {
                frage.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            }
            toggleOn(neu)
        }, hinweis = stringResource(R.string.alert_notify_hint))
    }
}
