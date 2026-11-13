package ch.brickinventoryapp.konto.ui.screens

import ch.brickinventoryapp.sitzung.AppUiState
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.ui.components.SchalterZeile
import ch.brickinventoryapp.ui.components.AppSperreWahl
import ch.brickinventoryapp.ui.components.LocalAppSperre
import ch.brickinventoryapp.zustand.ui.viewmodel.VertrauenViewModel
import ch.brickinventoryapp.zustand.ui.viewmodel.DarstellungViewModel
import ch.brickinventoryapp.zustand.ui.viewmodel.DarstellungAktionen
import ch.brickinventoryapp.konto.ui.viewmodel.UpdateAktionen
import ch.brickinventoryapp.konto.ui.viewmodel.EinstellungenAktionen
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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.konto.ui.viewmodel.EinstellungenViewModel
import ch.brickinventoryapp.konto.ui.UpdateUiState
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.ui.titel
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.model.ui.theme.Helligkeit
import ch.brickinventoryapp.ui.theme.mittigBis
import ch.brickinventoryapp.ui.components.WahlChips
import ch.brickinventoryapp.konto.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.update.util.quelleVeraltet
import ch.brickinventoryapp.ui.components.LocalAppFassung
import ch.brickinventoryapp.ui.components.Rueckfrage
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.theme.SYSTEMFARBEN_AB_SDK
import ch.brickinventoryapp.ui.theme.helligkeitWaehlbar
import ch.brickinventoryapp.update.util.UpdateFrische
import ch.brickinventoryapp.update.util.erlaubnisAbsicht
import ch.brickinventoryapp.ui.components.SettingsCard

/** Was die Einstellungen zeigen; die Route sammelt es aus vier Flüssen dreier ViewModels. */
data class EinstellungenZustand(
    val appState: AppUiState,
    val updateZustand: UpdateUiState,
    val helligkeit: String,
    val design: Design,
    val systemfarben: Boolean,
    val vorschauVerbergen: Boolean,
    val widgetWerte: Boolean,
    val nutzerCa: Boolean,
)

/** Die Einstellungen am Navigationsziel; Darstellung, Vertrauen und Update leben an der Activity. */
@Composable
internal fun SettingsRoute(
    vm: EinstellungenViewModel,
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
    val vorschauVerbergen by darstellung.vorschauVerbergen.collectAsStateWithLifecycle()
    val widgetWerte by darstellung.widgetWerte.collectAsStateWithLifecycle()
    val nutzerCa by vertrauen.nutzerCa.an.collectAsStateWithLifecycle()
    SettingsScreen(
        zustand = EinstellungenZustand(appState, updateZustand, helligkeit, design, systemfarben,
            vorschauVerbergen, widgetWerte, nutzerCa),
        aktionen = vm, update = selbstUpdate, darstellung = darstellung,
        // Einschalten fragt erst nach (NutzerCaDialog in MainActivity).
        onNutzerCa = { if (it) vertrauen.nutzerCa.anfragen() else vertrauen.nutzerCa.ausschalten() },
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
    val eigeneVorgabe = userDefaultCondition
    val effectiveUserDefault = eigeneVorgabe ?: defaultPriceCondition

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .mittigBis(Lesebreite.formular)
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
                gewaehlt = language, onWahl = { darstellung.setLanguage(it) },
            )

            // Darstellung je Gerät: System folgt dem Telefon, Hell und Dunkel gelten immer.
            Unterschrift(stringResource(R.string.settings_dark_label))
            val helligkeit = zustand.helligkeit
            val design = zustand.design
            val farbenDesSystems = zustand.systemfarben
            val waehlbar = helligkeitWaehlbar(design, farbenDesSystems, android.os.Build.VERSION.SDK_INT)
            WahlChips(
                listOf(Helligkeit.SYSTEM to stringResource(R.string.settings_hell_system),
                       Helligkeit.HELL to stringResource(R.string.settings_hell_hell),
                       Helligkeit.DUNKEL to stringResource(R.string.settings_hell_dunkel)),
                gewaehlt = helligkeit, onWahl = { darstellung.setHelligkeit(it) },
                enabled = waehlbar,
            )
            // Werkbank ist schon dunkel: Die Wahl ist aus, und der Satz sagt, warum.
            if (!waehlbar) Text(stringResource(R.string.settings_hell_fest), style = MaterialTheme.typography.bodySmall,
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
            val vorschauVerbergen = zustand.vorschauVerbergen
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .toggleable(value = vorschauVerbergen, role = Role.Switch, onValueChange = { darstellung.setVorschauVerbergen(it) }),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.settings_vorschau_verbergen), style = MaterialTheme.typography.bodyMedium)
                    Text(stringResource(R.string.settings_vorschau_verbergen_hint), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = vorschauVerbergen, onCheckedChange = null)
            }

            // Je Gerät, Vorgabe aus: Wer das Telefon teilt, sperrt die App nach einer Weile im Hintergrund.
            LocalAppSperre.current?.let { AppSperreWahl(it) }

            // Je Gerät, Vorgabe aus: Das Widget liegt ohne Entsperren auf dem Startbildschirm.
            val widgetWerte = zustand.widgetWerte
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .toggleable(value = widgetWerte, role = Role.Switch, onValueChange = { darstellung.setWidgetWerte(it) }),
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
                Waehrung.WAEHLBAR.map { it to it.code },
                gewaehlt = currency, onWahl = { aktionen.saveSettings(it, priceCondition) },
            )

            Unterschrift(stringResource(R.string.settings_price_condition))
            Text(stringResource(R.string.settings_price_basis),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            WahlChips(
                listOf(Zustand.NEU to stringResource(R.string.settings_condition_new),
                       Zustand.GEBRAUCHT to stringResource(R.string.settings_condition_used)),
                gewaehlt = priceCondition, onWahl = { aktionen.saveSettings(currency, it) },
            )

            // ── Standard-Zustand beim Erfassen ──
            //
            // Drei Möglichkeiten, damit es einen Weg zurück zur Vorgabe des Servers gibt; der
            // Hinweis nennt, worauf sie steht.
            Unterschrift(stringResource(R.string.settings_default_condition))
            val wirkt = if (effectiveUserDefault == Zustand.GEBRAUCHT) stringResource(R.string.condition_used)
                        else stringResource(R.string.condition_new)
            Text(stringResource(R.string.settings_default_condition_hint) + " " +
                    stringResource(R.string.settings_default_condition_effective, wirkt),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            WahlChips(
                listOf(null to stringResource(R.string.settings_default_condition_global),
                       Zustand.NEU to stringResource(R.string.condition_new),
                       Zustand.GEBRAUCHT to stringResource(R.string.condition_used)),
                gewaehlt = eigeneVorgabe, onWahl = { aktionen.saveUserDefaultCondition(it) },
            )
        }

        // ── 3. Server ──
        //
        // Die Serveradresse ist eine Einstellung wie Währung und Sprache, keine Handlung
        // an der laufenden Sitzung.
        val nutzerCa = zustand.nutzerCa
        ServerCard(
            serverUrl = appState.serverUrl,
            onWechseln = onServerWechseln,
            nutzerCa = nutzerCa,
            onNutzerCa = onNutzerCa,
        )

        UpdateCard(
            updateZustand = updateZustand,
            onPruefen = { update.pruefeAufUpdate() },
            onLaden = { update.ladeUpdate() },
            onInstallieren = { update.starteInstallation() },
        )

        DatenschutzKarte(updateZustand.startpruefung) { update.setzeStartpruefung(it) }

        Spacer(Modifier.height(Abstaende.klein))

        // Dieselbe Rückfrage wie unter „Mehr“: Abmelden ist von beiden Stellen gleich schwer.
        var fragtAbmelden by rememberSaveable { mutableStateOf(false) }
        if (fragtAbmelden) Rueckfrage(
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
            Icon(Icons.AutoMirrored.Filled.Logout, null, Modifier.size(mitSchrift(18.dp)))
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
        OutlinedButton(onClick = onWechseln, colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
            Icon(Icons.Default.Cloud, null, modifier = Modifier.size(mitSchrift(18.dp)))
            Spacer(Modifier.width(Abstaende.klein))
            Text(stringResource(R.string.main_menu_change_server))
        }
        // Je Gerät und sofort wirksam (util/ServerVertrauen.kt); ausgeschaltet nur System-CAs.
        // Nur für den eigenen Server; Updates und fremde Hosts prüfen immer gegen das System.
        // Hinweis in der Fehlerfarbe: Es ist ein Risiko, keine Komforteinstellung.
        SchalterZeile(stringResource(R.string.settings_nutzer_ca), nutzerCa, onNutzerCa,
            hinweis = stringResource(R.string.settings_nutzer_ca_hint), hinweisFarbe = MaterialTheme.colorScheme.error)
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
            stringResource(R.string.update_installed, LocalAppFassung.current.name),
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
            // ueber etwas, das niemand nachgesehen hat. Eine veraltete Quelle
            // ist nie „aktuell“ (Hinweis darunter).
            updateZustand.geprueft && !quelleVeraltet(updateZustand.frische) -> Text(
                stringResource(R.string.update_current, LocalAppFassung.current.name),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (quelleVeraltet(updateZustand.frische)) {
            Spacer(Modifier.height(Abstaende.klein))
            Text(
                stringResource(if (updateZustand.frische == UpdateFrische.ABGELAUFEN)
                    R.string.update_quelle_abgelaufen else R.string.update_quelle_zurueckgesetzt),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
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
                ctx.startActivity(erlaubnisAbsicht(ctx))
            }) { Text(stringResource(R.string.update_permission_grant)) }
        }

        updateZustand.fehler?.let { f ->
            Spacer(Modifier.height(Abstaende.klein))
            Text(f.satz(), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }

        Spacer(Modifier.height(Abstaende.mittel))
        Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = onPruefen, enabled = !updateZustand.laedtPruefung && updateZustand.fortschritt == null, colors = nebenKnopfFarben(), border = nebenKnopfRand(!updateZustand.laedtPruefung && updateZustand.fortschritt == null)) {
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

/** Je Gerät: Die Prüfung beim Start ist eine Anfrage an GitHub (Datenschutz). */
@Composable
private fun StartpruefungZeile(an: Boolean, onWechsel: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp)
            .toggleable(value = an, role = Role.Switch, onValueChange = onWechsel),
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
private fun DatenschutzKarte(startpruefung: Boolean, onStartpruefung: (Boolean) -> Unit) {
    SettingsCard(title = stringResource(R.string.datenschutz_titel), icon = Icons.Default.PrivacyTip) {
        Text(stringResource(R.string.datenschutz_text), style = MaterialTheme.typography.bodyMedium)
        StartpruefungZeile(startpruefung, onStartpruefung)
    }
}
