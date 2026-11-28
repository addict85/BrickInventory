package ch.brickinventoryapp.account.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.account.ui.HouseholdUiState
import ch.brickinventoryapp.model.domain.HouseholdStatusView
import ch.brickinventoryapp.model.util.DateYear
import ch.brickinventoryapp.model.util.fmtStatus
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.ExplainText
import ch.brickinventoryapp.ui.components.LockReason
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.components.Section
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.description
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.title
import ch.brickinventoryapp.ui.util.LocalSdkLevel
import ch.brickinventoryapp.ui.util.SecretClipboard
import ch.brickinventoryapp.ui.util.appNumberLocale
import ch.brickinventoryapp.ui.util.secretCopyable
import ch.brickinventoryapp.ui.util.twentyFourHours
import ch.brickinventoryapp.uistate.errorMessage
import ch.brickinventoryapp.uistate.loading

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
    onRedeemInvite: (code: String) -> Unit,
    onUnlink: (Int) -> Unit,
    onUnlinkParent: (Int) -> Unit,
    onDiscard: (Int) -> Unit,
) {
    val st = state.status
    // remember, not rememberSaveable: saved state lands in the Bundle and, on
    // process death, on disk (ActivityManager) — no place for an invitation code.
    val redeem = remember { RedeemDraft() }
    LaunchedEffect(state.redeemed) { if (state.redeemed > 0) redeem.code = "" }
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
    if (st != null) {
        LinkedSection(st, onDiscard) { id, parent -> separate = id; separateParent = parent }
        InviteSection(state, onCreateInvite)
        RedeemSection(state, redeem, onRedeemInvite)
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

/** The code of the invitation being accepted; only in memory. */
private class RedeemDraft {
    var code by mutableStateOf("")
}

/** Main accounts above, sub-accounts below, then links that ended; [onSeparate] gets (id, isParent). */
@Composable
private fun LinkedSection(st: HouseholdStatusView, onDiscard: (Int) -> Unit, onSeparate: (Int, Boolean) -> Unit) {
    val parents = st.parentAccounts
    // Sub-accounts only: the card is named for that directly, instead of showing
    // "Linked accounts" with "Sub-accounts" as a second heading below it.
    val onlySubAccounts = parents.isEmpty() && st.subAccounts.isNotEmpty()
    Section(stringResource(if (onlySubAccounts) R.string.household_state_main else R.string.household_linked)) {
        if (parents.isNotEmpty()) {
            Text(stringResource(R.string.household_state_parents),
                style = MaterialTheme.typography.labelLarge)
            parents.forEach { m ->
                AccountRow(m.username, stringResource(R.string.household_unlink)) { onSeparate(m.id, true) }
            }
        }
        if (st.subAccounts.isNotEmpty()) {
            if (!onlySubAccounts) Text(stringResource(R.string.household_state_main),
                style = MaterialTheme.typography.labelLarge)
            st.subAccounts.forEach { m ->
                AccountRow(m.username, stringResource(R.string.household_remove)) { onSeparate(m.id, false) }
            }
        }
        if (parents.isEmpty() && st.subAccounts.isEmpty()) {
            Text(stringResource(R.string.household_state_none),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (st.formerLinks.isNotEmpty()) FormerLinks(st, onDiscard)
    }
}

/** Links the other side ended; each can be dismissed. */
@Composable
private fun FormerLinks(st: HouseholdStatusView, onDiscard: (Int) -> Unit) {
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

/** Create an invitation and hand its code to the other device. */
@Composable
private fun InviteSection(state: HouseholdUiState, onCreateInvite: () -> Unit) {
    Section(stringResource(R.string.household_invite_section)) {
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
            InviteHandOver(c)
        }
    }
}

/** The code belongs on a different device: share and copy, both weighted equally. */
@Composable
private fun InviteHandOver(c: String) {
    // Via SecretClipboard instead of LocalClipboard: it takes the code back out
    // after a minute, even if the page is already closed by then.
    val context = LocalContext.current
    // A ClipData's label is visible on some Android UIs and therefore
    // belongs in the language files. Fetched here because the click handler isn't
    // @Composable.
    val invitationLabel = stringResource(R.string.household_invite_label)
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

/** Accept an invitation: only its code, the login is enough (no password, no second factor). */
@Composable
private fun RedeemSection(
    state: HouseholdUiState,
    draft: RedeemDraft,
    onRedeemInvite: (code: String) -> Unit,
) {
    Section(stringResource(R.string.household_redeem_title)) {
        Text(stringResource(R.string.household_redeem_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        // Labeled with what belongs in it; "Accept invitation" is the heading.
        OutlinedTextField(
            value = draft.code, onValueChange = { draft.code = it }, singleLine = true,
            label = { Text(stringResource(R.string.household_invite_label)) },
            modifier = Modifier.fillMaxWidth(), shape = Shapes.field,
        )
        // The server's message (currency differs, already linked) right above the button,
        // not at the page's end below every section.
        state.fetch.errorMessage?.let {
            Text(it.sentence(), Modifier.announce(), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }
        val ready = draft.code.isNotBlank()
        // As at sign-in: a disabled button says what's missing.
        if (!ready) LockReason(stringResource(R.string.household_redeem_lock_reason))
        Button(onClick = { onRedeemInvite(draft.code) },
               enabled = ready && !state.fetch.loading, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.household_redeem_submit))
        }
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
