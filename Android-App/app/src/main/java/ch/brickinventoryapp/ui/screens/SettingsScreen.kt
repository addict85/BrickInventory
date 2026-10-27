package ch.brickinventoryapp.ui.screens

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
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.*  // Feature-Extensions (saveSettings, setLanguage, …)
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Schrift
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import ch.brickinventoryapp.ui.viewmodel.aktivitaetsViewModel
import ch.brickinventoryapp.ui.viewmodel.UpdateViewModel

/**
 * Die Einstellungen — eine Liste, kein Stapel.
 *
 * ── Marcos Befund vom 16.10. ────────────────────────────────────────────────
 *
 *   „Die Abstände in der Android-App in den Einstellungen sind teilweise nicht
 *    vorhanden. Die Elemente sind zu nahe an einander. Generell wirkt dieser
 *    Dialog überladen und nicht liebevoll gestaltet."
 *
 * Hier standen VIERZEHN Karten untereinander, mit 10 dp dazwischen. Jede
 * einzelne war für sich in Ordnung; zusammen ergaben sie eine Rolle, auf der
 * das Seltene (einmal die Währung setzen) genauso viel Platz einnimmt wie das
 * Häufige, und auf der man an sechs Rubriken vorbeirollt, um zur siebten zu
 * kommen.
 *
 * Jetzt sind es vier Karten:
 *
 *   1. VERWALTEN — eine Liste mit Pfeilen. Was dahinter liegt, hat seine
 *      eigene Seite (EinstellungenUnterseiten.kt).
 *   2. ANZEIGE & PREISE — die vier Werte, die man einmal setzt. Sprache wirkt
 *      sofort, die drei darunter brauchen den Speichern-Knopf; die Trennlinie
 *      sagt das.
 *   3. SERVER, 4. AKTUALISIERUNG — beides kurz und selten gebraucht.
 *
 * ── Was ERSATZLOS entfallen ist ─────────────────────────────────────────────
 *
 * Die Zusammenfassung „Aktuelle Einstellungen: CHF · Neu" unter den Chips. Sie
 * wiederholte, was zwei Zentimeter darüber ausgewählt dastand — ein Kasten, der
 * nichts sagt, was man nicht schon sieht. Genau die Sorte Fülle, die Marco
 * gemeint hat.
 */
@Composable
fun SettingsScreen(
    vm: MainViewModel,
    /** Abmelden — nur der Graph kennt den NavController. */
    onLogout: () -> Unit,
    /**
     * Zur Server-Einrichtung wechseln — wie [onLogout] ein Rueckruf, weil nur
     * der Graph den NavController kennt.
     *
     * OHNE Vorgabewert, und das ist Absicht: Mit `= {}` haette eine vergessene
     * Weitergabe einen Knopf ergeben, der nichts tut — und niemand haette es
     * gemeldet. Dieselbe Ueberlegung wie bei `onTabAngetippt` in
     * MainScaffold.kt (Nachtrag 114).
     */
    onServerWechseln: () -> Unit,
    /**
     * Rollposition — von AUSSEN, aus demselben Grund wie bei den Finanzen:
     * Der Weg in die Detailansicht verwirft dieses Ziel, und ein
     * `rememberScrollState()` hier drin waere bei der Rueckkehr zurueckgesetzt.
     */
    scrollState: ScrollState,
) {
    // Zustand und Aktionen vom ViewModel statt über zwölf Parameter — dasselbe
    // Muster wie in Galerie/Finanzen/Teile/Minifiguren (Nachtrag 96).
    //
    // `appState`, nicht `state`: UiStateFieldsTest bestimmt den Typ je NAME und
    // DATEI; ein zweites `state` in derselben Datei meldete prompt drei
    // angeblich fehlende Felder.
    val appState by vm.state.collectAsStateWithLifecycle()
    // `updateZustand`, nicht `update`: dieselbe Namensfalle.
    val selbstUpdate: UpdateViewModel = aktivitaetsViewModel()
    val updateZustand by selbstUpdate.updateState.collectAsStateWithLifecycle()

    val currency = appState.currency
    val priceCondition = appState.priceCondition
    val userDefaultCondition = appState.userDefaultCondition
    val defaultPriceCondition = appState.defaultPriceCondition
    val language = appState.language

    val onSave: (String, String) -> Unit = { cur, cond ->
        vm.saveSettings(cur, cond)
        vm.loadValuation()
    }

    var selectedCurrency  by remember(currency)       { mutableStateOf(currency) }
    var selectedCondition by remember(priceCondition) { mutableStateOf(priceCondition) }
    // Rückfall auf die GLOBALE Vorgabe des Servers, nicht auf die
    // Preisgrundlage (Nachtrag 118): `priceCondition` ist die Grundlage für
    // BrickLink-BEWERTUNGEN, `defaultPriceCondition` die serverseitige
    // Vorbelegung beim ERFASSEN.
    //
    // `null` heisst: KEINE eigene Vorgabe, es gilt die des Servers. Das ist ein
    // eigener Zustand und nicht dasselbe wie "N".
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
        // ── Die Rubriken stehen seit dem 17.10. eine Ebene weiter aussen ──
        //
        // Marcos Vorgabe: „in der Android-App sollten die Punkte unter
        // Einstellungen eine ebene nach aussen wandern wo heute Einstellungen
        // und Abmelden und Monitoring zu finden sind."
        //
        // Hier stand bis dahin die Karte „Verwalten" mit sechs Zeilen
        // (Gutscheine, Preisalarme, Lagerorte, Haushalt, CSV-Import, Konto).
        // Sie liegen jetzt in der Konto-Klappe oben rechts (MainScaffold.kt),
        // neben Einstellungen, Monitoring und Abmelden — ein Tipper naeher.
        //
        // Was bleibt, ist das, was eine EINSTELLUNG im engeren Sinn ist:
        // Anzeige & Preise, der Server, die Update-Pruefung. Also nichts, was
        // eine eigene Seite braucht.
        // ── 2. Anzeige & Preise ─────────────────────────────────────────────
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
                        onClick = { vm.setLanguage(code) },
                        label = { Text(label) },
                        shape = Formen.chip
                    )
                }
            }

            // Darstellung je Gerät — wirkt sofort wie die Sprache.
            Unterschrift(stringResource(R.string.settings_dark_label))
            val dunkel by vm.dunkelNachSystem.collectAsStateWithLifecycle()
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                modifier = Modifier.fillMaxWidth()) {
                FilterChip(
                    selected = !dunkel,
                    onClick = { vm.setDunkelNachSystem(false) },
                    label = { Text(stringResource(R.string.settings_dark_server)) },
                    shape = Formen.chip
                )
                FilterChip(
                    selected = dunkel,
                    onClick = { vm.setDunkelNachSystem(true) },
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

            // ── Standard-Zustand beim Erfassen ──────────────────────────────
            //
            // DREI Moeglichkeiten, nicht zwei (Nachtrag 119): Es fehlte der Weg
            // ZURUECK zur Vorgabe des Servers. Der Hinweis nennt auch, WORAUF
            // die globale Vorgabe gerade steht — sonst waehlt man blind.
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
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = Formen.knopf
            ) {
                Icon(Icons.Default.Save, null, Modifier.size(18.dp))
                Spacer(Modifier.width(Abstaende.klein))
                Text(stringResource(R.string.settings_save), fontWeight = FontWeight.SemiBold)
            }
        }

        // ── 3. Der Server steht bei den Einstellungen, nicht im Konto-Menue ──
        //
        // Marcos Wunsch. Er passt hierher: Die Serveradresse ist eine
        // Einstellung wie Waehrung und Sprache — etwas, das man einmal setzt
        // und selten aendert. Im Konto-Menue stand sie neben „Abmelden", also
        // neben einer Handlung an der laufenden Sitzung.
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
            modifier = Modifier.fillMaxWidth().height(48.dp),
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
 * Der Rahmen einer Einstellungs-Rubrik.
 *
 * `internal` statt `private`: GutscheineCard.kt steht in einer eigenen Datei
 * (SettingsScreen.kt hat schon 1448 Zeilen) und braucht denselben Rahmen. Eine
 * zweite Fassung dort haette genuegt, damit die eine Karte anders aussieht als
 * alle anderen — und zwar erst dann, wenn jemand hier etwas aendert.
 */
@Composable
internal fun SettingsCard(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    content: @Composable ColumnScope.() -> Unit
) {
    AppKarte {
        // ── Der Abstand, der gefehlt hat (Marcos Befund vom 16.10.) ─────────
        //
        //   „Die Abstände in der Android-App in den Einstellungen sind
        //    teilweise nicht vorhanden. Die Elemente sind zu nahe an einander."
        //
        // Die Karten legten ihre Kinder OHNE Abstand untereinander. Wer in
        // einer Karte zwei Dinge untereinanderschrieb, musste selbst an ein
        // `padding(bottom = …)` denken — und wo das vergessen wurde, klebten
        // die Zeilen aneinander: die Konten im Haushalt, die Zeilen der
        // Lagerorte, der Hinweis unter dem Einladungscode. Alle drei stehen auf
        // Marcos Bildschirmfotos.
        //
        // Der Abstand gehoert nicht an jedes Kind, sondern EINMAL hierhin: So
        // bekommt ihn auch die naechste Karte, ohne dass jemand daran denkt.
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
                    letterSpacing = 0.8.sp)
            }
            content()
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
/**
 * Mit welchem Server die App spricht — und der Weg, ihn zu wechseln.
 *
 * Die Adresse steht mit dabei und ist nicht nur Zierde: „Server aendern" ohne
 * zu sagen, welcher gerade gilt, laesst genau die Frage offen, wegen der man
 * hinsieht. In einem Haushalt mit zwei Installationen (Test und Betrieb) ist
 * das der Unterschied zwischen „stimmt schon" und „falsche Daten".
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
