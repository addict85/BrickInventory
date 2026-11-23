package ch.brickinventoryapp.account.ui.screens

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
import ch.brickinventoryapp.account.ui.AccountUiState
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.running
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.BrandsHeader
import ch.brickinventoryapp.ui.components.ErrorRow
import ch.brickinventoryapp.ui.components.LoginCard
import ch.brickinventoryapp.ui.components.LoginTitle
import ch.brickinventoryapp.ui.components.OverlayGuard
import ch.brickinventoryapp.ui.components.PasswordSwitchFields
import ch.brickinventoryapp.ui.components.SecondFactorCodeField
import ch.brickinventoryapp.ui.components.rememberPasswordSwitchCheck
import ch.brickinventoryapp.ui.theme.ReadingWidth
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.centeredUntil
import ch.brickinventoryapp.ui.theme.mainButtonColors

/**
 * The account still has its start password: the server rejects every
 * request with 403 `password_switch_needed` until it's changed. Instead of an
 * app full of error messages, only this mask stands there, built like the
 * second-factor mask (brand header, reading width). The change ends all access
 * tokens, after which you sign in with the new password ([onReplace] signs out on success).
 */
@Composable
fun StartPasswordMask(
    accountUiState: AccountUiState,
    onReplace: (current: String, newValue: String, code: String?) -> Unit,
    onLogout: () -> Unit,
) {
    // remember, not rememberSaveable: saved state lands in the Bundle and, on
    // process death, on disk (ActivityManager) — no place for passwords and codes.
    var pwCurrent by remember { mutableStateOf("") }
    var pwNew by remember { mutableStateOf("") }
    var pwRepeated by remember { mutableStateOf("") }
    var factorCode by remember { mutableStateOf("") }
    val check = rememberPasswordSwitchCheck()
    val focus = LocalFocusManager.current
    val next = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) })
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        // A slipped-in tap set the account's password here.
        OverlayGuard()
        Column(
            Modifier.verticalScroll(rememberScrollState()).centeredUntil(ReadingWidth.form)
                .padding(horizontal = Spacing.veryLarge, vertical = Spacing.huge),
            verticalArrangement = Arrangement.spacedBy(Spacing.medium),
        ) {
            BrandsHeader(Modifier.fillMaxWidth())
            // The same card as sign-in and registration, sign-out below like "Back" there.
            LoginCard {
                LoginTitle(stringResource(R.string.start_password_title))
                Text(stringResource(R.string.start_password_text), style = MaterialTheme.typography.bodyMedium)
                PasswordSwitchFields(pwCurrent, { pwCurrent = it }, pwNew, { pwNew = it },
                    pwRepeated, { pwRepeated = it }, check, next)
                accountUiState.save.errorMessage?.let { ErrorRow(it) }
                if (accountUiState.codeNeeded) SecondFactorCodeField(factorCode) { factorCode = it }
                Button(
                    onClick = {
                        check.submit(pwCurrent, pwNew, pwRepeated) {
                            onReplace(pwCurrent, pwNew, factorCode.takeIf { accountUiState.codeNeeded && it.isNotBlank() })
                        }
                    },
                    enabled = !accountUiState.save.running,
                    colors = mainButtonColors(),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(stringResource(R.string.account_password_button)) }
            }
            // Centered, full width like "Back to sign-in": indented it stood next to nothing.
            TextButton(onClick = onLogout, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.settings_logout)) }
        }
    }
}
