package ch.brickinventoryapp.account.ui.screens

import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.errorMessage
import androidx.compose.ui.platform.LocalContext
import ch.brickinventoryapp.model.util.DateYear
import ch.brickinventoryapp.model.util.fmtStatus
import ch.brickinventoryapp.ui.util.appNumberLocale
import ch.brickinventoryapp.ui.util.twentyFourHours
import androidx.compose.material.icons.filled.Share
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.LockReason
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.beschreibung
import ch.brickinventoryapp.ui.titel
import ch.brickinventoryapp.ui.components.Abschnitt
import ch.brickinventoryapp.ui.components.PasswordField
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.account.ui.HouseholdUiState
import ch.brickinventoryapp.ui.components.ErklaerText
import ch.brickinventoryapp.ui.util.SecretClipboard
import ch.brickinventoryapp.ui.util.LocalSdkLevel
import ch.brickinventoryapp.ui.util.secretCopyable

/**
 * Household: linked accounts, invite an account, accept an invitation — three sections
 * with a heading. In one card both flows sat ungrouped one below the other,
 * and no one could tell which was meant for which account.
 *
 * Any account may invite and accept (sub-accounts and main accounts of
 * several sub-accounts included); whatever the server doesn't allow, its message says.
 */
@Composable
internal fun HouseholdCard(
    state: HouseholdUiState,
    onCreateInvite: () -> Unit,
    onRedeemInvite: (code: String, passwort: String, faktorCode: String?) -> Unit,
    onUnlink: (Int) -> Unit,
    onUnlinkParent: (Int) -> Unit,
    onVerwerfen: (Int) -> Unit,
) {
    val st = state.status
    // remember, not rememberSaveable: saved state lands in the Bundle and, on
    // process death, on disk (ActivityManager) — no place for passwords and codes.
    var code by remember { mutableStateOf("") }
    var passwort by remember { mutableStateOf("") }
    var faktorCode by remember { mutableStateOf("") }
    LaunchedEffect(state.eingeloest) { if (state.eingeloest > 0) code = "" }
    // Via SecretClipboard instead of LocalClipboard: it takes the code back out
    // after a minute, even if the page is already closed by then.
    val context = LocalContext.current
    // A ClipData's label is visible on some Android UIs and therefore
    // belongs in the language files. Fetched here because the click handler isn't
    // @Composable.
    val invitationLabel = stringResource(R.string.household_invite_label)
    // Unlinking takes a main account's view of someone else's data away; getting
    // back needs a new invitation. That's why it asks first, with the account's name.
    // Remembers the account ID and whether it's a main account.
    var trennen by rememberSaveable { mutableStateOf<Int?>(null) }
    var separatesParent by rememberSaveable { mutableStateOf(false) }

    // Two sentences up front, the rest on request: six lines of explanation before
    // the first button, nobody read them.
    ErklaerText(stringResource(R.string.household_intro),
        stringResource(R.string.household_intro_more), thema = stringResource(R.string.household_title))

    // An account can be both a sub-account (of several main accounts too) and
    // a main account of its own sub-accounts: both lists are independent.
    val eltern = st?.elternkonten.orEmpty()
    // Sub-accounts only: the card is named for that directly, instead of showing
    // "Linked accounts" with "Sub-accounts" as a second heading below it.
    val onlySubAccounts = eltern.isEmpty() && st?.subAccounts?.isNotEmpty() == true
    if (st != null) Abschnitt(stringResource(if (onlySubAccounts) R.string.household_state_main else R.string.household_linked)) {
        if (eltern.isNotEmpty()) {
            Text(stringResource(R.string.household_state_parents),
                style = MaterialTheme.typography.labelLarge)
            eltern.forEach { m ->
                AccountRow(m.username, stringResource(R.string.household_unlink)) {
                    trennen = m.id; separatesParent = true
                }
            }
        }
        if (st.subAccounts.isNotEmpty()) {
            if (!onlySubAccounts) Text(stringResource(R.string.household_state_main),
                style = MaterialTheme.typography.labelLarge)
            st.subAccounts.forEach { m ->
                AccountRow(m.username, stringResource(R.string.household_remove)) {
                    trennen = m.id; separatesParent = false
                }
            }
        }
        if (eltern.isEmpty() && st.subAccounts.isEmpty()) {
            Text(stringResource(R.string.household_state_none),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (st.formerLinks.isNotEmpty()) {
            Surface(color = MaterialTheme.colorScheme.secondaryContainer,
                    shape = MaterialTheme.shapes.small) {
                Column(Modifier.padding(Abstaende.mittel),
                       verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    Text(stringResource(R.string.household_former_intro),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSecondaryContainer)
                    st.formerLinks.forEach { f ->
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                            Column(Modifier.weight(1f)) {
                                Text(f.username, fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSecondaryContainer)
                                f.via?.let {
                                    Text(stringResource(R.string.household_former_via, it),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSecondaryContainer)
                                }
                            }
                            TextButton(onClick = { onVerwerfen(f.id) }) {
                                Text(stringResource(R.string.household_former_dismiss))
                            }
                        }
                    }
                }
            }
        }
    }

    if (st != null) Abschnitt(stringResource(R.string.household_invite_section)) {
        Text(stringResource(R.string.household_invite_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = onCreateInvite, enabled = !state.abruf.laedt, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.household_invite_create))
        }
        state.inviteCode?.let { c ->
            OutlinedTextField(
                value = c, onValueChange = {}, readOnly = true, singleLine = true,
                label = { Text(stringResource(R.string.household_invite_label)) },
                modifier = Modifier.fillMaxWidth(), shape = Formen.feld,
            )
            state.inviteValidUntil?.let { bis ->
                Text(stringResource(R.string.household_invite_gueltig_bis,
                        fmtStatus(bis, appNumberLocale(), twentyFour = twentyFourHours(), jahr = DateYear.OHNE)),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            // The code belongs on a different device: share and copy, both weighted equally.
            val shareTitle = stringResource(R.string.household_invite_section)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                OutlinedButton(onClick = { partsCodes(context, shareTitle, listOf(c)) }, modifier = Modifier.weight(1f),
                    colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
                    Icon(Icons.Default.Share, null, Modifier.size(withFont(18.dp)))
                    Spacer(Modifier.width(Abstaende.klein))
                    Text(stringResource(R.string.household_invite_teilen))
                }
                // Below Android 13 the keyboard would see the code; sharing stays the way there.
                if (secretCopyable(LocalSdkLevel.current)) OutlinedButton(
                    onClick = { SecretClipboard.copy(context, invitationLabel, c) },
                    modifier = Modifier.weight(1f), colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
                    Icon(Icons.Default.ContentCopy, null, Modifier.size(withFont(18.dp)))
                    Spacer(Modifier.width(Abstaende.klein))
                    Text(stringResource(R.string.household_invite_copy))
                }
            }
        }
    }

    if (st != null) Abschnitt(stringResource(R.string.household_redeem_title)) {
        Text(stringResource(R.string.household_redeem_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        // Labeled with what belongs in it; "Accept invitation" is the heading.
        OutlinedTextField(
            value = code, onValueChange = { code = it }, singleLine = true,
            label = { Text(stringResource(R.string.household_invite_label)) },
            modifier = Modifier.fillMaxWidth(), shape = Formen.feld,
        )
        // After a failed attempt the field is empty and red, until typed in again.
        val passwordWrong = state.passwordWrong && passwort.isEmpty()
        PasswordField(passwort, { passwort = it }, stringResource(R.string.household_redeem_password),
            Modifier.fillMaxWidth(),
            hinweis = if (passwordWrong) stringResource(R.string.household_redeem_password_wrong) else null,
            faulty = passwordWrong)
        // With the second factor active, the server requires its code (or a recovery code).
        if (state.factorNeeded) {
            val factorWrong = state.factorWrong && faktorCode.isEmpty()
            OutlinedTextField(
                value = faktorCode, onValueChange = { faktorCode = it.take(24) }, singleLine = true,
                label = { Text(stringResource(R.string.household_redeem_code)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                isError = factorWrong,
                supportingText = if (factorWrong) {
                    { Text(stringResource(R.string.household_redeem_code_wrong)) }
                } else null,
                modifier = Modifier.fillMaxWidth(),
                shape = Formen.feld,
            )
        }
        // The server's message (currency differs, already linked) right above the button,
        // not at the page's end below every section.
        state.abruf.errorMessage?.takeUnless { state.passwordWrong || state.factorWrong }?.let {
            Text(it.satz(), Modifier.announce(), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }
        val bereit = code.isNotBlank() && passwort.isNotEmpty() && (!state.factorNeeded || faktorCode.isNotBlank())
        // As at sign-in: a disabled button says what's missing.
        if (!bereit) LockReason(stringResource(if (state.factorNeeded) R.string.household_redeem_sperrgrund_faktor
                                              else R.string.household_redeem_sperrgrund))
        Button(onClick = { onRedeemInvite(code, passwort, faktorCode.takeIf { state.factorNeeded }); passwort = ""; faktorCode = "" },
               enabled = bereit && !state.abruf.laedt, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.household_redeem_submit))
        }
    }

    trennen?.let { id ->
        val name = (if (separatesParent) eltern.firstOrNull { it.id == id }?.username
                    else st?.subAccounts.orEmpty().firstOrNull { it.id == id }?.username) ?: "—"
        Prompt(
            titel = stringResource(if (separatesParent) R.string.household_unlink_title else R.string.household_remove_title),
            text = stringResource(if (separatesParent) R.string.household_unlink_text else R.string.household_remove_text, name),
            bestaetigen = stringResource(if (separatesParent) R.string.household_unlink else R.string.household_remove),
            onBestaetigen = {
                trennen = null
                if (separatesParent) onUnlinkParent(id) else onUnlink(id)
            },
            onAbbrechen = { trennen = null },
            symbol = Icons.Default.LinkOff,
        )
    }
}

/** A linked account with its one action; TalkBack hears "Remove: lena", not just "Remove". */
@Composable
private fun AccountRow(name: String, aktion: String, onAction: () -> Unit) {
    val beschreibung = stringResource(R.string.aktion_fuer, aktion, name)
    Row(verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        Icon(Icons.Default.AccountCircle, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(name, modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
        TextButton(onClick = onAction, modifier = Modifier.semantics { contentDescription = beschreibung }) {
            Text(aktion, color = MaterialTheme.colorScheme.error)
        }
    }
}
