package ch.brickinventoryapp.account.ui.screens

import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.errorMessage
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
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.account.ui.AccountUiState
import ch.brickinventoryapp.ui.components.LoginCard
import ch.brickinventoryapp.ui.components.LoginTitle
import ch.brickinventoryapp.ui.components.ErrorRow
import ch.brickinventoryapp.ui.components.BrandsHeader
import ch.brickinventoryapp.ui.components.SecondFactorCodeField
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.theme.centeredUntil
import ch.brickinventoryapp.ui.components.PasswordSwitchFields
import ch.brickinventoryapp.ui.components.rememberPasswordSwitchCheck
import ch.brickinventoryapp.ui.theme.mainButtonColors
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz

/**
 * The account still has its start password: the server rejects every
 * request with 403 `passwort_wechsel_noetig` until it's changed. Instead of an
 * app full of error messages, only this mask stands there, built like the
 * second-factor mask (brand header, reading width). The change ends all access
 * tokens, after which you sign in with the new password ([onReplace] signs out on success).
 */
@Composable
fun StartPasswordMask(
    kontoZustand: AccountUiState,
    onReplace: (aktuell: String, neu: String, code: String?) -> Unit,
    onAbmelden: () -> Unit,
) {
    // remember, not rememberSaveable: saved state lands in the Bundle and, on
    // process death, on disk (ActivityManager) — no place for passwords and codes.
    var pwCurrent by remember { mutableStateOf("") }
    var pwNeu by remember { mutableStateOf("") }
    var pwRepeated by remember { mutableStateOf("") }
    var faktorCode by remember { mutableStateOf("") }
    val check = rememberPasswordSwitchCheck()
    val fokus = LocalFocusManager.current
    val weiter = KeyboardActions(onNext = { fokus.moveFocus(FocusDirection.Down) })
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        // A slipped-in tap set the account's password here.
        Ueberdeckungsschutz()
        Column(
            Modifier.verticalScroll(rememberScrollState()).centeredUntil(Lesebreite.formular)
                .padding(horizontal = Abstaende.veryLarge, vertical = Abstaende.huge),
            verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
        ) {
            BrandsHeader(Modifier.fillMaxWidth())
            // The same card as sign-in and registration, sign-out below like "Back" there.
            LoginCard {
                LoginTitle(stringResource(R.string.startpasswort_titel))
                Text(stringResource(R.string.startpasswort_text), style = MaterialTheme.typography.bodyMedium)
                PasswordSwitchFields(pwCurrent, { pwCurrent = it }, pwNeu, { pwNeu = it },
                    pwRepeated, { pwRepeated = it }, check, weiter)
                kontoZustand.speichern.errorMessage?.let { ErrorRow(it) }
                if (kontoZustand.codeNoetig) SecondFactorCodeField(faktorCode) { faktorCode = it }
                Button(
                    onClick = {
                        check.submit(pwCurrent, pwNeu, pwRepeated) {
                            onReplace(pwCurrent, pwNeu, faktorCode.takeIf { kontoZustand.codeNoetig && it.isNotBlank() })
                        }
                    },
                    enabled = !kontoZustand.speichern.laeuft,
                    colors = mainButtonColors(),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(stringResource(R.string.konto_password_button)) }
            }
            // Centered, full width like "Back to sign-in": indented it stood next to nothing.
            TextButton(onClick = onAbmelden, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.settings_logout)) }
        }
    }
}
