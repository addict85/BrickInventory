package ch.brickinventoryapp.account.ui.screens

import android.os.Build
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.layout
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.account.ui.AlarmOverviewUiState
import ch.brickinventoryapp.account.ui.viewmodel.SettingsActions
import ch.brickinventoryapp.data.alarm.AlarmInput
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.PriceAlertView
import ch.brickinventoryapp.model.util.resolveThumbUrl
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.shared.ui.ConditionRow
import ch.brickinventoryapp.shared.ui.FinanceImage
import ch.brickinventoryapp.ui.components.Announcement
import ch.brickinventoryapp.ui.components.ExplainText
import ch.brickinventoryapp.ui.components.LockReason
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.components.SegmentChoice
import ch.brickinventoryapp.ui.components.SettingsCard
import ch.brickinventoryapp.ui.components.ToggleRow
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.title
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.util.fmtInput
import ch.brickinventoryapp.ui.util.fmtMoney
import coil3.ImageLoader

/**
 * All price alerts in one place — change and delete as in the web. The last price
 * sits alongside, because a threshold can't be judged without it; the row
 * only opens the set if it's in the collection.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun PriceAlarmsCard(
    overview: AlarmOverviewUiState,
    actions: SettingsActions,
    imageLoader: ImageLoader,
    serverUrl: String,
    onSetClick: (String) -> Unit,
) {
    // The confirmation records the ROW, not just a yes/no: the text
    // names the set, and confirming needs both parts of the
    // key (set and condition).
    var deleteAsks by remember { mutableStateOf<PriceAlertView?>(null) }

    SettingsCard(
        title = stringResource(R.string.alerts_list_title),
        icon = Icons.Default.NotificationsActive,
    ) {
        ExplainText(stringResource(R.string.alerts_intro),
            stringResource(R.string.alerts_intro_more), style = MaterialTheme.typography.bodySmall,
            theme = stringResource(R.string.alerts_group))

        // `loaded`, not just "list empty": on build it would otherwise briefly
        // say "no alerts set", even though nothing has been fetched yet.
        if (overview.loaded && overview.alerts.isEmpty()) {
            Text(stringResource(R.string.alerts_empty),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (a in overview.alerts) {
            PriceAlarmRow(a, actions, imageLoader, serverUrl, onSetClick) { deleteAsks = a }
        }
        AlarmCreate(actions)
    }

    // Confirmation before deleting — as in the web app. An alert is gone with one
    // tap and doesn't come back; the threshold would have to be found again.
    deleteAsks?.let { a ->
        Prompt(
            title = stringResource(R.string.alerts_delete),
            text = stringResource(R.string.alerts_confirm_delete, a.name ?: a.setNumber),
            confirm = stringResource(R.string.common_delete),
            onConfirm = {
                deleteAsks = null
                actions.deleteAlarm(a.setNumber, a.condition)
            },
            onCancel = { deleteAsks = null },
        )
    }
}

/** One alert: image, name and state above, direction and threshold below; saved as it is typed. */
@Composable
private fun PriceAlarmRow(
    a: PriceAlertView,
    actions: SettingsActions,
    imageLoader: ImageLoader,
    serverUrl: String,
    onSetClick: (String) -> Unit,
    onDelete: () -> Unit,
) {
    // Key is (set, condition) — both, otherwise one alert's field would
    // carry the other's value when a set has both.
    // As an amount like everywhere else ("750.00"), not as a raw number "750.0".
    var value by rememberSaveable(a.setNumber + a.condition) {
        mutableStateOf(fmtInput(a.threshold))
    }
    // Only clickable if the detail view even exists. `Modifier`
    // without `clickable` also means: no ripple on tap, so
    // the entry visibly shows there's nothing to go to.
    val row = if (a.owns)
        Modifier.fillMaxWidth().clickable(onClickLabel = stringResource(R.string.cd_set_open), role = Role.Button) { onSetClick(a.setNumber) }
    else Modifier.fillMaxWidth()
    // Spacing within an alert: it's a child of the card, whose spacings don't
    // apply here. Outside between header and threshold, inside hairline-thin between
    // number, name and badge, so the three stay a unit.
    Column(row.padding(vertical = Spacing.tiny),
           verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
        AlarmRowHeader(a, imageLoader, serverUrl, onDelete)
        // A save model like in the set and watchlist detail: typed text saves on its own
        // after the quiet period (in the ViewModel, so it survives leaving), the
        // row below confirms it. The choice above names the direction; the field is called
        // "threshold" instead of naming it a second time.
        val number = AlarmInput.number(value)
        // The direction can be toggled as in the web app; saved right away.
        SegmentChoice(
            options = listOf(AlarmDirection.BELOW to stringResource(R.string.detail_alert_chip_below),
                              AlarmDirection.OVER to stringResource(R.string.detail_alert_chip_above)),
            chosen = a.direction,
            onChoice = { newValue -> if (newValue != a.direction) actions.changeAlarmThreshold(a.setNumber, a.condition, newValue, number ?: a.threshold) },
            modifier = Modifier.amountWidth(),
        )
        AlarmThresholdField(a, value, number, actions) { value = it }
        Announcement(if (number == a.threshold) stringResource(R.string.vm_saved) else null)
    }
}

/** Image, name, number and condition, state and last price, and the delete button. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AlarmRowHeader(a: PriceAlertView, imageLoader: ImageLoader, serverUrl: String, onDelete: () -> Unit) {
    // Order as in finances and the web app: downloaded
    // copy, own address, catalog. For a set one doesn't own, only
    // the last one is left — and that's the common case for a price alert.
    val imageUrl = resolveThumbUrl(serverUrl, a.imageLocal, a.imageUrl)
        ?: a.setImgUrl
    Row(verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
        FinanceImage(imageUrl, imageLoader, a.name)
        Column(Modifier.weight(1f),
               verticalArrangement = Arrangement.spacedBy(Spacing.hairline)) {
            // Name first as in the collection; number and condition quieter
            // below. Without a name, the number carries the row.
            val condition = if (a.condition == Condition.USED)
                stringResource(R.string.condition_used)
            else stringResource(R.string.condition_new)
            Text(a.name ?: a.setNumber,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold)
            Text(if (a.name != null) "${a.setNumber} · $condition" else condition,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            // FlowRow: in a Row the badge took the whole width, and "last …"
            // wrapped character by character. This way the price below moves when it gets tight.
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.small),
                verticalArrangement = Arrangement.spacedBy(Spacing.hairline)) {
                AlarmStateBadge(a.triggered)
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
        WithTooltip(stringResource(R.string.alerts_delete_for, a.name ?: a.setNumber)) {
            IconButton(onClick = onDelete) {
                Icon(Icons.Default.Delete, stringResource(R.string.alerts_delete_for, a.name ?: a.setNumber),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** The threshold of one alert; [number] is the typed amount, null while it is not one. */
@Composable
private fun AlarmThresholdField(
    a: PriceAlertView,
    value: String,
    number: Money?,
    actions: SettingsActions,
    onValue: (String) -> Unit,
) {
    OutlinedTextField(
        value = value,
        onValueChange = { raw ->
            val price = NumericInput.price(raw)
            onValue(price)
            actions.setAlarmThreshold(a.setNumber, a.condition, a.direction, price)
        },
        singleLine = true,
        label = { Text(stringResource(R.string.alerts_threshold)) },
        // Prefixed like every amount in the app ("CHF 750.00").
        prefix = { Text(a.currencyCode.code + " ") },
        // Just "Saved": direction, amount and condition already sit in the field and
        // badge, repeating all of it below would double every line.
        supportingText = {
            if (number == a.threshold) Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.hairline)) {
                Icon(Icons.Default.Check, null, Modifier.size(withFont(14.dp)))
                Text(stringResource(R.string.vm_saved))
            } else Text(stringResource(R.string.detail_alert_hint))
        },
        keyboardOptions = NumericInput.priceKeyboard(),
        // "Done" saves right away, without waiting for the quiet period.
        keyboardActions = KeyboardActions(onDone = {
            if (number != null && number != a.threshold) actions.changeAlarmThreshold(a.setNumber, a.condition, a.direction, number)
        }),
        shape = Shapes.field,
        // An amount, not a line of text: doesn't span the whole card on a tablet.
        modifier = Modifier.amountWidth(),
    )
}

/**
 * "Create price alert" as in the web app: set number, condition, direction and threshold.
 * Without a number or a threshold the button stays disabled, and the line above says why.
 */
@Composable
private fun AlarmCreate(actions: SettingsActions) {
    var number by rememberSaveable { mutableStateOf("") }
    var condition by rememberSaveable { mutableStateOf(Condition.NEW) }
    var direction by rememberSaveable { mutableStateOf(AlarmDirection.BELOW) }
    var threshold by rememberSaveable { mutableStateOf("") }
    HorizontalDivider()
    Text(stringResource(R.string.alerts_create_title), style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
    OutlinedTextField(
        value = number, onValueChange = { number = NumericInput.setNumber(it) },
        label = { Text(stringResource(R.string.gallery_set_number)) }, singleLine = true,
        keyboardOptions = NumericInput.setNumberKeyboard(), shape = Shapes.field,
        modifier = Modifier.amountWidth(),
    )
    ConditionRow(condition = condition, onUiState = { condition = it }, modifier = Modifier.amountWidth())
    SegmentChoice(
        options = listOf(AlarmDirection.BELOW to stringResource(R.string.detail_alert_chip_below),
                          AlarmDirection.OVER to stringResource(R.string.detail_alert_chip_above)),
        chosen = direction, onChoice = { direction = it }, modifier = Modifier.amountWidth(),
    )
    OutlinedTextField(
        value = threshold, onValueChange = { threshold = NumericInput.price(it) },
        label = { Text(stringResource(R.string.alerts_threshold)) }, singleLine = true,
        keyboardOptions = NumericInput.priceKeyboard(), shape = Shapes.field,
        modifier = Modifier.amountWidth(),
    )
    val ready = number.isNotBlank() && AlarmInput.number(threshold) != null
    if (!ready) LockReason(stringResource(R.string.alerts_create_lock_reason))
    Button(
        onClick = { actions.createAlarm(number, condition, direction, threshold); number = ""; threshold = "" },
        enabled = ready, modifier = Modifier.amountWidth(),
    ) { Text(stringResource(R.string.alerts_create)) }
}

/**
 * Width of an alert's fields and choices: an amount across the whole tablet card would read
 * as a line of text, hence [AMOUNT_WIDTH]. If the card is barely wider (phone), they fill it
 * and end at the same edge as the header and divider, instead of a few dp before it.
 */
private fun Modifier.amountWidth(): Modifier = layout { measurable, limits ->
    val width = when {
        !limits.hasBoundedWidth -> AMOUNT_WIDTH.roundToPx()
        limits.maxWidth <= PHONE_CARD.roundToPx() -> limits.maxWidth
        else -> minOf(limits.maxWidth, AMOUNT_WIDTH.roundToPx())
    }
    val space = measurable.measure(limits.copy(minWidth = width, maxWidth = width))
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
private fun AlarmStateBadge(triggered: Boolean) {
    val text = stringResource(if (triggered) R.string.alerts_fired else R.string.alerts_armed)
    // Filled = active, outlined = triggered. The surface is the difference
    // you still see even when the two colors look the same.
    Surface(
        shape = Shapes.chip,
        color = if (triggered) Color.Transparent
                else MaterialTheme.colorScheme.secondaryContainer,
        border = if (triggered)
            BorderStroke(1.dp, MaterialTheme.colorScheme.outline) else null,
    ) {
        // One word, one line: the line below the field says what the triggered alert is waiting for.
        Text(
            text,
            maxLines = 1,
            style = MaterialTheme.typography.bodySmall,
            // The weight carries it too: an active alert is the state
            // that matters.
            fontWeight = if (triggered) FontWeight.Normal else FontWeight.SemiBold,
            color = if (triggered) MaterialTheme.colorScheme.onSurfaceVariant
                    else MaterialTheme.colorScheme.onSecondaryContainer,
            // Padding like a chip: at 4 dp "Triggered" touched the edge.
            modifier = Modifier.padding(
                horizontal = Spacing.small, vertical = Spacing.hairline),
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
    val question = androidx.activity.compose.rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* The answer doesn't matter — reasoning in the comment above this function. */ }

    SettingsCard(
        title = stringResource(R.string.detail_alert),
        icon = Icons.Default.Notifications,
    ) {
        ToggleRow(stringResource(R.string.alert_notify), an, { newValue ->
            // The permission FIRST and on the main thread: it opens a
            // system dialog, and that doesn't belong behind background work.
            if (newValue && Build.VERSION.SDK_INT >= 33) {
                question.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            }
            toggleOn(newValue)
        }, hint = stringResource(R.string.alert_notify_hint))
    }
}
