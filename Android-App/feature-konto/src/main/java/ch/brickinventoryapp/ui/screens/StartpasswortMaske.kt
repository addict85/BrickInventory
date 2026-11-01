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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.KontoUiState
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.util.passwortZuKurz

/**
 * Das Konto hat noch sein Startpasswort: Der Server weist bis zum Wechsel jeden
 * Abruf ab (403 `passwort_wechsel_noetig`). Statt einer App voller Fehlermeldungen
 * steht nur diese Maske da. Der Wechsel beendet alle Zugänge, danach meldet man
 * sich mit dem neuen Passwort an ([onErsetzen] meldet bei Erfolg ab).
 */
@Composable
fun StartpasswortMaske(
    kontoZustand: KontoUiState,
    onErsetzen: (aktuell: String, neu: String) -> Unit,
    onAbmelden: () -> Unit,
) {
    // remember, nicht rememberSaveable: Gesicherter Zustand landet im Bundle und bei
    // Prozesstod auf der Platte (ActivityManager) — kein Ort für Passwörter und Codes.
    var pwAktuell by remember { mutableStateOf("") }
    var pwNeu by remember { mutableStateOf("") }
    var pwWiederholt by remember { mutableStateOf("") }
    val zuKurz = pwNeu.isNotEmpty() && passwortZuKurz(pwNeu)
    val verschieden = pwWiederholt.isNotEmpty() && pwWiederholt != pwNeu
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        // Ein untergeschobener Tipp setzte hier das Passwort des Kontos.
        ch.brickinventoryapp.ui.components.Ueberdeckungsschutz()
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(Abstaende.riesig),
            verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
        ) {
            Text(stringResource(R.string.startpasswort_titel), style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.semantics { heading() })
            Text(stringResource(R.string.startpasswort_text), style = MaterialTheme.typography.bodyMedium)
            OutlinedTextField(
                value = pwAktuell, onValueChange = { pwAktuell = it }, singleLine = true,
                label = { Text(stringResource(R.string.konto_password_current)) },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                value = pwNeu, onValueChange = { pwNeu = it }, singleLine = true,
                label = { Text(stringResource(R.string.konto_password_new)) },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                isError = zuKurz,
                supportingText = if (zuKurz) { { Text(stringResource(R.string.register_password_short)) } } else null,
                modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                value = pwWiederholt, onValueChange = { pwWiederholt = it }, singleLine = true,
                label = { Text(stringResource(R.string.startpasswort_wiederholen)) },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                isError = verschieden,
                supportingText = if (verschieden) { { Text(stringResource(R.string.startpasswort_verschieden)) } } else null,
                modifier = Modifier.fillMaxWidth())
            kontoZustand.fehler?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = { onErsetzen(pwAktuell, pwNeu) },
                enabled = !kontoZustand.speichert && pwAktuell.isNotEmpty() && pwNeu.isNotEmpty() && !zuKurz && pwWiederholt == pwNeu,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(stringResource(R.string.konto_password_button)) }
            TextButton(onClick = onAbmelden) { Text(stringResource(R.string.settings_logout)) }
        }
    }
}
