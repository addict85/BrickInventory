package ch.brickinventoryapp.ui.screens

import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.AppKarte
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.AppViewModel
import ch.brickinventoryapp.ui.viewmodel.EinstellungenViewModel
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Helligkeit
import ch.brickinventoryapp.ui.theme.mittigBis
import ch.brickinventoryapp.ui.components.WahlChips
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import ch.brickinventoryapp.ui.viewmodel.aktivitaetsViewModel
import ch.brickinventoryapp.ui.viewmodel.UpdateViewModel

/**
 * Die Einstellungen — wenige Karten statt eines Stapels: Anzeige & Preise (jede
 * Wahl gilt sofort), Server und Aktualisierung. Die Rubriken mit eigener Seite liegen auf „Mehr“
 * (MehrBildschirm.kt) und in EinstellungenUnterseiten.kt.
 */
@Composable
fun SettingsScreen(
    vm: EinstellungenViewModel,
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
    // Zustand und Aktionen vom ViewModel statt über Parameter. `appState`, nicht
    // `state`: UiStateFieldsTest bestimmt den Typ je Name und Datei.
    val appState by vm.state.collectAsStateWithLifecycle()
    // `updateZustand`, nicht `update`: dieselbe Namensfalle.
    val selbstUpdate: UpdateViewModel = aktivitaetsViewModel()
    // Sprache und Design bei Dunkelheit gehören dem Gerät, nicht dem Konto.
    val app: AppViewModel = aktivitaetsViewModel()
    val updateZustand by selbstUpdate.updateState.collectAsStateWithLifecycle()

    val currency = appState.currency
    val priceCondition = appState.priceCondition
    val userDefaultCondition = appState.userDefaultCondition
    val defaultPriceCondition = appState.defaultPriceCondition
    val language = appState.language

    // Rückfall auf die globale Vorgabe des Servers beim Erfassen
    // (`defaultPriceCondition`), nicht auf die Preisgrundlage für Bewertungen. `null`
    // heisst: keine eigene Vorgabe — nicht dasselbe wie "N".
    val eigeneVorgabe = userDefaultCondition?.takeIf { it.isNotBlank() }
    val effectiveUserDefault = eigeneVorgabe ?: defaultPriceCondition

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .mittigBis(ch.brickinventoryapp.ui.theme.Lesebreite.formular)
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
                     icon = Icons.Default.Euro) {
            // Jede Wahl gilt sofort und meldet sich: früher wirkten Sprache und Darstellung
            // sofort, Währung und Zustände erst über einen Knopf darunter — zwei Regeln auf
            // einer Karte, und wer den Knopf übersah, verlor die Wahl.
            Unterschrift(stringResource(R.string.settings_language))
            WahlChips(
                listOf("system" to stringResource(R.string.settings_language_system),
                       "en" to stringResource(R.string.settings_language_en),
                       "de" to stringResource(R.string.settings_language_de)),
                gewaehlt = language, onWahl = { app.setLanguage(it) },
            )

            // Darstellung je Gerät: System folgt dem Telefon, Hell und Dunkel gelten immer.
            Unterschrift(stringResource(R.string.settings_dark_label))
            val helligkeit by app.helligkeit.collectAsStateWithLifecycle()
            val design by app.appTheme.collectAsStateWithLifecycle()
            val farbenDesSystems by app.systemfarben.collectAsStateWithLifecycle()
            val waehlbar = ch.brickinventoryapp.ui.theme.helligkeitWaehlbar(design, farbenDesSystems, android.os.Build.VERSION.SDK_INT)
            WahlChips(
                listOf(Helligkeit.SYSTEM to stringResource(R.string.settings_hell_system),
                       Helligkeit.HELL to stringResource(R.string.settings_hell_hell),
                       Helligkeit.DUNKEL to stringResource(R.string.settings_hell_dunkel)),
                gewaehlt = helligkeit, onWahl = { app.setHelligkeit(it) },
                enabled = waehlbar,
            )
            // Werkbank ist schon dunkel: Die Wahl ist aus, und der Satz sagt, warum.
            if (!waehlbar) Text(stringResource(R.string.settings_hell_fest), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)

            // Material You: zusätzlich zu den sechs Designs, je Gerät. Erst ab
            // Android 12 gibt es Systemfarben; darunter fehlt der Schalter ganz.
            if (android.os.Build.VERSION.SDK_INT >= ch.brickinventoryapp.ui.theme.SYSTEMFARBEN_AB_SDK) {
                val systemfarben by app.systemfarben.collectAsStateWithLifecycle()
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp)
                        .toggleable(value = systemfarben, role = Role.Switch, onValueChange = { app.setSystemfarben(it) }),
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
            val vorschauVerbergen by app.vorschauVerbergen.collectAsStateWithLifecycle()
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .toggleable(value = vorschauVerbergen, role = Role.Switch, onValueChange = { app.setVorschauVerbergen(it) }),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.settings_vorschau_verbergen), style = MaterialTheme.typography.bodyMedium)
                    Text(stringResource(R.string.settings_vorschau_verbergen_hint), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = vorschauVerbergen, onCheckedChange = null)
            }

            // Je Gerät, Vorgabe aus: Das Widget liegt ohne Entsperren auf dem Startbildschirm.
            val widgetWerte by app.widgetWerte.collectAsStateWithLifecycle()
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .toggleable(value = widgetWerte, role = Role.Switch, onValueChange = { app.setWidgetWerte(it) }),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.settings_widget_werte), style = MaterialTheme.typography.bodyMedium)
                    Text(stringResource(R.string.settings_widget_werte_hint), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = widgetWerte, onCheckedChange = null)
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // Währung und Preisgrundlage gehen zusammen an den Server (ein Endpunkt).
            Unterschrift(stringResource(R.string.settings_currency))
            WahlChips(
                listOf("CHF", "EUR", "USD", "GBP").map { it to it },
                gewaehlt = currency, onWahl = { vm.saveSettings(it, priceCondition) },
            )

            Unterschrift(stringResource(R.string.settings_price_condition))
            Text(stringResource(R.string.settings_price_basis),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            WahlChips(
                listOf("N" to stringResource(R.string.settings_condition_new),
                       "U" to stringResource(R.string.settings_condition_used)),
                gewaehlt = priceCondition, onWahl = { vm.saveSettings(currency, it) },
            )

            // ── Standard-Zustand beim Erfassen ──
            //
            // Drei Möglichkeiten, damit es einen Weg zurück zur Vorgabe des Servers gibt; der
            // Hinweis nennt, worauf sie steht. "" heisst beim Server: zurück auf die Vorgabe.
            Unterschrift(stringResource(R.string.settings_default_condition))
            val wirkt = if (effectiveUserDefault == "U") stringResource(R.string.condition_used)
                        else stringResource(R.string.condition_new)
            Text(stringResource(R.string.settings_default_condition_hint) + " " +
                    stringResource(R.string.settings_default_condition_effective, wirkt),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            WahlChips(
                listOf("" to stringResource(R.string.settings_default_condition_global),
                       "N" to stringResource(R.string.condition_new),
                       "U" to stringResource(R.string.condition_used)),
                gewaehlt = eigeneVorgabe ?: "", onWahl = { vm.saveUserDefaultCondition(it) },
            )
        }

        // ── 3. Server ──
        //
        // Die Serveradresse ist eine Einstellung wie Währung und Sprache, keine Handlung
        // an der laufenden Sitzung.
        val nutzerCa by app.nutzerCa.an.collectAsStateWithLifecycle()
        ServerCard(
            serverUrl = appState.serverUrl,
            onWechseln = onServerWechseln,
            nutzerCa = nutzerCa,
            // Einschalten fragt erst nach (NutzerCaDialog in MainActivity).
            onNutzerCa = { if (it) app.nutzerCa.anfragen() else app.nutzerCa.ausschalten() },
        )

        UpdateCard(
            updateZustand = updateZustand,
            onPruefen = { selbstUpdate.pruefeAufUpdate() },
            onLaden = { selbstUpdate.ladeUpdate() },
            onInstallieren = { selbstUpdate.starteInstallation() },
        )

        Spacer(Modifier.height(Abstaende.klein))

        // Dieselbe Rückfrage wie unter „Mehr“: Abmelden ist von beiden Stellen gleich schwer.
        var fragtAbmelden by rememberSaveable { mutableStateOf(false) }
        if (fragtAbmelden) ch.brickinventoryapp.ui.components.Rueckfrage(
            titel = stringResource(R.string.logout_confirm_title),
            text = stringResource(R.string.logout_confirm_text),
            bestaetigen = stringResource(R.string.settings_logout),
            onBestaetigen = { fragtAbmelden = false; onLogout() },
            onAbbrechen = { fragtAbmelden = false },
            symbol = Icons.AutoMirrored.Filled.Logout,
        )
        OutlinedButton(
            onClick = { fragtAbmelden = true },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.5f))
        ) {
            Icon(Icons.AutoMirrored.Filled.Logout, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
            Spacer(Modifier.width(Abstaende.klein))
            Text(stringResource(R.string.settings_logout), fontWeight = FontWeight.SemiBold)
        }
    }
}

/** Die Unterschrift einer Einstellung innerhalb einer Karte. */
@Composable
private fun Unterschrift(text: String) {
    Text(text,
        style = MaterialTheme.typography.labelLarge,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.semantics { heading() })
}

/**
 * Selbstaktualisierung aus dem GitHub-Release: beim Start still prüfen, nie von
 * allein laden, und hier ein Knopf zum Nachsehen. Die laufende Fassung steht immer
 * da, sonst wäre „Aktuell“ ohne Beleg. Herunterladen und Installieren sind zwei
 * Knöpfe, weil dazwischen ein Ausflug zur Erlaubnis „Pakete installieren“ liegen
 * kann.
 */
/**
 * Mit welchem Server die App spricht — und der Weg, ihn zu wechseln. Die Adresse
 * steht dabei, weil man genau deshalb hinsieht; bei zwei Installationen (Test und
 * Betrieb) ist das der Unterschied zu falschen Daten.
 */
@Composable
private fun ServerCard(
    serverUrl: String, onWechseln: () -> Unit, nutzerCa: Boolean, onNutzerCa: (Boolean) -> Unit,
) {
    SettingsCard(title = stringResource(R.string.main_menu_change_server), icon = Icons.Default.Cloud) {
        Text(
            serverUrl.ifBlank { "—" },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(Abstaende.klein))
        OutlinedButton(onClick = onWechseln) {
            Icon(Icons.Default.Cloud, null, modifier = Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
            Spacer(Modifier.width(Abstaende.klein))
            Text(stringResource(R.string.main_menu_change_server))
        }
        // Je Gerät und sofort wirksam (util/ServerVertrauen.kt); ausgeschaltet nur System-CAs.
        // Nur für den eigenen Server; Updates und fremde Hosts prüfen immer gegen das System.
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.settings_nutzer_ca), style = MaterialTheme.typography.bodyMedium)
                // In der Fehlerfarbe: Es ist ein Risiko, keine Komforteinstellung.
                Text(stringResource(R.string.settings_nutzer_ca_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error)
            }
            Switch(checked = nutzerCa, onCheckedChange = onNutzerCa)
        }
    }
}

@Composable
private fun UpdateCard(
    // `updateZustand`, nicht `zustand`: Die Prüfung „welcher Name trägt in dieser
    // Datei welchen Zustandstyp“ unterscheidet keine Gültigkeitsbereiche.
    updateZustand: ch.brickinventoryapp.ui.UpdateUiState,
    onPruefen: () -> Unit,
    onLaden: () -> Unit,
    onInstallieren: () -> Unit,
) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    SettingsCard(title = stringResource(R.string.update_title), icon = Icons.Default.SystemUpdate) {
        Text(
            stringResource(R.string.update_installed, ch.brickinventoryapp.ui.components.LocalAppFassung.current.name),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(Abstaende.klein))

        val neuere = updateZustand.neuereFassung
        when {
            neuere != null -> Text(
                stringResource(R.string.update_available, neuere.versionName),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.primary,
            )
            // Nur nach einer Pruefung: Vorher waere „aktuell" eine Aussage
            // ueber etwas, das niemand nachgesehen hat.
            updateZustand.geprueft -> Text(
                stringResource(R.string.update_current, ch.brickinventoryapp.ui.components.LocalAppFassung.current.name),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        updateZustand.fortschritt?.let { p ->
            Spacer(Modifier.height(Abstaende.klein))
            Text(stringResource(R.string.update_downloading, p),
                style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(Abstaende.winzig))
            LinearProgressIndicator(
                progress = { p / 100f },
                modifier = Modifier.fillMaxWidth(),
            )
        }

        if (updateZustand.erlaubnisFehlt) {
            Spacer(Modifier.height(Abstaende.klein))
            Text(
                stringResource(R.string.update_permission_needed),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(Abstaende.winzig))
            TextButton(onClick = {
                ctx.startActivity(ch.brickinventoryapp.util.erlaubnisAbsicht(ctx))
            }) { Text(stringResource(R.string.update_permission_grant)) }
        }

        updateZustand.fehler?.let { f ->
            Spacer(Modifier.height(Abstaende.klein))
            Text(f, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }

        Spacer(Modifier.height(Abstaende.mittel))
        Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = onPruefen, enabled = !updateZustand.laedtPruefung && updateZustand.fortschritt == null) {
                if (updateZustand.laedtPruefung) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(Abstaende.klein))
                }
                Text(stringResource(R.string.update_check))
            }
            // Herunterladen nur, wenn es etwas zu holen gibt; Installieren
            // nur, wenn es schon auf der Platte liegt.
            if (neuere != null && !updateZustand.bereitZurInstallation) {
                Button(onClick = onLaden, enabled = updateZustand.fortschritt == null) {
                    Text(stringResource(R.string.update_download))
                }
            }
            if (updateZustand.bereitZurInstallation) {
                Button(onClick = onInstallieren) {
                    Text(stringResource(R.string.update_install))
                }
            }
        }
    }
}
