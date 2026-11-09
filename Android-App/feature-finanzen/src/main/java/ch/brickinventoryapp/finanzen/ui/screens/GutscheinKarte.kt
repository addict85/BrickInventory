package ch.brickinventoryapp.finanzen.ui.screens

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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.ui.model.GutscheinAnsicht
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.util.fmtTag
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.finanzen.ui.inVierergruppen
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.model.ui.model.KlartextAnsicht
import ch.brickinventoryapp.ui.theme.Formen

/**
 * Ein Gutschein als Karte: links Nummer (in Vierergruppen, weil neunzehn Ziffern an
 * der Kasse nicht abzulesen sind), Betrag und Stand der Abfrage, rechts ein Menü mit
 * Guthaben, PDF, Bearbeiten und Löschen. Nummer und PIN kopiert ein Tipp. Jede
 * Aktion geht über GENAU EINEN Rückruf; die Gerätesperre davor setzt GutscheineCard
 * (geschuetzt).
 */
@Composable
internal fun GutscheinKarte(
    g: GutscheinAnsicht,
    pinSichtbar: Boolean,
    onPinSchalten: () -> Unit,
    onBearbeiten: () -> Unit,
    onLoeschen: () -> Unit,
    onPdfOeffnen: () -> Unit,
    onKopieren: (istNummer: Boolean) -> Unit,
    onGuthaben: () -> Unit,
    guthabenLaeuft: Boolean,
    /** Nummer und PIN im Klartext, wenn sie auf dieser Seite schon geholt sind. */
    klartext: KlartextAnsicht?,
    modifier: Modifier = Modifier,
) {
    var menue by rememberSaveable { mutableStateOf(false) }
    // Die ganze Nummer nur bei aufgedecktem PIN; sonst die Maske des Servers.
    val nummer = inVierergruppen(if (pinSichtbar && klartext != null) klartext.number else g.number)

    OutlinedCard(modifier) {
      Column(Modifier.padding(start = Abstaende.mittel, top = Abstaende.winzig, bottom = Abstaende.klein),
             verticalArrangement = Arrangement.spacedBy(Abstaende.haar)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // Kopiert wird der Klartext ohne Vierergruppen: Ein Bezahlfeld nimmt sie nicht an.
            KopierZeile(stringResource(R.string.vouchers_cd_copy_number, nummer), { onKopieren(true) },
                Modifier.weight(1f)) {
                Text(nummer, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            }
            Box {
                MitTooltip(stringResource(R.string.vouchers_cd_menu, nummer)) {
                    IconButton(onClick = { menue = true }) {
                        if (guthabenLaeuft) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        else Icon(Icons.Default.MoreVert, stringResource(R.string.vouchers_cd_menu, nummer))
                    }
                }
                DropdownMenu(menue, { menue = false }) {
                    // Guthaben NUR mit PIN: LEGO fragt Nummer UND PIN ab; ohne PIN wäre
                    // der Eintrag eine Falle, die immer dieselbe Absage erzeugt.
                    if (g.pin != null) MenueEintrag(stringResource(R.string.vouchers_menu_balance),
                        stringResource(R.string.vouchers_cd_balance, nummer), Icons.Default.Sync,
                        enabled = !guthabenLaeuft) { menue = false; onGuthaben() }
                    if (g.hatPdf) MenueEintrag(stringResource(R.string.vouchers_menu_pdf),
                        stringResource(R.string.vouchers_cd_pdf, nummer), Icons.Default.PictureAsPdf) {
                        menue = false; onPdfOeffnen()
                    }
                    MenueEintrag(stringResource(R.string.common_edit),
                        stringResource(R.string.vouchers_cd_edit, nummer), Icons.Default.Edit) { menue = false; onBearbeiten() }
                    MenueEintrag(stringResource(R.string.common_delete),
                        stringResource(R.string.vouchers_cd_delete, nummer), Icons.Default.Delete) { menue = false; onLoeschen() }
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            modifier = Modifier.padding(end = Abstaende.mittel)) {
            Text(fmtMoney(g.amount, g.currency), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            // Der Stand der Abfrage als Etikett und im Wort, nicht nur als Farbe.
            val stand = fmtTag(g.guthabenGeprueftAm)
            Surface(shape = Formen.etikett, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                Text(
                    if (stand != null) stringResource(R.string.vouchers_balance_as_of, stand)
                    else stringResource(R.string.vouchers_balance_never),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = Abstaende.klein, vertical = Abstaende.haar),
                )
            }
        }
        val pin = g.pin
        if (pin != null) Row(verticalAlignment = Alignment.CenterVertically) {
            // Der PIN ist auch VERDECKT antippbar: Kopieren heisst nicht ansehen.
            val pinText = stringResource(R.string.vouchers_pin) + ": " + if (pinSichtbar) klartext?.pin ?: pin else "••••"
            KopierZeile(stringResource(R.string.vouchers_cd_copy_pin, nummer), { onKopieren(false) }) {
                Text(pinText, style = MaterialTheme.typography.bodyMedium)
            }
            val pinSchalter = stringResource(if (pinSichtbar) R.string.vouchers_pin_hide else R.string.vouchers_pin_show)
            MitTooltip(pinSchalter) {
                IconButton(onClick = onPinSchalten) {
                    // In primary wie das Kopiersymbol daneben: gleichrangige Handlungen, eine Farbe.
                    Icon(
                        if (pinSichtbar) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = pinSchalter,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
      }
    }
}

/** Ein Eintrag im Gutscheinmenü: sichtbarer Text, vorgelesen mit der Nummer. */
@Composable
private fun MenueEintrag(
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
 * Eine antippbare Zeile, die etwas kopiert: mindestens 48 dp hoch, mit sichtbarem
 * Kopiersymbol am Ende. Die Beschreibung nennt, WAS kopiert wird.
 */
@Composable
private fun KopierZeile(
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
        // Dieselbe Grösse an Nummer und PIN (vorher 24 und 18 dp).
        Icon(Icons.Default.ContentCopy, null, Modifier.size(mitSchrift(18.dp)), tint = MaterialTheme.colorScheme.primary)
    }
}
