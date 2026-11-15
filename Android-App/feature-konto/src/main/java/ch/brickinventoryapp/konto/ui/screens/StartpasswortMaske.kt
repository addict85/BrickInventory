package ch.brickinventoryapp.konto.ui.screens

import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.fehlerMeldung
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.konto.ui.KontoUiState
import ch.brickinventoryapp.ui.components.AnmeldeKarte
import ch.brickinventoryapp.ui.components.AnmeldeTitel
import ch.brickinventoryapp.ui.components.FehlerZeile
import ch.brickinventoryapp.ui.components.MarkenKopf
import ch.brickinventoryapp.ui.components.ZweiterFaktorCodeFeld
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.theme.mittigBis
import ch.brickinventoryapp.ui.components.PasswortWechselFelder
import ch.brickinventoryapp.ui.components.rememberPasswortWechselPruefung
import ch.brickinventoryapp.ui.theme.hauptKnopfFarben
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz

/**
 * Das Konto hat noch sein Startpasswort: Der Server weist bis zum Wechsel jeden
 * Abruf ab (403 `passwort_wechsel_noetig`). Statt einer App voller Fehlermeldungen
 * steht nur diese Maske da, gebaut wie die Maske für den zweiten Faktor (Markenkopf,
 * Lesebreite). Der Wechsel beendet alle Zugänge, danach meldet man sich mit dem neuen
 * Passwort an ([onErsetzen] meldet bei Erfolg ab).
 */
@Composable
fun StartpasswortMaske(
    kontoZustand: KontoUiState,
    onErsetzen: (aktuell: String, neu: String, code: String?) -> Unit,
    onAbmelden: () -> Unit,
) {
    // remember, nicht rememberSaveable: Gesicherter Zustand landet im Bundle und bei
    // Prozesstod auf der Platte (ActivityManager) — kein Ort für Passwörter und Codes.
    var pwAktuell by remember { mutableStateOf("") }
    var pwNeu by remember { mutableStateOf("") }
    var pwWiederholt by remember { mutableStateOf("") }
    var faktorCode by remember { mutableStateOf("") }
    val pruefung = rememberPasswortWechselPruefung()
    val fokus = LocalFocusManager.current
    val weiter = KeyboardActions(onNext = { fokus.moveFocus(FocusDirection.Down) })
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        // Ein untergeschobener Tipp setzte hier das Passwort des Kontos.
        Ueberdeckungsschutz()
        Column(
            Modifier.verticalScroll(rememberScrollState()).mittigBis(Lesebreite.formular)
                .padding(horizontal = Abstaende.sehrGross, vertical = Abstaende.riesig),
            verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
        ) {
            MarkenKopf(Modifier.fillMaxWidth())
            // Dieselbe Karte wie Anmelden und Registrieren, das Abmelden darunter wie dort „Zurück“.
            AnmeldeKarte {
                AnmeldeTitel(stringResource(R.string.startpasswort_titel))
                Text(stringResource(R.string.startpasswort_text), style = MaterialTheme.typography.bodyMedium)
                PasswortWechselFelder(pwAktuell, { pwAktuell = it }, pwNeu, { pwNeu = it },
                    pwWiederholt, { pwWiederholt = it }, pruefung, weiter)
                kontoZustand.speichern.fehlerMeldung?.let { FehlerZeile(it) }
                if (kontoZustand.codeNoetig) ZweiterFaktorCodeFeld(faktorCode) { faktorCode = it }
                Button(
                    onClick = {
                        pruefung.absenden(pwAktuell, pwNeu, pwWiederholt) {
                            onErsetzen(pwAktuell, pwNeu, faktorCode.takeIf { kontoZustand.codeNoetig && it.isNotBlank() })
                        }
                    },
                    enabled = !kontoZustand.speichern.laeuft,
                    colors = hauptKnopfFarben(),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(stringResource(R.string.konto_password_button)) }
            }
            // Mittig in voller Breite wie „Zurück zur Anmeldung“: Eingerückt stand es neben nichts.
            TextButton(onClick = onAbmelden, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.settings_logout)) }
        }
    }
}
