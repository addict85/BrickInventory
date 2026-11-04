package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.ZweiterFaktorUiState
import ch.brickinventoryapp.ui.components.LocalSchrittschutz
import ch.brickinventoryapp.ui.components.MarkenKopf
import ch.brickinventoryapp.ui.components.Sichtschutz
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.theme.mittigBis
import ch.brickinventoryapp.util.GeheimeZwischenablage
import ch.brickinventoryapp.util.otpauthAdresse

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
    val kontext = LocalContext.current
    val auswahlTitel = stringResource(R.string.zf_open_app)
    val etikett = stringResource(R.string.app_name)
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
            when {
                // Die Codes stehen einmal im Klartext da: kein Bildschirmfoto davon.
                zustand.codes.isNotEmpty() -> {
                    Sichtschutz()
                    Ueberschrift(stringResource(R.string.zf_pflicht_codes_titel))
                    Text(stringResource(R.string.zf_codes_hint), style = MaterialTheme.typography.bodyMedium)
                    Text(zustand.codes.joinToString("\n"), fontFamily = FontFamily.Monospace)
                    OutlinedButton(
                        onClick = { GeheimeZwischenablage.kopiere(kontext, etikett, zustand.codes.joinToString("\n")) },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(stringResource(R.string.zf_copy)) }
                    Button(onClick = onWeiter, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.zf_pflicht_weiter))
                    }
                }
                // Auf dem Telefon öffnet der otpauth-Link die Authenticator-App; der
                // Schlüssel bleibt zum Abtippen, falls keine den Link nimmt.
                geheimnis != null -> {
                    Sichtschutz()
                    Ueberschrift(stringResource(R.string.zf_pflicht_titel))
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
                            color = MaterialTheme.colorScheme.error)
                    }
                    Text(geheimnis.chunked(4).joinToString(" "), fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodyLarge)
                    OutlinedButton(
                        onClick = { GeheimeZwischenablage.kopiere(kontext, etikett, geheimnis) },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(stringResource(R.string.zf_copy_key)) }
                    OutlinedTextField(
                        value = faktorCode, onValueChange = { faktorCode = it.filter(Char::isDigit).take(8) },
                        label = { Text(stringResource(R.string.zf_confirm_code)) },
                        singleLine = true, shape = Formen.feld,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth())
                    Button(
                        onClick = { onBestaetigen(faktorCode) },
                        enabled = faktorCode.isNotEmpty() && !zustand.laedt,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(stringResource(R.string.zf_confirm)) }
                }
                // Schon eingerichtet, etwa nach einem Abruf, der kurz vor der Bestätigung hinausging.
                zustand.aktiv == true -> {
                    Ueberschrift(stringResource(R.string.zf_enabled))
                    Button(onClick = onWeiter, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.zf_pflicht_weiter))
                    }
                }
                else -> {
                    Ueberschrift(stringResource(R.string.zf_pflicht_titel))
                    Text(stringResource(R.string.zf_pflicht_text), style = MaterialTheme.typography.bodyMedium)
                    Text(stringResource(R.string.zf_pflicht_passwort), style = MaterialTheme.typography.bodyMedium)
                    OutlinedTextField(
                        value = pwAktuell, onValueChange = { pwAktuell = it }, singleLine = true,
                        label = { Text(stringResource(R.string.konto_password_current)) },
                        visualTransformation = PasswordVisualTransformation(), shape = Formen.feld,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        modifier = Modifier.fillMaxWidth())
                    // Gleich danach steht der Schlüssel im Klartext da: erst die Gerätesperre.
                    Button(
                        onClick = { schutz.bestaetige(codesGrund) { onEinrichten(pwAktuell) } },
                        enabled = pwAktuell.isNotEmpty() && !zustand.laedt,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(stringResource(R.string.zf_setup)) }
                }
            }
            if (zustand.laedt) LinearProgressIndicator(Modifier.fillMaxWidth())
            zustand.fehler?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            TextButton(onClick = onAbmelden) { Text(stringResource(R.string.settings_logout)) }
        }
    }
}

@Composable
private fun Ueberschrift(text: String) {
    Text(text, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
}
