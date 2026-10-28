package ch.brickinventoryapp.ui.screens

import androidx.compose.ui.semantics.heading
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.AppViewModel
import ch.brickinventoryapp.ui.viewmodel.EinstellungenViewModel
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.theme.Abstaende
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import ch.brickinventoryapp.ui.viewmodel.aktivitaetsViewModel
import ch.brickinventoryapp.ui.viewmodel.UpdateViewModel

/**
 * Die Einstellungen — wenige Karten statt eines Stapels: Anzeige & Preise (Sprache
 * wirkt sofort, die drei darunter mit dem Speichern-Knopf), Server und
 * Aktualisierung. Die Rubriken mit eigener Seite liegen in der Konto-Klappe
 * (MainScaffold.kt) und in EinstellungenUnterseiten.kt.
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

    val onSave: (String, String) -> Unit = { cur, cond ->
        vm.saveSettings(cur, cond)
    }

    var selectedCurrency  by remember(currency)       { mutableStateOf(currency) }
    var selectedCondition by remember(priceCondition) { mutableStateOf(priceCondition) }
    // Rückfall auf die globale Vorgabe des Servers beim Erfassen
    // (`defaultPriceCondition`), nicht auf die Preisgrundlage für Bewertungen. `null`
    // heisst: keine eigene Vorgabe — nicht dasselbe wie "N".
    val eigeneVorgabe = userDefaultCondition?.takeIf { it.isNotBlank() }
    val effectiveUserDefault = eigeneVorgabe ?: defaultPriceCondition
    var selectedUserDefault by remember(eigeneVorgabe) { mutableStateOf(eigeneVorgabe) }
    val hasChanges = selectedCurrency != currency || selectedCondition != priceCondition ||
        selectedUserDefault != eigeneVorgabe

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(horizontal = Abstaende.gross, vertical = Abstaende.gross),
        // gross statt der blanken 10 dp von vorher: Die Karten sind jetzt
        // wenige und gross, und zwischen ihnen soll Luft sein.
        verticalArrangement = Arrangement.spacedBy(Abstaende.gross)
    ) {
        // Hier steht nur, was eine Einstellung im engeren Sinn ist: Anzeige & Preise,
        // Server, Update-Prüfung. Die Rubriken mit eigener Seite liegen in der
        // Konto-Klappe, einen Tipper näher.
        //
        // ── 2. Anzeige & Preise ──
        SettingsCard(title = stringResource(R.string.settings_group_display),
                     icon = Icons.Default.Euro) {
            Unterschrift(stringResource(R.string.settings_language))
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                modifier = Modifier.fillMaxWidth()) {
                val options = listOf(
                    "system" to stringResource(R.string.settings_language_system),
                    "en"     to stringResource(R.string.settings_language_en),
                    "de"     to stringResource(R.string.settings_language_de)
                )
                options.forEach { (code, label) ->
                    FilterChip(
                        selected = language == code,
                        onClick = { app.setLanguage(code) },
                        label = { Text(label) },
                        shape = Formen.chip
                    )
                }
            }

            // Darstellung je Gerät — wirkt sofort wie die Sprache.
            Unterschrift(stringResource(R.string.settings_dark_label))
            val dunkel by app.dunkelNachSystem.collectAsStateWithLifecycle()
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                modifier = Modifier.fillMaxWidth()) {
                FilterChip(
                    selected = !dunkel,
                    onClick = { app.setDunkelNachSystem(false) },
                    label = { Text(stringResource(R.string.settings_dark_server)) },
                    shape = Formen.chip
                )
                FilterChip(
                    selected = dunkel,
                    onClick = { app.setDunkelNachSystem(true) },
                    label = { Text(stringResource(R.string.settings_dark_system)) },
                    shape = Formen.chip
                )
            }

            // Die Linie trennt, was SOFORT wirkt (Sprache), von dem, was der
            // Knopf darunter speichert. Ohne sie stuenden vier Wahlmoeglichkeiten
            // da, von denen drei erst spaeter gelten — und niemand saehe, welche.
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            Unterschrift(stringResource(R.string.settings_currency))
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                modifier = Modifier.fillMaxWidth()) {
                listOf("CHF", "EUR", "USD", "GBP").forEach { cur ->
                    FilterChip(
                        selected = selectedCurrency == cur,
                        onClick = { selectedCurrency = cur },
                        label = { Text(cur, fontWeight = FontWeight.SemiBold) },
                        shape = Formen.chip
                    )
                }
            }

            Unterschrift(stringResource(R.string.settings_price_condition))
            Text(stringResource(R.string.settings_price_basis),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                FilterChip(
                    selected = selectedCondition == "N",
                    onClick = { selectedCondition = "N" },
                    label = { Text(stringResource(R.string.settings_condition_new)) },
                    shape = Formen.chip
                )
                FilterChip(
                    selected = selectedCondition == "U",
                    onClick = { selectedCondition = "U" },
                    label = { Text(stringResource(R.string.settings_condition_used)) },
                    shape = Formen.chip
                )
            }

            // ── Standard-Zustand beim Erfassen ──
            //
            // Drei Möglichkeiten, damit es einen Weg zurück zur Vorgabe des Servers gibt; der
            // Hinweis nennt, worauf sie steht.
            Unterschrift(stringResource(R.string.settings_default_condition))
            val wirkt = if (effectiveUserDefault == "U") stringResource(R.string.condition_used)
                        else stringResource(R.string.condition_new)
            Text(stringResource(R.string.settings_default_condition_hint) + " " +
                    stringResource(R.string.settings_default_condition_effective, wirkt),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                FilterChip(
                    selected = selectedUserDefault == null,
                    onClick = { selectedUserDefault = null },
                    label = { Text(stringResource(R.string.settings_default_condition_global)) },
                    shape = Formen.chip
                )
                FilterChip(
                    selected = selectedUserDefault == "N",
                    onClick = { selectedUserDefault = "N" },
                    label = { Text(stringResource(R.string.condition_new)) },
                    shape = Formen.chip
                )
                FilterChip(
                    selected = selectedUserDefault == "U",
                    onClick = { selectedUserDefault = "U" },
                    label = { Text(stringResource(R.string.condition_used)) },
                    shape = Formen.chip
                )
            }

            Button(
                onClick = {
                    onSave(selectedCurrency, selectedCondition)
                    // Leerer String = zuruecksetzen auf die Vorgabe des Servers.
                    // So versteht es der Endpunkt (siehe BrickRepository).
                    vm.saveUserDefaultCondition(selectedUserDefault ?: "")
                },
                enabled = hasChanges,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                shape = Formen.knopf
            ) {
                Icon(Icons.Default.Save, null, Modifier.size(18.dp))
                Spacer(Modifier.width(Abstaende.klein))
                Text(stringResource(R.string.settings_save), fontWeight = FontWeight.SemiBold)
            }
        }

        // ── 3. Server ──
        //
        // Die Serveradresse ist eine Einstellung wie Währung und Sprache, keine Handlung
        // an der laufenden Sitzung.
        ServerCard(
            serverUrl = appState.serverUrl,
            onWechseln = onServerWechseln,
        )

        UpdateCard(
            updateZustand = updateZustand,
            onPruefen = { selbstUpdate.pruefeAufUpdate() },
            onLaden = { selbstUpdate.ladeUpdate() },
            onInstallieren = { selbstUpdate.starteInstallation() },
        )

        Spacer(Modifier.height(Abstaende.klein))

        OutlinedButton(
            onClick = onLogout,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            shape = Formen.knopf,
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.5f))
        ) {
            Icon(Icons.AutoMirrored.Filled.Logout, null, Modifier.size(18.dp))
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
        fontWeight = FontWeight.SemiBold)
}



/**
 * Der Rahmen einer Einstellungs-Rubrik. `internal`, weil die Karten in eigenen
 * Dateien ihn teilen — eine zweite Fassung sähe irgendwann anders aus.
 */
@Composable
internal fun SettingsCard(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    content: @Composable ColumnScope.() -> Unit
) {
    AppKarte {
        // Der Abstand zwischen den Kindern einer Karte steht einmal hier, damit jede Karte
        // ihn bekommt, ohne dass jemand daran denkt.
        Column(
            Modifier.padding(Abstaende.gross),
            verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                modifier = Modifier.padding(bottom = Abstaende.mittel)
            ) {
                Icon(icon, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                Text(title.uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    letterSpacing = 0.8.sp,
                    modifier = Modifier.semantics { heading() })
            }
            content()
        }
    }
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
private fun ServerCard(serverUrl: String, onWechseln: () -> Unit) {
    SettingsCard(title = stringResource(R.string.main_menu_change_server), icon = Icons.Default.Cloud) {
        Text(
            serverUrl.ifBlank { "—" },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(Abstaende.klein))
        OutlinedButton(onClick = onWechseln) {
            Icon(Icons.Default.Cloud, null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(Abstaende.klein))
            Text(stringResource(R.string.main_menu_change_server))
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
            stringResource(R.string.update_installed, ch.brickinventoryapp.BuildConfig.VERSION_NAME),
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
                stringResource(R.string.update_current, ch.brickinventoryapp.BuildConfig.VERSION_NAME),
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
