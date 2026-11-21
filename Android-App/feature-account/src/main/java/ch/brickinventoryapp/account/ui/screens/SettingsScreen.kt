package ch.brickinventoryapp.account.ui.screens

import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.ui.components.ToggleRow
import ch.brickinventoryapp.ui.components.AppLockChoice
import ch.brickinventoryapp.ui.components.LocalAppLock
import ch.brickinventoryapp.state.ui.viewmodel.VertrauenViewModel
import ch.brickinventoryapp.state.ui.viewmodel.DarstellungViewModel
import ch.brickinventoryapp.state.ui.viewmodel.DarstellungAktionen
import ch.brickinventoryapp.account.ui.viewmodel.UpdateAktionen
import ch.brickinventoryapp.account.ui.viewmodel.EinstellungenAktionen
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.account.ui.UpdateUiState
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.ui.titel
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.model.ui.theme.Helligkeit
import ch.brickinventoryapp.ui.theme.centeredUntil
import ch.brickinventoryapp.ui.components.SelectionField
import ch.brickinventoryapp.ui.components.SegmentChoice
import ch.brickinventoryapp.account.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.update.util.sourceStale
import ch.brickinventoryapp.ui.components.versionsName
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.theme.SYSTEMFARBEN_AB_SDK
import ch.brickinventoryapp.ui.theme.brightnessSelectable
import ch.brickinventoryapp.update.util.UpdateFresh
import ch.brickinventoryapp.update.util.permissionIntent
import ch.brickinventoryapp.ui.components.SettingsCard

/** What settings shows; the route gathers it from four flows of three ViewModels. */
data class EinstellungenZustand(
    val appState: AppUiState,
    val updateZustand: UpdateUiState,
    val helligkeit: String,
    val design: Design,
    val systemfarben: Boolean,
    val hidePreview: Boolean,
    val widgetValues: Boolean,
    val userCa: Boolean,
)

/** Settings at the navigation destination; display, trust and update live on the Activity. */
@Composable
internal fun SettingsRoute(
    vm: SettingsViewModel,
    onLogout: () -> Unit,
    onServerWechseln: () -> Unit,
    scrollState: ScrollState,
    selbstUpdate: UpdateViewModel,
    darstellung: DarstellungViewModel,
    vertrauen: VertrauenViewModel,
) {
    val appState by vm.state.collectAsStateWithLifecycle()
    val updateZustand by selbstUpdate.updateState.collectAsStateWithLifecycle()
    val helligkeit by darstellung.helligkeit.collectAsStateWithLifecycle()
    val design by darstellung.appTheme.collectAsStateWithLifecycle()
    val systemfarben by darstellung.systemfarben.collectAsStateWithLifecycle()
    val hidePreview by darstellung.hidePreview.collectAsStateWithLifecycle()
    val widgetValues by darstellung.widgetValues.collectAsStateWithLifecycle()
    val userCa by vertrauen.userCa.an.collectAsStateWithLifecycle()
    SettingsScreen(
        zustand = EinstellungenZustand(appState, updateZustand, helligkeit, design, systemfarben,
            hidePreview, widgetValues, userCa),
        aktionen = vm, update = selbstUpdate, darstellung = darstellung,
        // Turning it on asks first (UserCaDialog in MainActivity).
        onNutzerCa = { if (it) vertrauen.userCa.requests() else vertrauen.userCa.turnOff() },
        onLogout = onLogout, onServerWechseln = onServerWechseln, scrollState = scrollState,
    )
}

/**
 * Settings — a few cards instead of a stack: display & prices (every
 * choice applies right away), server and update. The categories with their own page sit on "More"
 * (MehrBildschirm.kt) and in EinstellungenUnterseiten.kt.
 */
@Composable
fun SettingsScreen(
    zustand: EinstellungenZustand,
    aktionen: EinstellungenAktionen,
    update: UpdateAktionen,
    darstellung: DarstellungAktionen,
    onNutzerCa: (Boolean) -> Unit,
    /** Sign out — only the graph knows the NavController. */
    onLogout: () -> Unit,
    /**
     * Switch to server setup — a callback, because only the graph
     * knows the NavController. No default value, so a forgotten pass-through
     * fails to compile instead of producing a button with no effect.
     */
    onServerWechseln: () -> Unit,
    /**
     * Scroll position — from OUTSIDE, for the same reason as in finances:
     * the route into the detail view discards this destination, and a
     * `rememberScrollState()` in here would be reset on returning.
     */
    scrollState: ScrollState,
) {
    val appState = zustand.appState
    val updateZustand = zustand.updateZustand

    val currency = appState.currency
    val priceCondition = appState.priceCondition
    val userDefaultCondition = appState.userDefaultCondition
    val defaultPriceCondition = appState.defaultPriceCondition
    val language = appState.language

    // Falls back to the server's global default on entry
    // (`defaultPriceCondition`), not to the pricing basis for valuations. `null`
    // means: no own default — not the same as NEW.
    val ownDefault = userDefaultCondition
    val effectiveUserDefault = ownDefault ?: defaultPriceCondition

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .centeredUntil(Lesebreite.formular)
            .padding(horizontal = Abstaende.gross, vertical = Abstaende.gross),
        // gross instead of the bare 10 dp from before: the cards are now
        // few and large, and there should be air between them.
        verticalArrangement = Arrangement.spacedBy(Abstaende.gross)
    ) {
        // Here stands only what a setting is in the narrow sense: display & prices,
        // server, update check. The categories with their own page sit in the
        // "More" page, one tap further away.
        //
        // ── 2. Display & prices ──
        SettingsCard(title = stringResource(R.string.settings_group_display),
                     icon = Icons.Default.Tune) {
            // Every choice applies right away and announces itself: previously language and
            // display took effect right away, currency and conditions only via a button
            // below them — two rules on one card, and whoever missed the button lost the choice.
            SelectionField(
                stringResource(R.string.settings_language),
                listOf("system" to stringResource(R.string.settings_language_system),
                       "en" to stringResource(R.string.settings_language_en),
                       "de" to stringResource(R.string.settings_language_de)),
                gewaehlt = language, onWahl = { darstellung.setLanguage(it) },
                modifier = Modifier.fillMaxWidth(),
            )

            // Display per device: System follows the phone, Light and Dark always apply.
            Signature(stringResource(R.string.settings_dark_label))
            val helligkeit = zustand.helligkeit
            val design = zustand.design
            val colorsOfSystems = zustand.systemfarben
            val selectable = brightnessSelectable(design, colorsOfSystems, android.os.Build.VERSION.SDK_INT)
            SegmentChoice(
                listOf(Helligkeit.SYSTEM to stringResource(R.string.settings_hell_system),
                       Helligkeit.LIGHT to stringResource(R.string.settings_hell_hell),
                       Helligkeit.DARK to stringResource(R.string.settings_hell_dunkel)),
                gewaehlt = helligkeit, onWahl = { darstellung.setHelligkeit(it) },
                enabled = selectable,
            )
            // Werkbank is already dark: the choice is off, and the sentence says why.
            if (!selectable) Text(stringResource(R.string.settings_hell_fest), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)

            // Material You: in addition to the six designs, per device. System colors only
            // exist from Android 12; below that the switch is missing entirely.
            if (android.os.Build.VERSION.SDK_INT >= SYSTEMFARBEN_AB_SDK) {
                val systemfarben = zustand.systemfarben
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp)
                        .toggleable(value = systemfarben, role = Role.Switch, onValueChange = { darstellung.setSystemfarben(it) }),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.settings_systemfarben), style = MaterialTheme.typography.bodyMedium)
                        Text(stringResource(R.string.settings_systemfarben_hint), style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(checked = systemfarben, onCheckedChange = null)
                }
            }

            // Per device, default off: whoever shows the overview to others wants no preview.
            val hidePreview = zustand.hidePreview
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .toggleable(value = hidePreview, role = Role.Switch, onValueChange = { darstellung.setVorschauVerbergen(it) }),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.settings_vorschau_verbergen), style = MaterialTheme.typography.bodyMedium)
                    Text(stringResource(R.string.settings_vorschau_verbergen_hint), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = hidePreview, onCheckedChange = null)
            }

            // Per device, default off: whoever shares the phone locks the app after a while in the background.
            LocalAppLock.current?.let { AppLockChoice(it) }

            // Per device, default off: the widget sits on the home screen without unlocking.
            val widgetValues = zustand.widgetValues
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .toggleable(value = widgetValues, role = Role.Switch, onValueChange = { darstellung.setWidgetValues(it) }),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.settings_widget_werte), style = MaterialTheme.typography.bodyMedium)
                    Text(stringResource(R.string.settings_widget_werte_hint), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = widgetValues, onCheckedChange = null)
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // Currency and pricing basis go to the server together (one endpoint).
            SelectionField(
                stringResource(R.string.settings_currency),
                Waehrung.SELECTABLE.map { it to it.code },
                gewaehlt = currency, onWahl = { aktionen.saveSettings(it, priceCondition) },
                modifier = Modifier.fillMaxWidth(),
            )

            Signature(stringResource(R.string.settings_price_condition))
            Text(stringResource(R.string.settings_price_basis),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            SegmentChoice(
                listOf(Zustand.NEU to stringResource(R.string.settings_condition_new),
                       Zustand.GEBRAUCHT to stringResource(R.string.settings_condition_used)),
                gewaehlt = priceCondition, onWahl = { aktionen.saveSettings(currency, it) },
            )

            // ── My state when adding ──
            //
            // Three options, so there's a way back to the server's default; the
            // hint names what it's based on.
            Signature(stringResource(R.string.settings_default_condition))
            val wirkt = if (effectiveUserDefault == Zustand.GEBRAUCHT) stringResource(R.string.condition_used)
                        else stringResource(R.string.condition_new)
            Text(stringResource(R.string.settings_default_condition_hint) + " " +
                    stringResource(R.string.settings_default_condition_effective, wirkt),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            SegmentChoice(
                listOf<Pair<Zustand?, String>>(null to stringResource(R.string.settings_default_condition_global),
                       Zustand.NEU to stringResource(R.string.condition_new),
                       Zustand.GEBRAUCHT to stringResource(R.string.condition_used)),
                gewaehlt = ownDefault, onWahl = { aktionen.saveUserDefaultCondition(it) },
            )
        }

        // ── 3. Server ──
        //
        // The server address is a setting like currency and language, not an action
        // on the running session.
        val userCa = zustand.userCa
        ServerCard(
            serverUrl = appState.serverUrl,
            switchOn = onServerWechseln,
            userCa = userCa,
            onNutzerCa = onNutzerCa,
        )

        UpdateCard(
            updateZustand = updateZustand,
            onPruefen = { update.pruefeAufUpdate() },
            onLaden = { update.ladeUpdate() },
            onInstallieren = { update.startInstallation() },
        )

        PrivacyCard(updateZustand.startpruefung) { update.setStartpruefung(it) }

        Spacer(Modifier.height(Abstaende.klein))

        // The same confirmation as under "More": signing out is equally hard from either place.
        var signOutAsks by rememberSaveable { mutableStateOf(false) }
        if (signOutAsks) Prompt(
            titel = stringResource(R.string.logout_confirm_title),
            text = stringResource(R.string.logout_confirm_text),
            bestaetigen = stringResource(R.string.settings_logout),
            onBestaetigen = { signOutAsks = false; onLogout() },
            onAbbrechen = { signOutAsks = false },
            symbol = Icons.AutoMirrored.Filled.Logout,
        )
        OutlinedButton(
            onClick = { signOutAsks = true },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.5f))
        ) {
            Icon(Icons.AutoMirrored.Filled.Logout, null, Modifier.size(withFont(18.dp)))
            Spacer(Modifier.width(Abstaende.klein))
            Text(stringResource(R.string.settings_logout), fontWeight = FontWeight.SemiBold)
        }
    }
}

/** Die Unterschrift einer Einstellung innerhalb einer Karte. */
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
    serverUrl: String, switchOn: () -> Unit, userCa: Boolean, onNutzerCa: (Boolean) -> Unit,
) {
    SettingsCard(title = stringResource(R.string.main_menu_change_server), icon = Icons.Default.Cloud) {
        Text(
            serverUrl.ifBlank { "—" },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(Abstaende.klein))
        OutlinedButton(onClick = switchOn, colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
            Icon(Icons.Default.Cloud, null, modifier = Modifier.size(withFont(18.dp)))
            Spacer(Modifier.width(Abstaende.klein))
            Text(stringResource(R.string.main_menu_change_server))
        }
        // Per device and effective right away (util/ServerVertrauen.kt); switched off, only system CAs.
        // Only for one's own server; updates and foreign hosts always check against the system.
        // Notice in the error color: it's a risk, not a convenience setting.
        ToggleRow(stringResource(R.string.settings_nutzer_ca), userCa, onNutzerCa,
            hinweis = stringResource(R.string.settings_nutzer_ca_hint), hintColor = MaterialTheme.colorScheme.error)
    }
}

/**
 * Self-update from the GitHub release: check silently on start, never
 * load on its own, and here a button to check manually. The running version always
 * shows, otherwise "Up to date" would have no evidence. Download and install are two
 * buttons, because there can be a detour to the "install packages" permission
 * in between.
 */
@Composable
private fun UpdateCard(
    // `updateZustand`, not `zustand`: the check "which name carries which
    // state type in this file" doesn't distinguish scopes.
    updateZustand: UpdateUiState,
    onPruefen: () -> Unit,
    onLaden: () -> Unit,
    onInstallieren: () -> Unit,
) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    SettingsCard(title = stringResource(R.string.update_title), icon = Icons.Default.SystemUpdate) {
        Text(
            stringResource(R.string.update_installed, versionsName()),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(Abstaende.klein))

        val neuere = updateZustand.newerVersion
        when {
            neuere != null -> Text(
                stringResource(R.string.update_available, neuere.versionName),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.primary,
            )
            // Only after a check: beforehand "current" would be a claim
            // about something no one has looked at. A stale source
            // is never "current" (notice below).
            updateZustand.geprueft && !sourceStale(updateZustand.frische) -> Text(
                stringResource(R.string.update_current, versionsName()),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (sourceStale(updateZustand.frische)) {
            Spacer(Modifier.height(Abstaende.klein))
            Text(
                stringResource(if (updateZustand.frische == UpdateFresh.ABGELAUFEN)
                    R.string.update_quelle_abgelaufen else R.string.update_quelle_zurueckgesetzt),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }

        updateZustand.fortschritt?.let { p ->
            Spacer(Modifier.height(Abstaende.klein))
            Text(stringResource(R.string.update_downloading, p),
                style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(Abstaende.tiny))
            LinearProgressIndicator(
                progress = { p / 100f },
                modifier = Modifier.fillMaxWidth(),
            )
        }

        if (updateZustand.permissionAbsent) {
            Spacer(Modifier.height(Abstaende.klein))
            Text(
                stringResource(R.string.update_permission_needed),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(Abstaende.tiny))
            TextButton(onClick = {
                ctx.startActivity(permissionIntent(ctx))
            }) { Text(stringResource(R.string.update_permission_grant)) }
        }

        updateZustand.fehler?.let { f ->
            Spacer(Modifier.height(Abstaende.klein))
            Text(f.satz(), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }

        Spacer(Modifier.height(Abstaende.mittel))
        // 48 dp high like "Sign out": Material draws 40 dp, and the node for tapping and
        // reading would only be as tall as the drawing.
        val buttonHeight = Modifier.heightIn(min = 48.dp)
        Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = onPruefen, modifier = buttonHeight, enabled = !updateZustand.check.laeuft && updateZustand.fortschritt == null, colors = nebenKnopfFarben(), border = nebenKnopfRand(!updateZustand.check.laeuft && updateZustand.fortschritt == null)) {
                if (updateZustand.check.laeuft) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(Abstaende.klein))
                }
                Text(stringResource(R.string.update_check))
            }
            // Download only if there's something to fetch; Install
            // only once it's already on disk.
            if (neuere != null && !updateZustand.readyToInstallation) {
                Button(onClick = onLaden, modifier = buttonHeight, enabled = updateZustand.fortschritt == null) {
                    Text(stringResource(R.string.update_download))
                }
            }
            if (updateZustand.readyToInstallation) {
                Button(onClick = onInstallieren, modifier = buttonHeight) {
                    Text(stringResource(R.string.update_install))
                }
            }
        }
    }
}

/** Per device: the check on start is a request to GitHub (privacy). */
@Composable
private fun StartpruefungRow(an: Boolean, onSwitch: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp)
            .toggleable(value = an, role = Role.Switch, onValueChange = onSwitch),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.update_beim_start), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(R.string.update_beim_start_hint), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = an, onCheckedChange = null)
    }
}

/** Who the app talks to (MASVS-PRIVACY): the same list as in PLAYSTORE.md. */
@Composable
private fun PrivacyCard(startpruefung: Boolean, onStartpruefung: (Boolean) -> Unit) {
    SettingsCard(title = stringResource(R.string.datenschutz_titel), icon = Icons.Default.PrivacyTip) {
        Text(stringResource(R.string.datenschutz_text), style = MaterialTheme.typography.bodyMedium)
        StartpruefungRow(startpruefung, onStartpruefung)
    }
}
