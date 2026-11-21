package ch.brickinventoryapp.shared.ui

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.Zustand
import androidx.compose.ui.graphics.luminance
import ch.brickinventoryapp.ui.components.SmallerButton
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.model.domain.KaufAnsicht
import ch.brickinventoryapp.model.domain.AccountView
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.BrickSay
import ch.brickinventoryapp.ui.theme.BrickSayText
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.stueckzahl
import ch.brickinventoryapp.ui.components.readAloudAs
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.withFont

/**
 * Shared composables for manually captured parts AND minifigs.
 * Both types have identical acquisition logic — no code duplication.
 */

// ── Compact read-only acquisition summary (as in the set detail) ─────────────────

@Composable
fun AcquisitionSummarySection(
    acquisitions: List<KaufAnsicht>,
    currency: Waehrung,
    onEditPrices: () -> Unit
) {
    // With large text, the purchases go UNDER the label: next to it there was
    // so little width left for „CHF 700.00“ that the amount wrapped digit by digit.
    val untereinander = largeFont()
    val ausrichtung = if (untereinander) Alignment.Start else Alignment.End
    val kaeufe: @Composable () -> Unit = {
        Column(horizontalAlignment = ausrichtung) {
            if (acquisitions.isEmpty()) {
                Text(stringResource(R.string.detail_purchase_none), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                acquisitions.forEach { acq -> PurchaseRow(acq, currency) }
            }
            Spacer(Modifier.height(Abstaende.tiny))
            // Visibly small below the purchases, tapped in 48 dp.
            SmallerButton(onClick = onEditPrices,
                form = ButtonDefaults.outlinedShape,
                flaeche = Modifier.heightIn(min = 28.dp),
                inhaltFarbe = nebenKnopfFarben().contentColor,
                edge = nebenKnopfRand(),
                innen = PaddingValues(horizontal = 10.dp, vertical = Abstaende.hairline)) {
                Icon(Icons.Default.Edit, null, Modifier.size(withFont(14.dp)))
                Spacer(Modifier.width(Abstaende.tiny))
                Text(stringResource(R.string.detail_edit_prices), style = MaterialTheme.typography.labelMedium)
            }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(Abstaende.tiny)) {
        val bezeichnung: @Composable () -> Unit = {
            Text(
                stringResource(R.string.detail_purchase_price),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = Abstaende.hairline)
            )
        }
        if (untereinander) {
            bezeichnung()
            kaeufe()
        } else Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top
        ) {
            bezeichnung()
            kaeufe()
        }
        HorizontalDivider()
    }
}

/**
 * A purchase: quantity, condition, amount. FlowRow, so the amount, with little space, moves
 * to the next line as a whole; it itself never wraps.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PurchaseRow(acq: KaufAnsicht, currency: Waehrung) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        val middle = Modifier.align(Alignment.CenterVertically)
        Text(mengeManuell(acq.quantity), middle.readAloudAs(stueckzahl(acq.quantity)),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Box(middle) { ConditionBadge(acq.condition) }
        // Without an amount, the row says none is captured; otherwise „×2 Neu“ stood there alone.
        val preis = acq.effectivePrice
        if (preis != null) {
            Text(fmtMoney(preis, currency), fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium,
                maxLines = 1, softWrap = false, modifier = middle)
        } else {
            Text(stringResource(R.string.detail_purchase_none), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = middle)
        }
    }
}

// ── Condition badge (shared by sets, parts, figs) ────────────────────────────

/**
 * One badge per captured condition. `condition` is an aggregate with a single value
 * and would hide the new-condition entry next to a used one. Which ones exist
 * is decided by the server (`conditions`); older responses without the field fall back to
 * `condition`.
 */
@Composable
fun ConditionBadges(conditions: List<Zustand>, fallback: Zustand? = null) {
    val list = if (conditions.isNotEmpty()) conditions else listOf(fallback ?: Zustand.NEU)
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        list.forEach { ConditionBadge(it) }
    }
}

@Composable
fun ConditionBadge(condition: Zustand) {
    val isUsed = condition == Zustand.GEBRAUCHT
    // Sage only in the light stone theme: in the dark theme, the light pill glowed on the dark card.
    val isBrick = LocalIsBrickTheme.current && MaterialTheme.colorScheme.surface.luminance() > 0.5f
    val bgColor = when {
        isUsed  -> MaterialTheme.colorScheme.secondaryContainer
        isBrick -> BrickSay
        else    -> MaterialTheme.colorScheme.primaryContainer
    }
    val fgColor = when {
        isUsed  -> MaterialTheme.colorScheme.onSecondaryContainer
        isBrick -> BrickSayText
        else    -> MaterialTheme.colorScheme.onPrimaryContainer
    }
    Surface(
        shape = Formen.etikett,
        color = bgColor
    ) {
        Text(
            if (isUsed) stringResource(R.string.condition_used) else stringResource(R.string.condition_new),
            Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = fgColor
        )
    }
}

/**
 * Replacement-part badge in the shape of [ConditionBadge], but in a calm
 * fill color: a replacement part is secondary information, not a condition.
 */
@Composable
fun SparePartBadge(modifier: Modifier = Modifier) {
    Surface(shape = Formen.etikett, color = MaterialTheme.colorScheme.surfaceVariant, modifier = modifier) {
        Text(
            stringResource(R.string.parts_spare_tag),
            Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * A piece of information in chip form, not tappable: an AssistChip with an empty
 * onClick looked like a button, was read out as a button, and did nothing.
 */
@Composable
fun InfoBadge(text: String, modifier: Modifier = Modifier, icon: androidx.compose.ui.graphics.vector.ImageVector? = null) {
    Surface(shape = Formen.chip, color = MaterialTheme.colorScheme.secondaryContainer,
            contentColor = MaterialTheme.colorScheme.onSecondaryContainer, modifier = modifier) {
        Row(Modifier.padding(horizontal = Abstaende.klein, vertical = Abstaende.tiny),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstaende.tiny)) {
            if (icon != null) Icon(icon, null, Modifier.size(withFont(16.dp)))
            Text(text, style = MaterialTheme.typography.labelMedium)
        }
    }
}

// Only building blocks here that both the set detail and ManualItemDetailScreen use
// (AcquisitionSummarySection, ConditionBadge(s), purchase-price editor), so both pages
// show purchase prices the same way.

/**
 * The footer of a tile for a manually captured entry: the price, as on
 * the web app's `man-tile` and in the same order:
 *
 *   avg_purchase_price ?? unit_price ?? purchase_price
 *
 * The first is quantity-weighted across all captured purchases; the second is only the most recently
 * written single price.
 *
 * @param preis    raw amount; null = none stored, then it says „noch kein Preis“
 * @param waehrung currency code from settings
 */
@Composable
fun ManualTileFooter(preis: Geld?, waehrung: Waehrung) {
    Text(
        if (preis != null) fmtMoney(preis, waehrung) else stringResource(R.string.detail_price_none_yet),
        style = MaterialTheme.typography.bodySmall,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurface,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.padding(top = Abstaende.hairline),
    )
}

/**
 * Quantity, purchase price and condition — what every manual capture has, whether part or
 * figure; one implementation, so both dialogs look alike. The state stays
 * with the caller in `rememberSaveable`, so it survives a rotation. The number
 * stays outside: it's the real difference between the two dialogs.
 */
@Composable
fun ErfassungsFelder(
    anzahl: String,
    onCount: (String) -> Unit,
    /** What is being counted („quantity of identical parts“). */
    countHint: String,
    preis: String,
    onPrice: (String) -> Unit,
    zustand: Zustand,
    onZustand: (Zustand) -> Unit,
    /**
     * Storage location and its stock — here, because it belongs to the same block as the other
     * capture fields.
     */
    lagerort: String = "",
    onLocation: (String) -> Unit = {},
    lagerorte: List<String> = emptyList(),
) {
    CountField(anzahl, onCount, countHint)
    PurchasePriceField(preis, onPrice, stringResource(R.string.common_unit_price))
    Zustandszeile(zustand = zustand, onZustand = onZustand)
    LagerortErfassung(lagerort, lagerorte, onLocation)
}

/**
 * The quantity field of every capture, always with a help line: without it the fields
 * stood unevenly spaced apart, and one dialog left an empty gap.
 */
@Composable
fun CountField(wert: String, onValue: (String) -> Unit, hinweis: String) {
    OutlinedTextField(
        value = wert, onValueChange = { onValue(NumericInput.quantity(it)) },
        label = { Text(stringResource(R.string.common_quantity)) },
        isError = NumericInput.quantityInvalid(wert),
        supportingText = {
            if (NumericInput.quantityInvalid(wert)) Text(stringResource(R.string.erfassen_menge_ungueltig), Modifier.announce())
            else Text(hinweis)
        },
        modifier = Modifier.fillMaxWidth(), singleLine = true,
        shape = Formen.feld,
        keyboardOptions = NumericInput.ganzzahlTastatur(),
    )
}

/**
 * The purchase-price field of every capture. The hint sits as a help line instead of a
 * placeholder: that one disappeared on the first keystroke.
 */
@Composable
fun PurchasePriceField(wert: String, onValue: (String) -> Unit, beschriftung: String, onFertig: (() -> Unit)? = null) {
    OutlinedTextField(
        value = wert, onValueChange = { onValue(NumericInput.price(it)) },
        label = { Text(beschriftung) },
        isError = NumericInput.priceInvalid(wert),
        supportingText = {
            if (NumericInput.priceInvalid(wert)) Text(stringResource(R.string.erfassen_preis_ungueltig), Modifier.announce())
            else Text(stringResource(R.string.common_unit_price_placeholder))
        },
        modifier = Modifier.fillMaxWidth(), singleLine = true,
        shape = Formen.feld,
        keyboardOptions = NumericInput.priceKeyboard(),
        keyboardActions = if (onFertig != null) KeyboardActions(onDone = { onFertig() }) else KeyboardActions.Default,
    )
}

/**
 * The tile of a manually captured part or figure — one implementation, so
 * badges and footer don't need to be ported in just one of them. Only the
 * three differences go in (color dot, color row, label); size, shape, placeholder image
 * and order belong to the tile.
 */
@Composable
fun ManuelleKachel(
    bildUrl: String?,
    onBildFehler: () -> Unit,
    imageLoader: ImageLoader,
    name: String,
    menge: Int,
    states: List<Zustand>,
    zustand: Zustand?,
    besitzer: List<AccountView>,
    preis: Geld?,
    waehrung: Waehrung,
    onEdit: () -> Unit,
    farbe: Color? = null,
    farbname: String? = null,
) {
    val ctx = LocalContext.current
    Card(
        onClick = onEdit,  // whole card clickable — opens the purchase-price/quantity dialog, like sets
        modifier = Modifier.width(Formen.kachelBreite).heightIn(min = Formen.kachelHoehe),
        shape = Formen.leiste,
        elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column {
            Box(Modifier.fillMaxWidth().height(76.dp)) {
                ProduktBild(
                    model = bildUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(!movementReduced()).build() },
                    imageLoader = imageLoader,
                    // Without a description: the name sits below it, TalkBack would otherwise read it twice.
                    contentDescription = null,
                    onState = { st ->
                        if (st is coil3.compose.AsyncImagePainter.State.Error) onBildFehler()
                    },
                    modifier = Modifier.fillMaxSize().clip(Formen.kachelBildEcken),
                    contentScale = ContentScale.Fit,
                    fallbackSize = 28.dp,
                )
                Surface(
                    color = MaterialTheme.colorScheme.primary,
                    shape = Formen.marke,
                    modifier = Modifier.align(Alignment.TopEnd).padding(3.dp),
                ) {
                    // The quantity badge: „×N" on a MANUALLY captured tile,
                    // „N×" on a tile from a set. That's not a whim,
                    // but the web app's rule — there, `man-tile` carries a
                    // `qbadge` with ×N, `part-card` a `part-qty` with N×.
                    Text(mengeManuell(menge), Modifier.padding(horizontal = Abstaende.tiny, vertical = 1.dp).readAloudAs(stueckzahl(menge)),
                        color = MaterialTheme.colorScheme.onPrimary,
                        style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                }
                if (farbe != null) {
                    Box(Modifier.size(12.dp).align(Alignment.BottomStart).padding(3.dp)
                        .clip(CircleShape).background(farbe))
                }
                Row(Modifier.align(Alignment.TopStart).padding(Abstaende.hairline)) {
                    MitTooltip(stringResource(R.string.common_edit)) {
                        IconButton(onClick = onEdit) {
                            Icon(Icons.Default.Edit, stringResource(R.string.common_edit),
                                Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
                // No trash icon on the tile: the card opens the detail, and it sits there
                // in the same spot as for the set.
            }
            Column(Modifier.padding(horizontal = 6.dp, vertical = Abstaende.tiny)) {
                Text(name, style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (farbname != null) {
                    Text(farbname, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Box(Modifier.padding(top = 3.dp)) { ConditionBadges(states, zustand) }
                // Who owns the entry? The server only attaches owners when
                // several accounts are in the Blickfeld — in a single account, „gehört mir" would sit on
                // every single tile.
                OwnerBadges(besitzer, Modifier.padding(top = Abstaende.hairline))
                ManualTileFooter(preis = preis, waehrung = waehrung)
            }
        }
    }
}
