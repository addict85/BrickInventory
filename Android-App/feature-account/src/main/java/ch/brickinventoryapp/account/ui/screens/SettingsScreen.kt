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

/** Was die Einstellungen zeigen; die Route sammelt es aus vier Flüssen dreier ViewModels. */
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

/** Die Einstellungen am Navigationsziel; Darstellung, Vertrauen und Update leben an der Activity. */
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
        // Einschalten fragt erst nach (UserCaDialog in MainActivity).
        onNutzerCa = { if (it) vertrauen.userCa.requests() else vertrauen.userCa.turnOff() },
        onLogout = onLogout, onServerWechseln = onServerWechseln, scrollState = scrollState,
    )
}

/**
 * Die Einstellungen — wenige Karten statt eines Stapels: Anzeige & Preise (jede
 * Wahl gilt sofort), Server und Aktualisierung. Die Rubriken mit eigener Seite liegen auf „Mehr“
 * (MehrBildschirm.kt) und in EinstellungenUnterseiten.kt.
 */
@Composable
fun SettingsScreen(
    zustand: EinstellungenZustand,
    aktionen: EinstellungenAktionen,
    update: UpdateAktionen,
    darstellung: DarstellungAktionen,
    onNutzerCa: (Boolean) -> Unit,
    /** Abmelden — nur der Graph kennt den NavController. */
    onLogout: () -> Unit,
    /**
     * Zur Server-Einrichtung wechseln — ein Rückruf, weil nur der Graph den
     * NavController kennt. Ohne Vorgabewert, damit eine vergessene Weitergabe nicht
     * übersetzt statt einen Knopf ohne Wirkung zu ergeben.
     */
    onServerWechseln: () -> Unit,
    /**
     * Rollposition — von AUSSEN, aus demselben Grund wie bei den Finanzen:
     * Der Weg in die Detailansicht verwirft dieses Ziel, und ein
     * `rememberScrollState()` hier drin waere bei der Rueckkehr zurueckgesetzt.
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

    // Rückfall auf die globale Vorgabe des Servers beim Erfassen
    // (`defaultPriceCondition`), nicht auf die Preisgrundlage für Bewertungen. `null`
    // heisst: keine eigene Vorgabe — nicht dasselbe wie NEU.
    val ownDefault = userDefaultCondition
    val effectiveUserDefault = ownDefault ?: defaultPriceCondition

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .centeredUntil(Lesebreite.formular)
            .padding(horizontal = Abstaende.gross, vertical = Abstaende.gross),
        // gross statt der blanken 10 dp von vorher: Die Karten sind jetzt
        // wenige und gross, und zwischen ihnen soll Luft sein.
        verticalArrangement = Arrangement.spacedBy(Abstaende.gross)
    ) {
        // Hier steht nur, was eine Einstellung im engeren Sinn ist: Anzeige & Preise,
        // Server, Update-Prüfung. Die Rubriken mit eigener Seite liegen in der
        // Seite „Mehr“, einen Tipper näher.
        //
        // ── 2. Anzeige & Preise ──
        SettingsCard(title = stringResource(R.string.settings_group_display),
                     icon = Icons.Default.Tune) {
            // Jede Wahl gilt sofort und meldet sich: früher wirkten Sprache und Darstellung
            // sofort, Währung und Zustände erst über einen Knopf darunter — zwei Regeln auf
            // einer Karte, und wer den Knopf übersah, verlor die Wahl.
            SelectionField(
                stringResource(R.string.settings_language),
                listOf("system" to stringResource(R.string.settings_language_system),
                       "en" to stringResource(R.string.settings_language_en),
                       "de" to stringResource(R.string.settings_language_de)),
                gewaehlt = language, onWahl = { darstellung.setLanguage(it) },
                modifier = Modifier.fillMaxWidth(),
            )

            // Darstellung je Gerät: System folgt dem Telefon, Hell und Dunkel gelten immer.
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
            // Werkbank ist schon dunkel: Die Wahl ist aus, und der Satz sagt, warum.
            if (!selectable) Text(stringResource(R.string.settings_hell_fest), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)

            // Material You: zusätzlich zu den sechs Designs, je Gerät. Erst ab
            // Android 12 gibt es Systemfarben; darunter fehlt der Schalter ganz.
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

            // Je Gerät, Vorgabe aus: Wer die Übersicht anderen zeigt, will keine Vorschau.
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

            // Je Gerät, Vorgabe aus: Wer das Telefon teilt, sperrt die App nach einer Weile im Hintergrund.
            LocalAppLock.current?.let { AppLockChoice(it) }

            // Je Gerät, Vorgabe aus: Das Widget liegt ohne Entsperren auf dem Startbildschirm.
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

            // Währung und Preisgrundlage gehen zusammen an den Server (ein Endpunkt).
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

            // ── Mein Zustand beim Hinzufügen ──
            //
            // Drei Möglichkeiten, damit es einen Weg zurück zur Vorgabe des Servers gibt; der
            // Hinweis nennt, worauf sie steht.
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
        // Die Serveradresse ist eine Einstellung wie Währung und Sprache, keine Handlung
        // an der laufenden Sitzung.
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

        // Dieselbe Rückfrage wie unter „Mehr“: Abmelden ist von beiden Stellen gleich schwer.
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
 * Mit welchem Server die App spricht — und der Weg, ihn zu wechseln. Die Adresse
 * steht dabei, weil man genau deshalb hinsieht; bei zwei Installationen (Test und
 * Betrieb) ist das der Unterschied zu falschen Daten.
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
        // Je Gerät und sofort wirksam (util/ServerVertrauen.kt); ausgeschaltet nur System-CAs.
        // Nur für den eigenen Server; Updates und fremde Hosts prüfen immer gegen das System.
        // Hinweis in der Fehlerfarbe: Es ist ein Risiko, keine Komforteinstellung.
        ToggleRow(stringResource(R.string.settings_nutzer_ca), userCa, onNutzerCa,
            hinweis = stringResource(R.string.settings_nutzer_ca_hint), hintColor = MaterialTheme.colorScheme.error)
    }
}

/**
 * Selbstaktualisierung aus dem GitHub-Release: beim Start still prüfen, nie von
 * allein laden, und hier ein Knopf zum Nachsehen. Die laufende Fassung steht immer
 * da, sonst wäre „Aktuell“ ohne Beleg. Herunterladen und Installieren sind zwei
 * Knöpfe, weil dazwischen ein Ausflug zur Erlaubnis „Pakete installieren“ liegen
 * kann.
 */
@Composable
private fun UpdateCard(
    // `updateZustand`, nicht `zustand`: Die Prüfung „welcher Name trägt in dieser
    // Datei welchen Zustandstyp“ unterscheidet keine Gültigkeitsbereiche.
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
            // Nur nach einer Pruefung: Vorher waere „aktuell" eine Aussage
            // ueber etwas, das niemand nachgesehen hat. Eine veraltete Quelle
            // ist nie „aktuell“ (Hinweis darunter).
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
        // 48 dp hoch wie „Abmelden“: Material zeichnet 40 dp, und der Knoten zum Tippen und
        // Vorlesen wäre nur so hoch wie die Zeichnung.
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
            // Herunterladen nur, wenn es etwas zu holen gibt; Installieren
            // nur, wenn es schon auf der Platte liegt.
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

/** Je Gerät: Die Prüfung beim Start ist eine Anfrage an GitHub (Datenschutz). */
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

/** Mit wem die App spricht (MASVS-PRIVACY): dieselbe Liste wie in PLAYSTORE.md. */
@Composable
private fun PrivacyCard(startpruefung: Boolean, onStartpruefung: (Boolean) -> Unit) {
    SettingsCard(title = stringResource(R.string.datenschutz_titel), icon = Icons.Default.PrivacyTip) {
        Text(stringResource(R.string.datenschutz_text), style = MaterialTheme.typography.bodyMedium)
        StartpruefungRow(startpruefung, onStartpruefung)
    }
}
