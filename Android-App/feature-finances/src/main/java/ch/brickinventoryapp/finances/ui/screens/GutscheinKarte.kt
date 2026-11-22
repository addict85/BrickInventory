package ch.brickinventoryapp.finances.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.model.domain.VoucherView
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.util.fmtTag
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.finances.ui.inGroupsOfFour
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.model.domain.PlaintextView
import ch.brickinventoryapp.ui.theme.Formen

/**
 * A voucher as a card: number on the left (in groups of four, because nineteen digits
 * cannot be read off at the checkout), amount and balance-query status, a menu on the right with
 * balance, PDF, edit and delete. A tap copies number and PIN. Every
 * action goes through EXACTLY ONE callback; the device lock before it is set by GutscheineCard
 * (geschuetzt).
 */
@Composable
internal fun GutscheinKarte(
    g: VoucherView,
    pinSichtbar: Boolean,
    switchOnPin: () -> Unit,
    editOn: () -> Unit,
    deleteOn: () -> Unit,
    openOnPdf: () -> Unit,
    onKopieren: (isNumber: Boolean) -> Unit,
    onBalance: () -> Unit,
    balanceRunning: Boolean,
    /** Number and PIN in plain text, if they have already been fetched for this page. */
    klartext: PlaintextView?,
    modifier: Modifier = Modifier,
) {
    var menu by rememberSaveable { mutableStateOf(false) }
    // The whole number only with the PIN revealed; otherwise the server's mask.
    val nummer = inGroupsOfFour(if (pinSichtbar && klartext != null) klartext.number else g.number)

    OutlinedCard(modifier) {
      Column(Modifier.padding(start = Abstaende.mittel, top = Abstaende.tiny, bottom = Abstaende.klein),
             verticalArrangement = Arrangement.spacedBy(Abstaende.hairline)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // What gets copied is the plain text without groups of four: a payment field does not accept them.
            KopierRow(stringResource(R.string.vouchers_cd_copy_number, nummer), { onKopieren(true) },
                Modifier.weight(1f)) {
                Text(nummer, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            }
            Box {
                MitTooltip(stringResource(R.string.vouchers_cd_menu, nummer)) {
                    IconButton(onClick = { menu = true }) {
                        if (balanceRunning) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        else Icon(Icons.Default.MoreVert, stringResource(R.string.vouchers_cd_menu, nummer))
                    }
                }
                DropdownMenu(menu, { menu = false }) {
                    // Balance ONLY with a PIN: LEGO asks for number AND PIN; without a PIN
                    // the entry would be a trap producing the same rejection every time.
                    if (g.pin != null) MenuEntry(stringResource(R.string.vouchers_menu_balance),
                        stringResource(R.string.vouchers_cd_balance, nummer), Icons.Default.Sync,
                        enabled = !balanceRunning) { menu = false; onBalance() }
                    if (g.hatPdf) MenuEntry(stringResource(R.string.vouchers_menu_pdf),
                        stringResource(R.string.vouchers_cd_pdf, nummer), Icons.Default.PictureAsPdf) {
                        menu = false; openOnPdf()
                    }
                    MenuEntry(stringResource(R.string.common_edit),
                        stringResource(R.string.vouchers_cd_edit, nummer), Icons.Default.Edit) { menu = false; editOn() }
                    MenuEntry(stringResource(R.string.common_delete),
                        stringResource(R.string.vouchers_cd_delete, nummer), Icons.Default.Delete) { menu = false; deleteOn() }
                }
            }
        }
        VoucherAmount(g)
        val pin = g.pin
        if (pin != null) Row(verticalAlignment = Alignment.CenterVertically) {
            // The PIN is also tappable while HIDDEN: copying does not mean viewing.
            val pinText = stringResource(R.string.vouchers_pin) + ": " + if (pinSichtbar) klartext?.pin ?: pin else "••••"
            KopierRow(stringResource(R.string.vouchers_cd_copy_pin, nummer), { onKopieren(false) }) {
                Text(pinText, style = MaterialTheme.typography.bodyMedium)
            }
            val pinToggle = stringResource(if (pinSichtbar) R.string.vouchers_pin_hide else R.string.vouchers_pin_show)
            MitTooltip(pinToggle) {
                IconButton(onClick = switchOnPin) {
                    // In primary like the copy icon next to it: actions of equal rank, one color.
                    Icon(
                        if (pinSichtbar) Icons.Default.VisibilityOff else Icons.Default.Visibility,
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
    beschreibung: String,
    symbol: androidx.compose.ui.graphics.vector.ImageVector,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    DropdownMenuItem(
        text = { Text(text) },
        onClick = onClick,
        enabled = enabled,
        leadingIcon = { Icon(symbol, null) },
        modifier = Modifier.semantics { contentDescription = beschreibung },
    )
}

/**
 * A tappable row that copies something: at least 48 dp tall, with a visible
 * copy icon at the end. The description names WHAT is copied.
 */
@Composable
private fun KopierRow(
    beschreibung: String,
    onKopieren: () -> Unit,
    modifier: Modifier = Modifier,
    inhalt: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier.heightIn(min = 48.dp)
            .clickable(role = Role.Button, onClickLabel = beschreibung, onClick = onKopieren)
            .semantics(mergeDescendants = true) { contentDescription = beschreibung }
            .padding(end = Abstaende.klein),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
    ) {
        inhalt()
        // The same size for number and PIN (previously 24 and 18 dp).
        Icon(Icons.Default.ContentCopy, null, Modifier.size(withFont(18.dp)), tint = MaterialTheme.colorScheme.primary)
    }
}

/** Amount and status of the last balance query. */
@Composable
private fun VoucherAmount(g: VoucherView) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
        modifier = Modifier.padding(end = Abstaende.mittel)) {
        Text(fmtMoney(g.amount, g.currency), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        // The status of the query as a label and in words, not only as a color.
        val stand = fmtTag(g.guthabenGeprueftAm)
        Surface(shape = Formen.etikett, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
            Text(
                if (stand != null) stringResource(R.string.vouchers_balance_as_of, stand)
                else stringResource(R.string.vouchers_balance_never),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = Abstaende.klein, vertical = Abstaende.hairline),
            )
        }
    }
}
