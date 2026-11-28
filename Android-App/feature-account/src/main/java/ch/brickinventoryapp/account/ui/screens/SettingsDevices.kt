package ch.brickinventoryapp.account.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.account.ui.DevicesUiState
import ch.brickinventoryapp.model.domain.DeviceView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.components.SettingsCard
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.title
import ch.brickinventoryapp.ui.util.fmtTag
import ch.brickinventoryapp.uistate.Load
import ch.brickinventoryapp.uistate.loading
import ch.brickinventoryapp.uistate.running

/**
 * Signed-in devices: see and lock out the issued access tokens.
 * One's own access has no button: whoever revokes it signs themself out, and that's what
 * Sign out is for.
 */
@Composable
internal fun DevicesCard(
    condition: DevicesUiState,
    onReload: () -> Unit,
    onQuestion: (tokenId: String?) -> Unit,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    SettingsCard(title = stringResource(R.string.tokens_title), icon = Icons.Default.Devices) {
        Text(stringResource(R.string.tokens_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = Spacing.medium))

        when {
            condition.fetch.loading && condition.devices.isEmpty() ->
                CircularProgressIndicator(Modifier.size(22.dp))
            condition.fetch is Load.Failure ->
                Text(condition.fetch.message.sentence(), color = MaterialTheme.colorScheme.error,
                     style = MaterialTheme.typography.bodySmall)
            condition.devices.isEmpty() ->
                Text(stringResource(R.string.tokens_none),
                     style = MaterialTheme.typography.bodySmall,
                     color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> Column(verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
                for (g in condition.devices) {
                    DeviceRow(g, redeemOn = { onQuestion(g.tokenId) })
                }
            }
        }

        Row(Modifier.padding(top = Spacing.medium), horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
            OutlinedButton(onClick = onReload, colors = secondaryButtonColors(), border = secondaryButtonRand()) {
                Text(stringResource(R.string.tokens_reload))
            }
            // Only offer it if there really are others — a button that
            // always reports "there are no others" is worse than none at all.
            if (condition.devices.count { !it.current } > 0) {
                OutlinedButton(
                    onClick = { onQuestion(null) },
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    border = secondaryButtonRand(),
                ) { Text(stringResource(R.string.tokens_revoke_others)) }
            }
        }
    }

    // Asks first, without a password: an access token that's gone doesn't come back,
    // and that device then has to sign in again. Hidden while the sign-out runs.
    val question = condition.prompt
    if (question != null && !question.operation.running) {
        val affected = condition.devices.count { !it.current }
        Prompt(
            title = stringResource(if (question.tokenId == null) R.string.tokens_revoke_others_title else R.string.tokens_revoke_title),
            text = if (question.tokenId == null) pluralStringResource(R.plurals.tokens_revoke_others_text, affected, affected)
                   else stringResource(R.string.tokens_revoke_text,
                       condition.devices.firstOrNull { it.tokenId == question.tokenId }?.name ?: "—"),
            confirm = stringResource(R.string.tokens_revoke_confirm),
            onConfirm = onConfirm,
            onCancel = onCancel,
            symbol = Icons.Default.Delete,
        )
    }
}

/** A signed-in device: name, make, dates and, except for one's own, a lock-out. */
@Composable
private fun DeviceRow(g: DeviceView, redeemOn: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(g.name, fontWeight = FontWeight.SemiBold)
                if (g.current) Surface(
                    shape = Shapes.chip,
                    color = MaterialTheme.colorScheme.primaryContainer,
                ) {
                    Text(stringResource(R.string.tokens_current),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = Spacing.hairline))
                }
                // An access with admin rights should stand out in the list.
                if (g.fullAccess) Surface(
                    shape = Shapes.chip,
                    color = MaterialTheme.colorScheme.tertiaryContainer,
                ) {
                    Text(stringResource(R.string.tokens_full_access),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onTertiaryContainer,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = Spacing.hairline))
                }
            }
            Text(
                stringResource(R.string.tokens_row_hint,
                    fmtTag(g.created) ?: "—",
                    fmtTag(g.lastlyUsed) ?: stringResource(R.string.tokens_unused),
                    g.expiresAt?.let { fmtTag(it) ?: "—" } ?: stringResource(R.string.tokens_never)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (!g.current) WithTooltip(stringResource(R.string.tokens_revoke_title)) {
            IconButton(onClick = redeemOn) {
                Icon(Icons.Default.Delete,
                    stringResource(R.string.tokens_revoke_title),
                    tint = MaterialTheme.colorScheme.error)
            }
        }
    }
}
