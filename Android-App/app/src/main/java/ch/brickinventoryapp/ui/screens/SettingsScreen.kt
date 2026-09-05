package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.AppKarte
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.automirrored.filled.Label
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import ch.brickinventoryapp.R
import ch.brickinventoryapp.util.fmtDatum
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.*  // Feature-Extensions (saveSettings, setLanguage, …)

@Composable
fun SettingsScreen(
    vm: MainViewModel,
    /** Abmelden — nur der Graph kennt den NavController. */
    onLogout: () -> Unit,
) {
    // Zustand und Aktionen vom ViewModel statt über zwölf Parameter — dasselbe
    // Muster wie in Galerie/Finanzen/Teile/Minifiguren (Nachtrag 96). Die Namen
    // darunter bleiben absichtlich dieselben, damit der Rumpf unverändert ist.
    //
    // Der Umbau hat hier zugleich einen Fehler beseitigt: `userDefaultCondition`
    // und `onSaveUserDefaultCondition` hatten Vorgabewerte (null bzw. {}), und
    // die einzige Aufrufstelle in ToolsGraph.kt reichte BEIDE nicht durch. Die
    // Karte „Standard-Zustand" zeigte deshalb immer den Preiszustand, der
    // Speichern-Knopf wurde bei einer Änderung aktiv, und die Wahl fiel beim
    // Speichern still unter den Tisch — saveUserDefaultCondition() im ViewModel
    // hatte keinen einzigen Aufrufer. Ohne Vorgabewerte wäre das ein
    // Compilerfehler gewesen; jetzt gibt es die Parameter gar nicht mehr.
    // `appState`, nicht `state`: In DIESER Datei ist `state` schon vergeben —
    // HouseholdCard() weiter unten nimmt einen Parameter dieses Namens vom Typ
    // HouseholdUiState. Zwei Bedeutungen für einen Namen in einer Datei sind
    // für den Compiler unproblematisch (getrennte Gültigkeitsbereiche), für
    // den Leser und für UiStateFieldsTest aber nicht: Der Test bestimmt den
    // Typ je DATEI und meldete prompt drei angeblich fehlende Felder.
    val appState by vm.state.collectAsStateWithLifecycle()
    val household by vm.householdState.collectAsStateWithLifecycle()
    // `updateZustand`, nicht `update`: In dieser Datei gilt dieselbe
    // Namensfalle wie bei `state` und `geraete` weiter oben —
    // UiStateFieldsTest bestimmt den Typ je Datei ueber den Namen.
    val updateZustand by vm.updateState.collectAsStateWithLifecycle()
    // `geraeteZustand`, nicht `geraete`: Sonst haelt UiStateFieldsTest jedes
    // spaetere `geraete.<x>` fuer einen Feldzugriff auf GeraeteUiState —
    // dieselbe Falle wie bei `state` im Absatz darueber, nur eine Ebene
    // tiefer. Der oertliche Spiegel hat prompt acht Stellen gemeldet.
    val geraeteZustand by vm.geraeteState.collectAsStateWithLifecycle()
    // `kontoZustand`, nicht `konto`: dieselbe Begruendung wie zwei Absaetze
    // darueber — UiStateFieldsTest bestimmt den Typ je Name und Datei.
    val kontoZustand by vm.kontoState.collectAsStateWithLifecycle()
    val csvZustand by vm.csvHochladenState.collectAsStateWithLifecycle()

    // Einmal beim Betreten laden. LaunchedEffect(Unit) und nicht bei jedem
    // Neuzeichnen: Die Liste aendert sich nur, wenn sich ein Geraet an- oder
    // abmeldet, und ein Abruf je Bildaufbau waere eine Anfrage pro Tastendruck
    // in den Feldern darueber.
    LaunchedEffect(Unit) { vm.ladeGeraete() }
    // Und das eigene Konto, aus demselben Grund: einmal, nicht je Neuzeichnen.
    LaunchedEffect(Unit) { vm.ladeProfil() }

    val currency = appState.currency
    val priceCondition = appState.priceCondition
    val userDefaultCondition = appState.userDefaultCondition
    val defaultPriceCondition = appState.defaultPriceCondition
    val language = appState.language

    val onSave: (String, String) -> Unit = { cur, cond ->
        vm.saveSettings(cur, cond)
        vm.loadValuation()
    }
    val onSaveUserDefaultCondition: (String) -> Unit = { cond -> vm.saveUserDefaultCondition(cond) }
    val onLanguageChange: (String) -> Unit = { code -> vm.setLanguage(code) }
    val onCreateInvite: () -> Unit = { vm.createHouseholdInvite() }
    val onRedeemInvite: (String) -> Unit = { code -> vm.redeemHouseholdInvite(code) }
    val onUnlink: (Int?) -> Unit = { id -> vm.unlinkHousehold(id) }

    var selectedCurrency  by remember(currency)       { mutableStateOf(currency) }
    var selectedCondition by remember(priceCondition) { mutableStateOf(priceCondition) }
    // If user hasn't set their own default yet, inherit from monitoring global default
    // Rückfall auf die GLOBALE Vorgabe des Servers, nicht auf die
    // Preisgrundlage (Nachtrag 118). Bis hierher stand da `?: priceCondition` —
    // zwei verschiedene Einstellungen, die nur zufällig oft denselben Wert
    // haben: `priceCondition` ist die Grundlage für BrickLink-BEWERTUNGEN,
    // `defaultPriceCondition` die serverseitige Vorbelegung beim ERFASSEN.
    // Genau die stand als "— Globale Vorgabe —" auf dem Knopf daneben, wurde
    // aus der Serverantwort auch geladen — und dann nirgends gelesen. Wer die
    // Bewertung auf "Gebraucht" stellte, sah als angebliche globale Vorgabe
    // "Gebraucht", obwohl der Server "Neu" vorgibt.
    // `null` heisst: KEINE eigene Vorgabe, es gilt die des Servers. Das ist ein
    // eigener Zustand und nicht dasselbe wie "N" — der Unterschied fehlte bis
    // Nachtrag 119 in der Oberfläche, siehe die Karte weiter unten.
    val eigeneVorgabe = userDefaultCondition?.takeIf { it.isNotBlank() }
    val effectiveUserDefault = eigeneVorgabe ?: defaultPriceCondition
    var selectedUserDefault by remember(eigeneVorgabe) { mutableStateOf(eigeneVorgabe) }
    val hasChanges = selectedCurrency != currency || selectedCondition != priceCondition || selectedUserDefault != eigeneVorgabe

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Currency
        SettingsCard(title = stringResource(R.string.settings_currency), icon = Icons.Default.Euro) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                listOf("CHF", "EUR", "USD", "GBP").forEach { cur ->
                    FilterChip(
                        selected = selectedCurrency == cur,
                        onClick = { selectedCurrency = cur },
                        label = { Text(cur, fontWeight = FontWeight.SemiBold) },
                        shape = Formen.chip
                    )
                }
            }
        }

        // User default condition (Erfassungs-Default)
        // ── Standard-Zustand beim Erfassen ──────────────────────────────────
        //
        // DREI Möglichkeiten, nicht zwei (Nachtrag 119). Bis hierher gab es nur
        // "Neu" und "Gebraucht" — es fehlte der Weg ZURÜCK zur Vorgabe des
        // Servers. Wer den Zustand einmal setzte, hatte für immer eine eigene
        // Übersteuerung: `userDefaultCondition` ist zwar nullable, der
        // Endpunkt nimmt einen leeren String als "zurücksetzen" entgegen
        // (BrickRepository.setUserDefaultCondition), und die Texte dafür lagen
        // seit Langem in strings.xml — nur der Knopf fehlte. Dazu sah "Neu"
        // ausgewählt aus, sobald der Wert nicht "U" war, also auch dann, wenn
        // der Nutzer nie etwas gewählt hatte.
        SettingsCard(title = stringResource(R.string.settings_default_condition), icon = Icons.AutoMirrored.Filled.Label) {
            // Der Hinweis nennt auch, WORAUF die globale Vorgabe gerade steht —
            // sonst wählt man "— Globale Vorgabe —" blind.
            val wirkt = if (effectiveUserDefault == "U") stringResource(R.string.condition_used)
                        else stringResource(R.string.condition_new)
            Text(stringResource(R.string.settings_default_condition_hint) + " " +
                    stringResource(R.string.settings_default_condition_effective, wirkt),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
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
        }

        // Condition
        SettingsCard(title = stringResource(R.string.settings_price_condition), icon = Icons.Default.Grade) {
            Text(stringResource(R.string.settings_price_basis),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
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
        }

        // Language
        SettingsCard(title = stringResource(R.string.settings_language), icon = Icons.Default.Language) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                val options = listOf(
                    "system" to stringResource(R.string.settings_language_system),
                    "en"     to stringResource(R.string.settings_language_en),
                    "de"     to stringResource(R.string.settings_language_de)
                )
                options.forEach { (code, label) ->
                    FilterChip(
                        selected = language == code,
                        onClick = { onLanguageChange(code) },
                        label = { Text(label) },
                        shape = Formen.chip
                    )
                }
            }
        }

        HouseholdCard(
            state = household,
            onCreateInvite = onCreateInvite,
            onRedeemInvite = onRedeemInvite,
            onUnlink = onUnlink,
        )

        KontoCard(
            kontoZustand = kontoZustand,
            onSpeichern = { b, e, v, n -> vm.speichereProfil(b, e, v, n) },
            onPasswort = { alt, neu -> vm.aenderePasswort(alt, neu) },
            onMeldungWeg = { vm.kontoMeldungWeg() },
        )

        CsvImportCard(
            csvZustand = csvZustand,
            onDatei = { art, uri -> vm.ladeCsvHoch(art, uri) },
            onSchliessen = { vm.csvHochladenWeg() },
        )

        GeraeteCard(
            zustand = geraeteZustand,
            onReload = { vm.ladeGeraete() },
            onRevoke = { vm.entwerteGeraet(it) },
            onRevokeOthers = { vm.entwerteAndereGeraete() },
        )

        UpdateCard(
            updateZustand = updateZustand,
            onPruefen = { vm.pruefeAufUpdate() },
            onLaden = { vm.ladeUpdate() },
            onInstallieren = { vm.starteInstallation() },
        )

        // Current settings summary
        if (!hasChanges) {
            Surface(
                shape = Formen.leiste,
                color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    Modifier.padding(14.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.CheckCircle, null,
                        tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                    Column {
                        Text(stringResource(R.string.settings_current_settings),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onPrimaryContainer)
                        Text(
                            stringResource(
                                R.string.settings_current_summary,
                                currency,
                                if (priceCondition == "N") stringResource(R.string.settings_condition_new)
                                else stringResource(R.string.settings_condition_used)
                            ),
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                            fontSize = 14.sp)
                    }
                }
            }
        }

        // Save button
        Button(
            onClick = {
                onSave(selectedCurrency, selectedCondition)
                // Leerer String = zurücksetzen auf die Vorgabe des Servers.
                // So versteht es der Endpunkt (siehe BrickRepository).
                onSaveUserDefaultCondition(selectedUserDefault ?: "")
            },
            enabled = hasChanges,
            modifier = Modifier.fillMaxWidth().height(48.dp),
            shape = Formen.knopf
        ) {
            Icon(Icons.Default.Save, null, Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.settings_save), fontWeight = FontWeight.SemiBold)
        }

        Spacer(Modifier.weight(1f, fill = false))
        Spacer(Modifier.height(24.dp))

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        // Logout
        OutlinedButton(
            onClick = onLogout,
            modifier = Modifier.fillMaxWidth().height(48.dp),
            shape = Formen.knopf,
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
            border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.5f))
        ) {
            Icon(Icons.AutoMirrored.Filled.Logout, null, Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.settings_logout), fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun SettingsCard(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    content: @Composable ColumnScope.() -> Unit
) {
    AppKarte {
        Column(Modifier.padding(16.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(bottom = 12.dp)
            ) {
                Icon(icon, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                Text(title.uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    letterSpacing = 0.8.sp)
            }
            content()
        }
    }
}


/**
 * Angemeldete Geräte: die ausgestellten Zugänge sehen und aussperren.
 *
 * ── Warum der eigene Zugang keinen Knopf hat ────────────────────────────────
 * Der Server markiert die Zeile, mit der GERADE gefragt wird. Wer sie
 * entwertet, meldet sich selbst ab — ohne dass ein Mülleimer-Symbol das sagt.
 * Für „dieses Gerät abmelden" gibt es den Abmelden-Knopf am Ende der Seite;
 * er benennt, was er tut.
 *
 * ── Datumsangaben über fmtDatum(), nicht selbst gebaut ─────────────────────
 * Der Server liefert ISO-Zeitstempel. `iso.take(10)` wäre die dritte Fassung
 * derselben Umwandlung im Baum gewesen; die ersten beiden sind in
 * util/DatumFormat.kt zusammengelegt worden, weil eine davon bei Zeitstempeln
 * OHNE Millisekunden still null ergab (siehe DatumFormatTest). Genau solche
 * Zeitstempel liefert api_tokens.
 *
 * „Nie benutzt" bekommt einen eigenen Text statt eines leeren Feldes —
 * `new Date(null)` wäre der 1.1.1970, und ein leeres Feld sieht aus wie ein
 * Fehler.
 */
@Composable
private fun GeraeteCard(
    zustand: ch.brickinventoryapp.ui.GeraeteUiState,
    onReload: () -> Unit,
    onRevoke: (String) -> Unit,
    onRevokeOthers: () -> Unit,
) {
    var fragt by rememberSaveable { mutableStateOf<String?>(null) }
    var fragtAlle by rememberSaveable { mutableStateOf(false) }

    SettingsCard(title = stringResource(R.string.tokens_title), icon = Icons.Default.Devices) {
        Text(stringResource(R.string.tokens_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 12.dp))

        when {
            zustand.laedt && zustand.geraete.isEmpty() ->
                CircularProgressIndicator(Modifier.size(22.dp))
            zustand.fehler != null ->
                Text(zustand.fehler, color = MaterialTheme.colorScheme.error,
                     style = MaterialTheme.typography.bodySmall)
            zustand.geraete.isEmpty() ->
                Text(stringResource(R.string.tokens_none),
                     style = MaterialTheme.typography.bodySmall,
                     color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (g in zustand.geraete) {
                    Row(verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(g.label ?: "—", fontWeight = FontWeight.SemiBold)
                                if (g.aktuell) Surface(
                                    shape = Formen.chip,
                                    color = MaterialTheme.colorScheme.primaryContainer,
                                ) {
                                    Text(stringResource(R.string.tokens_current),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                                }
                            }
                            Text(
                                stringResource(R.string.tokens_row_hint,
                                    fmtDatum(g.createdAt) ?: "—",
                                    fmtDatum(g.lastUsed) ?: stringResource(R.string.tokens_unused),
                                    if (g.neverExpires) stringResource(R.string.tokens_never) else (fmtDatum(g.expiresAt) ?: "—")),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (!g.aktuell) IconButton(onClick = { fragt = g.tokenId }) {
                            Icon(Icons.Default.Delete,
                                stringResource(R.string.tokens_revoke_title),
                                tint = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
        }

        Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onReload, shape = Formen.knopf) {
                Text(stringResource(R.string.tokens_reload))
            }
            // Nur anbieten, wenn es wirklich andere gibt — ein Knopf, der
            // immer „es gibt keine anderen" meldet, ist schlimmer als keiner.
            if (zustand.geraete.count { !it.aktuell } > 0) {
                OutlinedButton(
                    onClick = { fragtAlle = true },
                    shape = Formen.knopf,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text(stringResource(R.string.tokens_revoke_others)) }
            }
        }
    }

    // Rückfrage: Ein Zugang, der weg ist, kommt nicht wieder — das Gerät
    // dahinter muss sich neu anmelden.
    val zuEntwerten = fragt
    if (zuEntwerten != null) AlertDialog(
        onDismissRequest = { fragt = null },
        title = { Text(stringResource(R.string.tokens_revoke_title)) },
        text = { Text(stringResource(R.string.tokens_revoke_text,
            zustand.geraete.firstOrNull { it.tokenId == zuEntwerten }?.label ?: "—")) },
        confirmButton = {
            TextButton(onClick = { fragt = null; onRevoke(zuEntwerten) }) {
                Text(stringResource(R.string.tokens_revoke_confirm),
                     color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = { fragt = null }) { Text(stringResource(R.string.common_cancel)) }
        },
    )

    if (fragtAlle) AlertDialog(
        onDismissRequest = { fragtAlle = false },
        title = { Text(stringResource(R.string.tokens_revoke_others_title)) },
        text = { Text(stringResource(R.string.tokens_revoke_others_text,
            zustand.geraete.count { !it.aktuell })) },
        confirmButton = {
            TextButton(onClick = { fragtAlle = false; onRevokeOthers() }) {
                Text(stringResource(R.string.tokens_revoke_confirm),
                     color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = { fragtAlle = false }) { Text(stringResource(R.string.common_cancel)) }
        },
    )
}

/**
 * Haushalts-Karte: verknüpfen, Einladungscode erzeugen, Verknüpfung lösen.
 *
 * Zeigt je nach Rolle nur EINEN der beiden Kästen. Wer schon Unterkonto ist,
 * sieht keinen Einladungsknopf (Konten lassen sich nur über eine Stufe
 * verknüpfen), und wer Unterkonten hat, sieht kein Eingabefeld. Beides würde
 * der Server ohnehin ablehnen — aber ein Knopf, der immer eine Fehlermeldung
 * erzeugt, ist schlimmer als keiner.
 */
@Composable
private fun HouseholdCard(
    state: ch.brickinventoryapp.ui.HouseholdUiState,
    onCreateInvite: () -> Unit,
    onRedeemInvite: (String) -> Unit,
    onUnlink: (Int?) -> Unit,
) {
    val st = state.status
    var code by rememberSaveable { mutableStateOf("") }
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current

    SettingsCard(title = stringResource(R.string.household_title), icon = Icons.Default.Group) {
        Text(stringResource(R.string.household_intro),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)

        when {
            st == null -> {}
            st.isSub -> {
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.household_state_sub, st.linkedTo?.username ?: ""),
                        style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                    TextButton(onClick = { onUnlink(null) }) {
                        Text(stringResource(R.string.household_unlink))
                    }
                }
            }
            st.subAccounts.isNotEmpty() -> {
                Text(stringResource(R.string.household_state_main),
                    style = MaterialTheme.typography.labelLarge)
                st.subAccounts.forEach { m ->
                    Row(verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(m.username, modifier = Modifier.weight(1f),
                            fontWeight = FontWeight.SemiBold)
                        TextButton(onClick = { onUnlink(m.id) }) {
                            Text(stringResource(R.string.household_remove))
                        }
                    }
                }
            }
            else -> Text(stringResource(R.string.household_state_none),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        // Einladen kann, wer nicht selbst Unterkonto ist.
        if (st != null && !st.isSub) {
            HorizontalDivider()
            Text(stringResource(R.string.household_invite_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(onClick = onCreateInvite, enabled = !state.isLoading) {
                Text(stringResource(R.string.household_invite_create))
            }
            state.inviteCode?.let { c ->
                OutlinedTextField(
                    value = c, onValueChange = {}, readOnly = true, singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = {
                        IconButton(onClick = {
                            clipboard.setText(androidx.compose.ui.text.AnnotatedString(c))
                        }) { Icon(Icons.Default.ContentCopy, stringResource(R.string.household_invite_copy)) }
                    }
                )
            }
        }

        // Einlösen kann, wer weder Unterkonto noch Hauptkonto ist.
        if (st != null && !st.isSub && st.subAccounts.isEmpty()) {
            HorizontalDivider()
            Text(stringResource(R.string.household_redeem_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(
                value = code, onValueChange = { code = it }, singleLine = true,
                label = { Text(stringResource(R.string.household_redeem_title)) },
                modifier = Modifier.fillMaxWidth()
            )
            Button(onClick = { onRedeemInvite(code); code = "" },
                   enabled = code.isNotBlank() && !state.isLoading) {
                Text(stringResource(R.string.household_redeem_submit))
            }
        }

        // Meldung des Servers — Währung weicht ab, Konto schon verknüpft,
        // zweite Stufe. Wortlaut unverändert übernommen.
        state.message?.let {
            Text(it, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }
    }
}

/**
 * Das eigene Konto: Profil und Passwort.
 *
 * ── Warum es das in der App erst jetzt gibt (Nachtrag 127) ──────────────────
 *
 * Nicht, weil der Server es nicht koennte: /auth/profile und
 * /auth/change-password gibt es seit jeher. Sie hingen an einem Waechter, der
 * ausschliesslich die Browser-Sitzung kannte — und die App hat keine, sie
 * weist sich mit einem Bearer-Token aus. Fuenf weitere „fehlende Funktionen"
 * der App hatten dieselbe Ursache.
 */
@Composable
private fun KontoCard(
    // `kontoZustand`, nicht `zustand`: In DIESER Datei ist `zustand` schon
    // vergeben — GeraeteCard nimmt einen Parameter dieses Namens vom Typ
    // GeraeteUiState. Fuer den Compiler ist das unproblematisch (getrennte
    // Gueltigkeitsbereiche), fuer UiStateFieldsTest nicht: Der bestimmt den Typ
    // je Name und DATEI und meldete prompt sechs angeblich fehlende Felder.
    // Dieselbe Falle steht zweimal im Kopf dieser Datei beschrieben — und ich
    // bin trotzdem hineingelaufen.
    kontoZustand: ch.brickinventoryapp.ui.KontoUiState,
    onSpeichern: (String, String, String, String) -> Unit,
    onPasswort: (String, String) -> Unit,
    onMeldungWeg: () -> Unit,
) {
    val profil = kontoZustand.profil
    // Die Felder werden aus dem Serverstand vorbelegt und danach vom Nutzer
    // gefuehrt. `remember(profil)` und nicht `remember`: Nach dem Speichern
    // holt das ViewModel das Profil neu, und die Felder sollen den
    // NORMALISIERTEN Stand des Servers zeigen, nicht das Getippte.
    var benutzername by remember(profil) { mutableStateOf(profil?.username.orEmpty()) }
    var email        by remember(profil) { mutableStateOf(profil?.email.orEmpty()) }
    var vorname      by remember(profil) { mutableStateOf(profil?.firstName.orEmpty()) }
    var nachname     by remember(profil) { mutableStateOf(profil?.lastName.orEmpty()) }
    var pwAktuell    by rememberSaveable { mutableStateOf("") }
    var pwNeu        by rememberSaveable { mutableStateOf("") }

    val geaendert = profil != null && (
        benutzername != profil.username.orEmpty() || email != profil.email.orEmpty() ||
        vorname != profil.firstName.orEmpty() || nachname != profil.lastName.orEmpty())

    SettingsCard(title = stringResource(R.string.konto_title), icon = Icons.Default.AccountCircle) {
        if (kontoZustand.laedt && profil == null) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
        }

        if (kontoZustand.meldung != null) {
            Text(kontoZustand.meldung, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary)
        }
        if (kontoZustand.fehler != null) {
            Text(kontoZustand.fehler, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }

        if (profil != null) {
            val tippen: (String) -> Unit = { onMeldungWeg() }
            OutlinedTextField(
                value = benutzername,
                onValueChange = { benutzername = it; tippen(it) },
                label = { Text(stringResource(R.string.login_username)) },
                modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf)
            OutlinedTextField(
                value = email,
                onValueChange = { email = it; tippen(it) },
                label = { Text(stringResource(R.string.register_email)) },
                // Der Server setzt die Bestaetigung zurueck, wenn die Adresse
                // wechselt. Der Hinweis sagt, WARUM hier plotzlich „nicht
                // bestaetigt" steht, statt es unkommentiert anzuzeigen.
                supportingText = if (profil.emailVerified != 1) {
                    { Text(stringResource(R.string.konto_email_unverified)) }
                } else null,
                isError = profil.emailVerified != 1,
                modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = vorname, onValueChange = { vorname = it; tippen(it) },
                    label = { Text(stringResource(R.string.register_first_name)) },
                    modifier = Modifier.weight(1f), singleLine = true, shape = Formen.knopf)
                OutlinedTextField(
                    value = nachname, onValueChange = { nachname = it; tippen(it) },
                    label = { Text(stringResource(R.string.register_last_name)) },
                    modifier = Modifier.weight(1f), singleLine = true, shape = Formen.knopf)
            }
            Button(
                onClick = { onSpeichern(benutzername, email, vorname, nachname) },
                enabled = geaendert && !kontoZustand.speichert,
                modifier = Modifier.fillMaxWidth().height(44.dp), shape = Formen.knopf
            ) { Text(stringResource(R.string.konto_save), fontWeight = FontWeight.SemiBold) }

            HorizontalDivider(Modifier.padding(vertical = 12.dp),
                color = MaterialTheme.colorScheme.outlineVariant)

            Text(stringResource(R.string.konto_password_title),
                style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
            // Steht VOR den Feldern, nicht darunter: Wer erst nach dem Tippen
            // erfaehrt, dass er sich damit abmeldet, hat schon getippt.
            Text(stringResource(R.string.konto_password_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(
                value = pwAktuell, onValueChange = { pwAktuell = it },
                label = { Text(stringResource(R.string.konto_password_current)) },
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
            OutlinedTextField(
                value = pwNeu, onValueChange = { pwNeu = it },
                label = { Text(stringResource(R.string.konto_password_new)) },
                visualTransformation = PasswordVisualTransformation(),
                // Dieselbe Mindestlaenge wie im Server (routes/auth.ts) und im
                // Registrierformular. Hier vorweggenommen, damit man dafuer
                // nicht erst eine Runde ueber das Netz braucht.
                supportingText = if (pwNeu.isNotEmpty() && pwNeu.length < 8) {
                    { Text(stringResource(R.string.register_password_short)) }
                } else null,
                isError = pwNeu.isNotEmpty() && pwNeu.length < 8,
                modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
            OutlinedButton(
                onClick = { onPasswort(pwAktuell, pwNeu) },
                enabled = !kontoZustand.speichert && pwAktuell.isNotBlank() && pwNeu.length >= 8,
                modifier = Modifier.fillMaxWidth().height(44.dp), shape = Formen.knopf
            ) { Text(stringResource(R.string.konto_password_button), fontWeight = FontWeight.SemiBold) }
        }
    }
}

/**
 * Eine CSV-Datei hochladen — Sets, Teile oder Minifiguren.
 *
 * Dieselben drei Adressen, die die Webapp anbietet. Die App konnte Importe
 * bisher nur beobachten (der Fortschrittsbalken oben in der Galerie); starten
 * konnte sie keinen, weil die Dateiauswahl fehlte und die Routen an einem
 * sitzungsgebundenen Waechter hingen (Nachtrag 127/128).
 *
 * Der Fortschritt DANACH kommt weiterhin ueber den bestehenden Kanal: Der
 * Import laeuft auf dem Server weiter, auch wenn die App zugeklappt wird.
 */
@Composable
private fun CsvImportCard(
    csvZustand: ch.brickinventoryapp.ui.CsvHochladenUiState,
    onDatei: (ch.brickinventoryapp.data.model.CsvArt, android.net.Uri) -> Unit,
    onSchliessen: () -> Unit,
) {
    // Welche Art beim Antippen gemeint war. Der Dateiauswahl-Vertrag liefert
    // nur den Uri zurueck, nicht den Knopf — also muss die App es sich merken.
    //
    // rememberSaveable und NICHT remember: Die Dateiauswahl ist eine fremde
    // Anwendung. Waehrend sie oben liegt, darf das System diesen Vorgang
    // beenden; kommt der Nutzer mit einer Teile-Datei zurueck und der Wert ist
    // auf SETS zurueckgefallen, landet sie in der falschen Tabelle. Genau
    // dieser Unterschied ist die Regel von BildschirmZustandTest, und der
    // oertliche Spiegel hat die Stelle prompt gemeldet.
    var gewaehlteArt by rememberSaveable { mutableStateOf(ch.brickinventoryapp.data.model.CsvArt.SETS) }
    val auswahl = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.OpenDocument()
    ) { uri -> if (uri != null) onDatei(gewaehlteArt, uri) }

    // `text/*` UND `text/comma-separated-values`: Manche Dateiverwaltungen
    // geben einer .csv den Typ `application/vnd.ms-excel`, andere gar keinen.
    // Zu eng gefiltert waere die Datei in der Auswahl ausgegraut, ohne dass
    // erkennbar ist, warum.
    val typen = arrayOf("text/csv", "text/comma-separated-values", "text/plain",
                        "application/vnd.ms-excel", "application/octet-stream")

    SettingsCard(title = stringResource(R.string.csv_upload_title), icon = Icons.Default.UploadFile) {
        Text(
            stringResource(R.string.csv_upload_hint,
                (ch.brickinventoryapp.ui.CSV_MAX_BYTES / 1024 / 1024).toInt()),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            listOf(
                ch.brickinventoryapp.data.model.CsvArt.SETS to R.string.csv_upload_sets,
                ch.brickinventoryapp.data.model.CsvArt.TEILE to R.string.csv_upload_parts,
                ch.brickinventoryapp.data.model.CsvArt.MINIFIGUREN to R.string.csv_upload_figs,
            ).forEach { (art, textId) ->
                OutlinedButton(
                    onClick = { gewaehlteArt = art; auswahl.launch(typen) },
                    enabled = !csvZustand.laeuft,
                    modifier = Modifier.weight(1f), shape = Formen.knopf,
                    contentPadding = PaddingValues(horizontal = 4.dp)
                ) {
                    if (csvZustand.laeuft && csvZustand.art == art) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    } else {
                        Text(stringResource(textId), maxLines = 1,
                            style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
        }

        val ergebnis = csvZustand.ergebnis
        if (ergebnis != null) {
            Text(
                stringResource(R.string.csv_upload_result,
                    ergebnis.total, ergebnis.neuAngelegt, ergebnis.updated, ergebnis.errors),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary)
            TextButton(onClick = onSchliessen) { Text(stringResource(R.string.csv_upload_close)) }
        }
        if (csvZustand.fehler != null) {
            Text(csvZustand.fehler, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
            TextButton(onClick = onSchliessen) { Text(stringResource(R.string.csv_upload_close)) }
        }
    }
}


/**
 * Selbstaktualisierung aus dem GitHub-Release.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 * Beim Start still pruefen, nie von allein laden — und hier zusaetzlich ein
 * Knopf, um von Hand nachzusehen. Die Karte zeigt darum IMMER die laufende
 * Fassung: Ohne sie waere „Aktuell" eine Behauptung ohne Beleg, und wer wissen
 * will, was gerade installiert ist, muesste in den Anmeldebildschirm
 * zurueckgehen (dort steht sie seit jeher).
 *
 * ── Warum das Herunterladen und das Installieren zwei Knoepfe sind ──────────
 * Zwischen beiden liegt womoeglich ein Ausflug in die Systemeinstellungen:
 * Ab Android 8 — und minSdk ist 26, also immer — braucht die App eine eigene
 * Erlaubnis, Pakete zu installieren. Ein einziger Knopf muesste den Nutzer
 * mitten im Vorgang wegschicken und danach raten, ob er zurueckkommt.
 */
@Composable
private fun UpdateCard(
    // `updateZustand`, nicht `zustand`: GeraeteCard in dieser Datei hat einen
    // Parameter dieses Namens vom Typ GeraeteUiState. Fuer den Compiler sind
    // das getrennte Gueltigkeitsbereiche, fuer die Pruefung „welcher Name
    // traegt in DIESER Datei welchen Zustandstyp" nicht — sie meldete prompt
    // GeraeteUiState.laedt und .fehler als tot. Dieselbe Falle wie bei `state`
    // und `geraete` weiter oben, dritter Anlauf.
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
        Spacer(Modifier.height(8.dp))

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
            Spacer(Modifier.height(8.dp))
            Text(stringResource(R.string.update_downloading, p),
                style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(4.dp))
            LinearProgressIndicator(
                progress = { p / 100f },
                modifier = Modifier.fillMaxWidth(),
            )
        }

        if (updateZustand.erlaubnisFehlt) {
            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(R.string.update_permission_needed),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(4.dp))
            TextButton(onClick = {
                ctx.startActivity(ch.brickinventoryapp.util.erlaubnisAbsicht(ctx))
            }) { Text(stringResource(R.string.update_permission_grant)) }
        }

        updateZustand.fehler?.let { f ->
            Spacer(Modifier.height(8.dp))
            Text(f, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }

        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = onPruefen, enabled = !updateZustand.laedtPruefung && updateZustand.fortschritt == null) {
                if (updateZustand.laedtPruefung) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
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
