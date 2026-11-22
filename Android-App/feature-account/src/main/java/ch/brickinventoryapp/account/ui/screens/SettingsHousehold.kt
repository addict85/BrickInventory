package ch.brickinventoryapp.account.ui.screens

import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.ui.errorMessage
import androidx.compose.ui.platform.LocalContext
import ch.brickinventoryapp.model.util.DateYear
import ch.brickinventoryapp.model.util.fmtStatus
import ch.brickinventoryapp.ui.util.appNumberLocale
import ch.brickinventoryapp.ui.util.twentyFourHours
import androidx.compose.material.icons.filled.Share
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.components.secondaryButtonColors
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
import ch.brickinventoryapp.ui.description
import ch.brickinventoryapp.ui.title
import ch.brickinventoryapp.ui.components.Section
import ch.brickinventoryapp.ui.components.PasswordField
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.account.ui.HouseholdUiState
import ch.brickinventoryapp.ui.components.ExplainText
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
    onRedeemInvite: (code: String, password: String, factorCode: String?) -> Unit,
    onUnlink: (Int) -> Unit,
    onUnlinkParent: (Int) -> Unit,
    onDiscard: (Int) -> Unit,
) {
    val st = state.status
    // remember, not rememberSaveable: saved state lands in the Bundle and, on
    // process death, on disk (ActivityManager) — no place for passwords and codes.
    var code by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var factorCode by remember { mutableStateOf("") }
    LaunchedEffect(state.redeemed) { if (state.redeemed > 0) code = "" }
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
    var separate by rememberSaveable { mutableStateOf<Int?>(null) }
    var separateParent by rememberSaveable { mutableStateOf(false) }

    // Two sentences up front, the rest on request: six lines of explanation before
    // the first button, nobody read them.
    ExplainText(stringResource(R.string.household_intro),
        stringResource(R.string.household_intro_more), theme = stringResource(R.string.household_title))

    // An account can be both a sub-account (of several main accounts too) and
    // a main account of its own sub-accounts: both lists are independent.
    val parents = st?.parentAccounts.orEmpty()
    // Sub-accounts only: the card is named for that directly, instead of showing
    // "Linked accounts" with "Sub-accounts" as a second heading below it.
    val onlySubAccounts = parents.isEmpty() && st?.subAccounts?.isNotEmpty() == true
    if (st != null) Section(stringResource(if (onlySubAccounts) R.string.household_state_main else R.string.household_linked)) {
        if (parents.isNotEmpty()) {
            Text(stringResource(R.string.household_state_parents),
                style = MaterialTheme.typography.labelLarge)
            parents.forEach { m ->
                AccountRow(m.username, stringResource(R.string.household_unlink)) {
                    separate = m.id; separateParent = true
                }
            }
        }
        if (st.subAccounts.isNotEmpty()) {
            if (!onlySubAccounts) Text(stringResource(R.string.household_state_main),
                style = MaterialTheme.typography.labelLarge)
            st.subAccounts.forEach { m ->
                AccountRow(m.username, stringResource(R.string.household_remove)) {
                    separate = m.id; separateParent = false
                }
            }
        }
        if (parents.isEmpty() && st.subAccounts.isEmpty()) {
            Text(stringResource(R.string.household_state_none),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (st.formerLinks.isNotEmpty()) {
            Surface(color = MaterialTheme.colorScheme.secondaryContainer,
                    shape = MaterialTheme.shapes.small) {
                Column(Modifier.padding(Spacing.medium),
                       verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
                    Text(stringResource(R.string.household_former_intro),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSecondaryContainer)
                    st.formerLinks.forEach { f ->
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
                            Column(Modifier.weight(1f)) {
                                Text(f.username, fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSecondaryContainer)
                                f.via?.let {
                                    Text(stringResource(R.string.household_former_via, it),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSecondaryContainer)
                                }
                            }
                            TextButton(onClick = { onDiscard(f.id) }) {
                                Text(stringResource(R.string.household_former_dismiss))
                            }
                        }
                    }
                }
            }
        }
    }

    if (st != null) Section(stringResource(R.string.household_invite_section)) {
        Text(stringResource(R.string.household_invite_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = onCreateInvite, enabled = !state.fetch.loading, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.household_invite_create))
        }
        state.inviteCode?.let { c ->
            OutlinedTextField(
                value = c, onValueChange = {}, readOnly = true, singleLine = true,
                label = { Text(stringResource(R.string.household_invite_label)) },
                modifier = Modifier.fillMaxWidth(), shape = Shapes.field,
            )
            state.inviteValidUntil?.let { until ->
                Text(stringResource(R.string.household_invite_valid_until,
                        fmtStatus(until, appNumberLocale(), twentyFour = twentyFourHours(), year = DateYear.WITHOUT)),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            // The code belongs on a different device: share and copy, both weighted equally.
            val shareTitle = stringResource(R.string.household_invite_section)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
                OutlinedButton(onClick = { partsCodes(context, shareTitle, listOf(c)) }, modifier = Modifier.weight(1f),
                    colors = secondaryButtonColors(), border = secondaryButtonRand()) {
                    Icon(Icons.Default.Share, null, Modifier.size(withFont(18.dp)))
                    Spacer(Modifier.width(Spacing.small))
                    Text(stringResource(R.string.household_invite_share))
                }
                // Below Android 13 the keyboard would see the code; sharing stays the way there.
                if (secretCopyable(LocalSdkLevel.current)) OutlinedButton(
                    onClick = { SecretClipboard.copy(context, invitationLabel, c) },
                    modifier = Modifier.weight(1f), colors = secondaryButtonColors(), border = secondaryButtonRand()) {
                    Icon(Icons.Default.ContentCopy, null, Modifier.size(withFont(18.dp)))
                    Spacer(Modifier.width(Spacing.small))
                    Text(stringResource(R.string.household_invite_copy))
                }
            }
        }
    }

    if (st != null) Section(stringResource(R.string.household_redeem_title)) {
        Text(stringResource(R.string.household_redeem_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        // Labeled with what belongs in it; "Accept invitation" is the heading.
        OutlinedTextField(
            value = code, onValueChange = { code = it }, singleLine = true,
            label = { Text(stringResource(R.string.household_invite_label)) },
            modifier = Modifier.fillMaxWidth(), shape = Shapes.field,
        )
        // After a failed attempt the field is empty and red, until typed in again.
        val passwordWrong = state.passwordWrong && password.isEmpty()
        PasswordField(password, { password = it }, stringResource(R.string.household_redeem_password),
            Modifier.fillMaxWidth(),
            hint = if (passwordWrong) stringResource(R.string.household_redeem_password_wrong) else null,
            faulty = passwordWrong)
        // With the second factor active, the server requires its code (or a recovery code).
        if (state.factorNeeded) {
            val factorWrong = state.factorWrong && factorCode.isEmpty()
            OutlinedTextField(
                value = factorCode, onValueChange = { factorCode = it.take(24) }, singleLine = true,
                label = { Text(stringResource(R.string.household_redeem_code)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                isError = factorWrong,
                supportingText = if (factorWrong) {
                    { Text(stringResource(R.string.household_redeem_code_wrong)) }
                } else null,
                modifier = Modifier.fillMaxWidth(),
                shape = Shapes.field,
            )
        }
        // The server's message (currency differs, already linked) right above the button,
        // not at the page's end below every section.
        state.fetch.errorMessage?.takeUnless { state.passwordWrong || state.factorWrong }?.let {
            Text(it.sentence(), Modifier.announce(), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }
        val ready = code.isNotBlank() && password.isNotEmpty() && (!state.factorNeeded || factorCode.isNotBlank())
        // As at sign-in: a disabled button says what's missing.
        if (!ready) LockReason(stringResource(if (state.factorNeeded) R.string.household_redeem_lock_reason_factor
                                              else R.string.household_redeem_lock_reason))
        Button(onClick = { onRedeemInvite(code, password, factorCode.takeIf { state.factorNeeded }); password = ""; factorCode = "" },
               enabled = ready && !state.fetch.loading, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.household_redeem_submit))
        }
    }

    separate?.let { id ->
        val name = (if (separateParent) parents.firstOrNull { it.id == id }?.username
                    else st?.subAccounts.orEmpty().firstOrNull { it.id == id }?.username) ?: "—"
        Prompt(
            title = stringResource(if (separateParent) R.string.household_unlink_title else R.string.household_remove_title),
            text = stringResource(if (separateParent) R.string.household_unlink_text else R.string.household_remove_text, name),
            confirm = stringResource(if (separateParent) R.string.household_unlink else R.string.household_remove),
            onConfirm = {
                separate = null
                if (separateParent) onUnlinkParent(id) else onUnlink(id)
            },
            onCancel = { separate = null },
            symbol = Icons.Default.LinkOff,
        )
    }
}

/** A linked account with its one action; TalkBack hears "Remove: lena", not just "Remove". */
@Composable
private fun AccountRow(name: String, action: String, onAction: () -> Unit) {
    val description = stringResource(R.string.action_for, action, name)
    Row(verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
        Icon(Icons.Default.AccountCircle, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(name, modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
        TextButton(onClick = onAction, modifier = Modifier.semantics { contentDescription = description }) {
            Text(action, color = MaterialTheme.colorScheme.error)
        }
    }
}
