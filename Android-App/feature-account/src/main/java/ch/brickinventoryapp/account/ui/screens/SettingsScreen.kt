package ch.brickinventoryapp.account.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.account.ui.viewmodel.SettingsActions
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.model.appearance.Brightness
import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.state.ui.viewmodel.AppearanceActions
import ch.brickinventoryapp.state.ui.viewmodel.AppearanceViewModel
import ch.brickinventoryapp.state.ui.viewmodel.TrustViewModel
import ch.brickinventoryapp.ui.components.AppLockChoice
import ch.brickinventoryapp.ui.components.LocalAppLock
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.components.SegmentChoice
import ch.brickinventoryapp.ui.components.SelectionField
import ch.brickinventoryapp.ui.components.SettingsCard
import ch.brickinventoryapp.ui.components.ToggleRow
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.ReadingWidth
import ch.brickinventoryapp.ui.theme.SYSTEM_COLORS_AB_SDK
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.brightnessSelectable
import ch.brickinventoryapp.ui.theme.centeredUntil
import ch.brickinventoryapp.ui.title

/** What settings shows; the route gathers it from the flows of three ViewModels. */
data class SettingsState(
    val appState: AppUiState,
    val brightness: String,
    val design: Design,
    val systemColors: Boolean,
    val hidePreview: Boolean,
    val widgetValues: Boolean,
    val userCa: Boolean,
)

/** Where settings lead out of the page; only the graph knows the NavController and the trust dialog. */
interface SettingsExits {
    /** Sign out. */
    fun logout()

    /** Switch to server setup. No default, so a forgotten pass-through fails to compile. */
    fun switchServer()

    /** User CAs on or off; turning on asks first (UserCaDialog in MainActivity). */
    fun setUserCa(on: Boolean)
}

/** Settings at the navigation destination; display and trust live on the Activity. */
@Composable
internal fun SettingsRoute(
    vm: SettingsViewModel,
    onLogout: () -> Unit,
    onServerSwitch: () -> Unit,
    scrollState: ScrollState,
    appearance: AppearanceViewModel,
    trust: TrustViewModel,
) {
    val appState by vm.state.collectAsStateWithLifecycle()
    val brightness by appearance.brightness.collectAsStateWithLifecycle()
    val design by appearance.appTheme.collectAsStateWithLifecycle()
    val systemColors by appearance.systemColors.collectAsStateWithLifecycle()
    val hidePreview by appearance.hidePreview.collectAsStateWithLifecycle()
    val widgetValues by appearance.widgetValues.collectAsStateWithLifecycle()
    val userCa by trust.userCa.an.collectAsStateWithLifecycle()
    val exits = object : SettingsExits {
        override fun logout() = onLogout()
        override fun switchServer() = onServerSwitch()
        override fun setUserCa(on: Boolean) { if (on) trust.userCa.requests() else trust.userCa.turnOff() }
    }
    SettingsScreen(
        condition = SettingsState(appState, brightness, design, systemColors,
            hidePreview, widgetValues, userCa),
        actions = vm, appearance = appearance, exits = exits, scrollState = scrollState,
    )
}

/**
 * Settings — a few cards instead of a stack: this device, account (every
 * choice applies right away), server and privacy. The categories with their own page sit on "More"
 * (MoreScreen.kt) and in SettingsSubpages.kt.
 */
@Composable
fun SettingsScreen(
    condition: SettingsState,
    actions: SettingsActions,
    appearance: AppearanceActions,
    exits: SettingsExits,
    /**
     * Scroll position — from OUTSIDE, for the same reason as in finances:
     * the route into the detail view discards this destination, and a
     * `rememberScrollState()` in here would be reset on returning.
     */
    scrollState: ScrollState,
) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .centeredUntil(ReadingWidth.form)
            .padding(horizontal = Spacing.large, vertical = Spacing.large),
        // gross instead of the bare 10 dp from before: the cards are now
        // few and large, and there should be air between them.
        verticalArrangement = Arrangement.spacedBy(Spacing.large)
    ) {
        // Device and account apart: in one card nobody could tell that the language stays
        // on this phone while the currency follows the account to every device.
        // Every choice applies right away; a save button was a second rule to miss.
        SettingsCard(title = stringResource(R.string.settings_group_device),
                     icon = Icons.Default.Smartphone) {
            DisplaySettings(condition, appearance)
        }
        SettingsCard(title = stringResource(R.string.settings_group_account),
                     icon = Icons.Default.Person) {
            Text(stringResource(R.string.settings_group_account_hint), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            PriceSettings(condition.appState, actions)
        }

        // The server address is a setting like currency and language, not an action
        // on the running session.
        ServerCard(
            serverUrl = condition.appState.serverUrl,
            switchOn = exits::switchServer,
            userCa = condition.userCa,
            onUserCa = exits::setUserCa,
        )

        PrivacyCard()

        Spacer(Modifier.height(Spacing.small))

        LogoutButton(exits::logout)
    }
}

/** Language, brightness and the per-device switches. */
@Composable
private fun DisplaySettings(condition: SettingsState, appearance: AppearanceActions) {
    SelectionField(
        stringResource(R.string.settings_language),
        listOf("system" to stringResource(R.string.settings_language_system),
               "en" to stringResource(R.string.settings_language_en),
               "de" to stringResource(R.string.settings_language_de)),
        chosen = condition.appState.language, onChoice = { appearance.setLanguage(it) },
        modifier = Modifier.fillMaxWidth(),
    )

    // Display per device: System follows the phone, Light and Dark always apply.
    Signature(stringResource(R.string.settings_dark_label))
    val selectable = brightnessSelectable(condition.design, condition.systemColors, android.os.Build.VERSION.SDK_INT)
    SegmentChoice(
        listOf(Brightness.SYSTEM to stringResource(R.string.settings_light_system),
               Brightness.LIGHT to stringResource(R.string.settings_light_light),
               Brightness.DARK to stringResource(R.string.settings_light_dark)),
        chosen = condition.brightness, onChoice = { appearance.setBrightness(it) },
        enabled = selectable,
    )
    // Werkbank is already dark: the choice is off, and the sentence says why.
    if (!selectable) Text(stringResource(R.string.settings_light_fixed), style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)

    // Material You: in addition to the six designs, per device. System colors only
    // exist from Android 12; below that the switch is missing entirely.
    if (android.os.Build.VERSION.SDK_INT >= SYSTEM_COLORS_AB_SDK) {
        SettingSwitch(R.string.settings_system_colors, R.string.settings_system_colors_hint,
            condition.systemColors) { appearance.setSystemColors(it) }
    }

    // Per device, default off: whoever shows the overview to others wants no preview.
    SettingSwitch(R.string.settings_preview_hide, R.string.settings_preview_hide_hint,
        condition.hidePreview) { appearance.setPreviewHidden(it) }

    // Per device, default off: whoever shares the phone locks the app after a while in the background.
    LocalAppLock.current?.let { AppLockChoice(it) }

    // Per device, default off: the widget sits on the home screen without unlocking.
    SettingSwitch(R.string.settings_widget_values, R.string.settings_widget_values_hint,
        condition.widgetValues) { appearance.setWidgetValues(it) }
}

/** A setting that is on or off, with its explanation below the name; the whole row toggles. */
@Composable
private fun SettingSwitch(title: Int, hint: Int, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp)
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(stringResource(title), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(hint), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = null)
    }
}

/** Currency, pricing basis and one's own default condition when adding. */
@Composable
private fun PriceSettings(appState: AppUiState, actions: SettingsActions) {
    val currency = appState.currency
    val priceCondition = appState.priceCondition
    // Falls back to the server's global default on entry
    // (`defaultPriceCondition`), not to the pricing basis for valuations. `null`
    // means: no own default — not the same as NEW.
    val ownDefault = appState.userDefaultCondition
    val effectiveUserDefault = ownDefault ?: appState.defaultPriceCondition

    // Currency and pricing basis go to the server together (one endpoint).
    SelectionField(
        stringResource(R.string.settings_currency),
        CurrencyCode.SELECTABLE.map { it to it.code },
        chosen = currency, onChoice = { actions.saveSettings(it, priceCondition) },
        modifier = Modifier.fillMaxWidth(),
    )

    Signature(stringResource(R.string.settings_price_condition))
    Text(stringResource(R.string.settings_price_basis),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    SegmentChoice(
        listOf(Condition.NEW to stringResource(R.string.settings_condition_new),
               Condition.USED to stringResource(R.string.settings_condition_used)),
        chosen = priceCondition, onChoice = { actions.saveSettings(currency, it) },
    )

    // Three options, so there's a way back to the server's default; the
    // hint names what it's based on.
    Signature(stringResource(R.string.settings_default_condition))
    val works = if (effectiveUserDefault == Condition.USED) stringResource(R.string.condition_used)
                else stringResource(R.string.condition_new)
    Text(stringResource(R.string.settings_default_condition_hint) + " " +
            stringResource(R.string.settings_default_condition_effective, works),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    SegmentChoice(
        listOf<Pair<Condition?, String>>(null to stringResource(R.string.settings_default_condition_global),
               Condition.NEW to stringResource(R.string.condition_new),
               Condition.USED to stringResource(R.string.condition_used)),
        chosen = ownDefault, onChoice = { actions.saveUserDefaultCondition(it) },
    )
}

/** The same confirmation as under "More": signing out is equally hard from either place. */
@Composable
private fun LogoutButton(onLogout: () -> Unit) {
    var logoutAsks by rememberSaveable { mutableStateOf(false) }
    if (logoutAsks) Prompt(
        title = stringResource(R.string.logout_confirm_title),
        text = stringResource(R.string.logout_confirm_text),
        confirm = stringResource(R.string.settings_logout),
        onConfirm = { logoutAsks = false; onLogout() },
        onCancel = { logoutAsks = false },
        symbol = Icons.AutoMirrored.Filled.Logout,
    )
    OutlinedButton(
        onClick = { logoutAsks = true },
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.5f))
    ) {
        Icon(Icons.AutoMirrored.Filled.Logout, null, Modifier.size(withFont(18.dp)))
        Spacer(Modifier.width(Spacing.small))
        Text(stringResource(R.string.settings_logout), fontWeight = FontWeight.SemiBold)
    }
}

/** The caption of a setting within a card. */
@Composable
private fun Signature(text: String) {
    Text(text,
        style = MaterialTheme.typography.labelLarge,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.semantics { heading() })
}

/**
 * Which server the app talks to — and the way to switch it. The address
 * sits alongside, because that's exactly why one looks at it; with two installs
 * (test and production) that's the difference from wrong data.
 */
@Composable
private fun ServerCard(
    serverUrl: String, switchOn: () -> Unit, userCa: Boolean, onUserCa: (Boolean) -> Unit,
) {
    SettingsCard(title = stringResource(R.string.main_menu_change_server), icon = Icons.Default.Cloud) {
        Text(
            serverUrl.ifBlank { "—" },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(Spacing.small))
        // 48 dp like the logout button: at the screen edge the touch area got clipped to the 40 dp shape.
        OutlinedButton(onClick = switchOn, modifier = Modifier.heightIn(min = 48.dp),
            colors = secondaryButtonColors(), border = secondaryButtonRand()) {
            Icon(Icons.Default.Cloud, null, modifier = Modifier.size(withFont(18.dp)))
            Spacer(Modifier.width(Spacing.small))
            Text(stringResource(R.string.main_menu_change_server))
        }
        // Per device and effective right away (util/ServerTrust.kt); switched off, only system CAs.
        // Only for one's own server; foreign hosts always check against the system.
        // Notice in the error color: it's a risk, not a convenience setting.
        ToggleRow(stringResource(R.string.settings_user_ca), userCa, onUserCa,
            hint = stringResource(R.string.settings_user_ca_hint), hintColor = MaterialTheme.colorScheme.error)
    }
}

/** Who the app talks to (MASVS-PRIVACY): the same list as in `PLAYSTORE.md`. */
@Composable
private fun PrivacyCard() {
    SettingsCard(title = stringResource(R.string.privacy_title), icon = Icons.Default.PrivacyTip) {
        Text(stringResource(R.string.privacy_text), style = MaterialTheme.typography.bodyMedium)
    }
}
