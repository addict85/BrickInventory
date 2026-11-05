package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.ZweiterFaktorUiState
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.semantics.contentType
import ch.brickinventoryapp.ui.components.AnmeldeKarte
import ch.brickinventoryapp.ui.components.AnmeldeTitel
import ch.brickinventoryapp.ui.components.FehlerZeile
import ch.brickinventoryapp.ui.components.LocalSchrittschutz
import ch.brickinventoryapp.ui.components.PasswortFeld
import ch.brickinventoryapp.ui.components.MarkenKopf
import ch.brickinventoryapp.ui.components.Sichtschutz
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.ui.components.ansagen
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.theme.mittigBis
import ch.brickinventoryapp.util.GeheimeZwischenablage
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.util.otpauthAdresse
import ch.brickinventoryapp.ui.components.ErklaerText

/**
 * Verwalterrechte ohne zweiten Faktor: Der Server weist bis zur Einrichtung fast
 * jeden Abruf ab (403 `zweiter_faktor_pflicht`). Statt einer App voller Fehler steht
 * nur diese Maske da, und sie braucht nur, was der Server dann noch erlaubt. Nach
 * den Notfallcodes geht es mit demselben Token weiter ([onWeiter]).
 */
@Composable
fun ZweiterFaktorPflichtMaske(
    zustand: ZweiterFaktorUiState,
    onEinrichten: (passwort: String) -> Unit,
    onBestaetigen: (code: String) -> Unit,
    onWeiter: () -> Unit,
    onAbmelden: () -> Unit,
) {
    // remember, nicht rememberSaveable: Passwort und Code gehören nicht ins Bundle.
    var pwAktuell by remember { mutableStateOf("") }
    var faktorCode by remember { mutableStateOf("") }
    var ohneApp by rememberSaveable { mutableStateOf(false) }
    var gesichert by rememberSaveable { mutableStateOf(false) }
    val kontext = LocalContext.current
    val auswahlTitel = stringResource(R.string.zf_open_app)
    val etikett = stringResource(R.string.app_name)
    val teilenTitel = stringResource(R.string.zf_share_title)
    val schutz = LocalSchrittschutz.current
    val codesGrund = stringResource(R.string.schritt_codes)
    val geheimnis = zustand.geheimnis
    // Nach jedem gelungenen Schritt leeren, sonst stünde das Passwort beim nächsten noch da.
    LaunchedEffect(geheimnis, zustand.codes) { pwAktuell = ""; faktorCode = "" }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        // Ein untergeschobener Tipp richtete hier sonst einen fremden Schlüssel ein.
        Ueberdeckungsschutz()
        Column(
            Modifier.verticalScroll(rememberScrollState()).mittigBis(Lesebreite.formular)
                .padding(horizontal = Abstaende.sehrGross, vertical = Abstaende.riesig),
            verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
        ) {
            MarkenKopf(Modifier.fillMaxWidth())
            val schritt = when {
                zustand.codes.isNotEmpty() -> 3
                geheimnis != null -> 2
                zustand.aktiv == true -> null
                else -> 1
            }
            if (schritt != null) Schrittanzeige(schritt)
            // In derselben Karte wie Anmelden und Startpasswort; Schritte und Abmelden aussen.
            AnmeldeKarte {
                when {
                    // Die Codes stehen einmal im Klartext da: kein Bildschirmfoto davon.
                    zustand.codes.isNotEmpty() -> {
                        Sichtschutz()
                        AnmeldeTitel(stringResource(R.string.zf_pflicht_codes_titel))
                        Text(stringResource(R.string.zf_codes_hint), style = MaterialTheme.typography.bodyMedium)
                        Text(zustand.codes.joinToString("\n"), fontFamily = FontFamily.Monospace)
                        OutlinedButton(
                            onClick = { GeheimeZwischenablage.kopiere(kontext, etikett, zustand.codes.joinToString("\n")) },
                            modifier = Modifier.fillMaxWidth(),
                            colors = nebenKnopfFarben(),
                            border = nebenKnopfRand(),
                        ) { Text(stringResource(R.string.zf_copy)) }
                        OutlinedButton(
                            onClick = { teileCodes(kontext, teilenTitel, zustand.codes) },
                            modifier = Modifier.fillMaxWidth(),
                            colors = nebenKnopfFarben(),
                            border = nebenKnopfRand(),
                        ) { Text(stringResource(R.string.zf_share)) }
                        CodesGesichert(gesichert) { gesichert = it }
                        Button(onClick = onWeiter, enabled = gesichert, modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.zf_pflicht_weiter))
                        }
                    }
                    // Auf dem Telefon öffnet der otpauth-Link die Authenticator-App; der
                    // Schlüssel bleibt zum Abtippen, falls keine den Link nimmt.
                    geheimnis != null -> {
                        Sichtschutz()
                        AnmeldeTitel(stringResource(R.string.zf_pflicht_titel))
                        Text(stringResource(R.string.zf_step_app), style = MaterialTheme.typography.bodyMedium)
                        Button(
                            onClick = {
                                val uri = otpauthAdresse(zustand.otpauth)
                                ohneApp = uri == null || !oeffneMitAuswahl(kontext, uri, auswahlTitel)
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(stringResource(R.string.zf_open_app)) }
                        if (ohneApp) {
                            Text(stringResource(R.string.zf_no_app), style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.error, modifier = Modifier.ansagen())
                        }
                        Text(geheimnis.chunked(4).joinToString(" "), fontFamily = FontFamily.Monospace,
                            style = MaterialTheme.typography.bodyLarge)
                        OutlinedButton(
                            onClick = { GeheimeZwischenablage.kopiere(kontext, etikett, geheimnis) },
                            modifier = Modifier.fillMaxWidth(),
                            colors = nebenKnopfFarben(),
                            border = nebenKnopfRand(),
                        ) { Text(stringResource(R.string.zf_copy_key)) }
                        OutlinedTextField(
                            value = faktorCode, onValueChange = { faktorCode = NumericInput.quantity(it).take(8) },
                            label = { Text(stringResource(R.string.zf_confirm_code)) },
                            singleLine = true, shape = Formen.feld,
                            keyboardOptions = NumericInput.ganzzahlTastatur(),
                            modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.SmsOtpCode })
                        Button(
                            onClick = { onBestaetigen(faktorCode) },
                            enabled = faktorCode.isNotEmpty() && !zustand.laedt,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(stringResource(R.string.zf_confirm)) }
                    }
                    // Schon eingerichtet, etwa nach einem Abruf, der kurz vor der Bestätigung hinausging.
                    zustand.aktiv == true -> {
                        AnmeldeTitel(stringResource(R.string.zf_enabled))
                        Button(onClick = onWeiter, modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.zf_pflicht_weiter))
                        }
                    }
                    else -> {
                        AnmeldeTitel(stringResource(R.string.zf_pflicht_titel))
                        // Der Grund kurz, die Einzelheiten auf Wunsch: Bei 200 % Schrift
                        // füllten drei Absätze den Bildschirm vor dem Passwortfeld.
                        ErklaerText(stringResource(R.string.zf_pflicht_kurz),
                            stringResource(R.string.zf_pflicht_text), farbe = MaterialTheme.colorScheme.onSurface)
                        Text(stringResource(R.string.zf_pflicht_passwort), style = MaterialTheme.typography.bodyMedium)
                        PasswortFeld(pwAktuell, { pwAktuell = it }, stringResource(R.string.konto_password_current),
                            Modifier.fillMaxWidth())
                        // Gleich danach steht der Schlüssel im Klartext da: erst die Gerätesperre.
                        Button(
                            onClick = { schutz.bestaetige(codesGrund) { onEinrichten(pwAktuell) } },
                            enabled = pwAktuell.isNotEmpty() && !zustand.laedt,
                            modifier = Modifier.fillMaxWidth(),
                        // „Weiter“ wie Schritt 1 von 3: Eingerichtet ist danach noch nichts.
                        ) { Text(stringResource(R.string.setup_continue)) }
                    }
                }
            }
            if (zustand.laedt) LinearProgressIndicator(Modifier.fillMaxWidth())
            zustand.fehler?.let { FehlerZeile(it) }
            // Mittig in voller Breite wie „Zurück zur Anmeldung“: Eingerückt stand es neben nichts.
            TextButton(onClick = onAbmelden, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.settings_logout)) }
        }
    }
}

/**
 * Haken vor „Weiter“: Die Codes erscheinen nur dieses eine Mal, und ohne Haken liessen
 * sie sich mit einem Tipp wegklicken, bevor sie irgendwo lagen.
 */
@Composable
internal fun CodesGesichert(gesichert: Boolean, onAendern: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp)
            .toggleable(value = gesichert, role = Role.Checkbox, onValueChange = onAendern),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
    ) {
        Checkbox(checked = gesichert, onCheckedChange = null)
        Text(stringResource(R.string.zf_codes_gesichert), style = MaterialTheme.typography.bodyMedium)
    }
}

/**
 * Wo man in den drei Schritten steht (Passwort, App, Codes). Die Maske ist eine
 * Sackgasse bis zum Ende; ohne Anzeige wusste man nicht, wie weit es noch ist.
 */
@Composable
private fun Schrittanzeige(aktuell: Int) {
    val namen = listOf(R.string.zf_schritt_passwort, R.string.zf_schritt_app, R.string.zf_schritt_codes)
    Column(verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
            namen.indices.forEach { i ->
                // Offene Schritte in outline: outlineVariant verschwand auf der Fläche (1,13:1).
                val farbe = if (i < aktuell) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline
                Box(Modifier.weight(1f).height(Abstaende.winzig).background(farbe, Formen.strich))
            }
        }
        Text(pluralStringResource(R.plurals.zf_schritt, namen.size, aktuell, namen.size, stringResource(namen[aktuell - 1])),
            style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.primary)
    }
}
