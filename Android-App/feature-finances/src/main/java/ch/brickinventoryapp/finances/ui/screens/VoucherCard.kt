package ch.brickinventoryapp.finances.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.finances.ui.inGroupsOfFour
import ch.brickinventoryapp.model.domain.PlaintextView
import ch.brickinventoryapp.model.domain.VoucherView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtTag

/** What a voucher card can trigger; each already behind the device lock where needed. */
internal class VoucherEvents(
    val switchPin: () -> Unit,
    val edit: () -> Unit,
    val delete: () -> Unit,
    val openPdf: () -> Unit,
    val copy: (isNumber: Boolean) -> Unit,
    val queryBalance: () -> Unit,
)

/**
 * A voucher as a card: number on the left (in groups of four, because nineteen digits
 * cannot be read off at the checkout), amount and balance-query status, a menu on the right with
 * balance, PDF, edit and delete. A tap copies number and PIN. Every
 * action goes through EXACTLY ONE callback; the device lock before it is set by VouchersCard
 * (protected).
 */
@Composable
internal fun VoucherCard(
    g: VoucherView,
    pinVisible: Boolean,
    events: VoucherEvents,
    balanceRunning: Boolean,
    /** Number and PIN in plain text, if they have already been fetched for this page. */
    plaintext: PlaintextView?,
    modifier: Modifier = Modifier,
) {
    var menu by rememberSaveable { mutableStateOf(false) }
    // The whole number only with the PIN revealed; otherwise the server's mask.
    val number = inGroupsOfFour(if (pinVisible && plaintext != null) plaintext.number else g.number)

    OutlinedCard(modifier) {
      Column(Modifier.padding(start = Spacing.medium, top = Spacing.tiny, bottom = Spacing.small),
             verticalArrangement = Arrangement.spacedBy(Spacing.hairline)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // What gets copied is the plain text without groups of four: a payment field does not accept them.
            CopyRow(stringResource(R.string.vouchers_cd_copy_number, number), { events.copy(true) },
                Modifier.weight(1f)) {
                Text(number, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            }
            Box {
                WithTooltip(stringResource(R.string.vouchers_cd_menu, number)) {
                    IconButton(onClick = { menu = true }) {
                        if (balanceRunning) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        else Icon(Icons.Default.MoreVert, stringResource(R.string.vouchers_cd_menu, number))
                    }
                }
                DropdownMenu(menu, { menu = false }) {
                    // Balance ONLY with a PIN: LEGO asks for number AND PIN; without a PIN
                    // the entry would be a trap producing the same rejection every time.
                    if (g.pin != null) MenuEntry(stringResource(R.string.vouchers_menu_balance),
                        stringResource(R.string.vouchers_cd_balance, number), Icons.Default.Sync,
                        enabled = !balanceRunning) { menu = false; events.queryBalance() }
                    if (g.hasPdf) MenuEntry(stringResource(R.string.vouchers_menu_pdf),
                        stringResource(R.string.vouchers_cd_pdf, number), Icons.Default.PictureAsPdf) {
                        menu = false; events.openPdf()
                    }
                    MenuEntry(stringResource(R.string.common_edit),
                        stringResource(R.string.vouchers_cd_edit, number), Icons.Default.Edit) { menu = false; events.edit() }
                    MenuEntry(stringResource(R.string.common_delete),
                        stringResource(R.string.vouchers_cd_delete, number), Icons.Default.Delete) { menu = false; events.delete() }
                }
            }
        }
        VoucherAmount(g)
        val pin = g.pin
        if (pin != null) Row(verticalAlignment = Alignment.CenterVertically) {
            // The PIN is also tappable while HIDDEN: copying does not mean viewing.
            val pinText = stringResource(R.string.vouchers_pin) + ": " + if (pinVisible) plaintext?.pin ?: pin else "••••"
            CopyRow(stringResource(R.string.vouchers_cd_copy_pin, number), { events.copy(false) }) {
                Text(pinText, style = MaterialTheme.typography.bodyMedium)
            }
            val pinToggle = stringResource(if (pinVisible) R.string.vouchers_pin_hide else R.string.vouchers_pin_show)
            WithTooltip(pinToggle) {
                IconButton(onClick = events.switchPin) {
                    // In primary like the copy icon next to it: actions of equal rank, one color.
                    Icon(
                        if (pinVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = pinToggle,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
      }
    }
}

/** An entry in the voucher menu: visible text, read out along with the number. */
@Composable
private fun MenuEntry(
    text: String,
    description: String,
    symbol: androidx.compose.ui.graphics.vector.ImageVector,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    DropdownMenuItem(
        text = { Text(text) },
        onClick = onClick,
        enabled = enabled,
        leadingIcon = { Icon(symbol, null) },
        modifier = Modifier.semantics { contentDescription = description },
    )
}

/**
 * A tappable row that copies something: at least 48 dp tall, with a visible
 * copy icon at the end. The description names WHAT is copied.
 */
@Composable
private fun CopyRow(
    description: String,
    onCopy: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier.heightIn(min = 48.dp)
            .clickable(role = Role.Button, onClickLabel = description, onClick = onCopy)
            .semantics(mergeDescendants = true) { contentDescription = description }
            .padding(end = Spacing.small),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.small),
    ) {
        content()
        // The same size for number and PIN (previously 24 and 18 dp).
        Icon(Icons.Default.ContentCopy, null, Modifier.size(withFont(18.dp)), tint = MaterialTheme.colorScheme.primary)
    }
}

/** Amount and status of the last balance query. */
@Composable
private fun VoucherAmount(g: VoucherView) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.small),
        modifier = Modifier.padding(end = Spacing.medium)) {
        Text(fmtMoney(g.amount, g.currency), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        // The status of the query as a label and in words, not only as a color.
        val state = fmtTag(g.balanceCheckedAt)
        Surface(shape = Shapes.tag, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
            Text(
                if (state != null) stringResource(R.string.vouchers_balance_as_of, state)
                else stringResource(R.string.vouchers_balance_never),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = Spacing.small, vertical = Spacing.hairline),
            )
        }
    }
}
