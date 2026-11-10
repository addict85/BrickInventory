package ch.brickinventoryapp.gemeinsam.ui

import ch.brickinventoryapp.model.fach.Zustand
import androidx.compose.ui.graphics.luminance
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.model.ui.model.KaufAnsicht
import ch.brickinventoryapp.model.ui.model.KontoAnsicht
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.BrickSage
import ch.brickinventoryapp.ui.theme.BrickSageText
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.stueckzahl
import ch.brickinventoryapp.ui.components.vorgelesenAls
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.ansagen
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.bewegungReduziert
import ch.brickinventoryapp.ui.components.grosseSchrift
import ch.brickinventoryapp.ui.components.mitSchrift

/**
 * Gemeinsame Composables für manuell erfasste Teile UND Minifiguren.
 * Beide Typen haben identische Acquisition-Logik — kein Code-Duplikat.
 */

// ── Compact read-only acquisition summary (wie im Set-Detail) ─────────────────

@Composable
fun AcquisitionSummarySection(
    acquisitions: List<KaufAnsicht>,
    currency: String,
    onEditPrices: () -> Unit
) {
    // Bei grosser Schrift die Käufe UNTER die Bezeichnung: Neben ihr blieb für
    // „CHF 700.00“ so wenig Breite, dass der Betrag Ziffer für Ziffer umbrach.
    val untereinander = grosseSchrift()
    val ausrichtung = if (untereinander) Alignment.Start else Alignment.End
    val kaeufe: @Composable () -> Unit = {
        Column(horizontalAlignment = ausrichtung) {
            if (acquisitions.isEmpty()) {
                Text(stringResource(R.string.detail_purchase_none), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                acquisitions.forEach { acq -> KaufZeile(acq, currency) }
            }
            Spacer(Modifier.height(Abstaende.winzig))
            OutlinedButton(onClick = onEditPrices,
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = Abstaende.haar),
                modifier = Modifier.heightIn(min = 28.dp),
                colors = nebenKnopfFarben(),
                border = nebenKnopfRand()) {
                Icon(Icons.Default.Edit, null, Modifier.size(mitSchrift(14.dp)))
                Spacer(Modifier.width(Abstaende.winzig))
                Text(stringResource(R.string.detail_edit_prices), style = MaterialTheme.typography.labelMedium)
            }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
        val bezeichnung: @Composable () -> Unit = {
            Text(
                stringResource(R.string.detail_purchase_price),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = Abstaende.haar)
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
 * Ein Kauf: Menge, Zustand, Betrag. FlowRow, damit der Betrag bei wenig Platz als
 * Ganzes in die nächste Zeile rückt; er selbst bricht nie um.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun KaufZeile(acq: KaufAnsicht, currency: String) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        val mitte = Modifier.align(Alignment.CenterVertically)
        Text(mengeManuell(acq.quantity), mitte.vorgelesenAls(stueckzahl(acq.quantity)),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Box(mitte) { ConditionBadge(acq.condition) }
        // Ohne Betrag sagt die Zeile, dass keiner erfasst ist; sonst stand „×2 Neu“ allein da.
        val preis = acq.effectivePrice
        if (preis != null) {
            Text(fmtMoney(preis, currency), fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium,
                maxLines = 1, softWrap = false, modifier = mitte)
        } else {
            Text(stringResource(R.string.detail_purchase_none), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = mitte)
        }
    }
}

// ── Condition badge (shared by sets, parts, figs) ────────────────────────────

/**
 * Eine Plakette je erfasstem Zustand. `condition` ist ein Aggregat mit einem Wert
 * und verschwiege die Neu-Erfassung neben einer gebrauchten. Welche es gibt,
 * entscheidet der Server (`conditions`); ältere Antworten ohne das Feld fallen auf
 * `condition` zurück.
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
    // Salbei nur im hellen Stein-Design: Im Dunkeln leuchtete die helle Pille auf der dunklen Karte.
    val isBrick = LocalIsBrickTheme.current && MaterialTheme.colorScheme.surface.luminance() > 0.5f
    val bgColor = when {
        isUsed  -> MaterialTheme.colorScheme.secondaryContainer
        isBrick -> BrickSage
        else    -> MaterialTheme.colorScheme.primaryContainer
    }
    val fgColor = when {
        isUsed  -> MaterialTheme.colorScheme.onSecondaryContainer
        isBrick -> BrickSageText
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
 * Ersatzteil-Plakette in der Form von [ConditionBadge], aber im ruhigen
 * Flächenton: Ein Ersatzteil ist eine Nebeninformation, kein Zustand.
 */
@Composable
fun ErsatzteilPlakette(modifier: Modifier = Modifier) {
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
 * Eine Auskunft in Chipform, nicht antippbar: Ein AssistChip mit leerem
 * onClick sah aus wie ein Knopf, wurde als Knopf vorgelesen und tat nichts.
 */
@Composable
fun InfoPlakette(text: String, modifier: Modifier = Modifier, icon: androidx.compose.ui.graphics.vector.ImageVector? = null) {
    Surface(shape = Formen.chip, color = MaterialTheme.colorScheme.secondaryContainer,
            contentColor = MaterialTheme.colorScheme.onSecondaryContainer, modifier = modifier) {
        Row(Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (icon != null) Icon(icon, null, Modifier.size(mitSchrift(16.dp)))
            Text(text, style = MaterialTheme.typography.labelMedium)
        }
    }
}

// Hier stehen nur Bausteine, die Set-Detail und ManualItemDetailScreen beide benutzen
// (AcquisitionSummarySection, ConditionBadge(s), Kaufpreis-Editor), damit beide Seiten
// Kaufpreise gleich zeigen.

/**
 * Der Fuss einer Kachel für einen manuell erfassten Eintrag: der Preis, wie auf
 * der `man-tile` der Webapp und in derselben Reihenfolge:
 *
 *   avg_purchase_price ?? unit_price ?? purchase_price
 *
 * Der erste ist mengengewichtet über alle Erfassungen; der zweite nur der zuletzt
 * geschriebene Einzelpreis.
 *
 * @param preis    roher Betrag; null = keiner hinterlegt, dann steht „—“ da
 * @param waehrung Währungscode aus den Einstellungen
 */
@Composable
fun ManuelleKachelFuss(preis: Double?, waehrung: String) {
    Text(
        if (preis != null) fmtMoney(preis, waehrung) else "—",
        style = MaterialTheme.typography.bodySmall,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.primary,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.padding(top = Abstaende.haar),
    )
}

/**
 * Anzahl, Kaufpreis und Zustand — was jede manuelle Erfassung hat, ob Teil oder
 * Figur; eine Fassung, damit beide Dialoge gleich aussehen. Der Zustand bleibt
 * beim Aufrufer in `rememberSaveable`, damit er eine Drehung übersteht. Die Nummer
 * bleibt draussen: Sie ist der echte Unterschied der beiden Dialoge.
 */
@Composable
fun ErfassungsFelder(
    anzahl: String,
    onAnzahl: (String) -> Unit,
    preis: String,
    onPreis: (String) -> Unit,
    zustand: Zustand,
    onZustand: (Zustand) -> Unit,
    /**
     * Lagerort und sein Vorrat — hier, weil er zum selben Block gehört wie die übrigen
     * Erfassungsfelder.
     */
    lagerort: String = "",
    onLagerort: (String) -> Unit = {},
    lagerorte: List<String> = emptyList(),
) {
    OutlinedTextField(
        value = anzahl, onValueChange = { onAnzahl(NumericInput.quantity(it)) },
        label = { Text(stringResource(R.string.common_quantity)) },
        isError = NumericInput.mengeUngueltig(anzahl),
        supportingText = { if (NumericInput.mengeUngueltig(anzahl)) Text(stringResource(R.string.erfassen_menge_ungueltig), Modifier.ansagen()) },
        modifier = Modifier.fillMaxWidth(), singleLine = true,
        shape = Formen.feld,
        keyboardOptions = NumericInput.ganzzahlTastatur(),
    )
    OutlinedTextField(
        value = preis, onValueChange = { onPreis(NumericInput.price(it)) },
        label = { Text(stringResource(R.string.common_unit_price)) },
        placeholder = { Text(stringResource(R.string.common_unit_price_placeholder)) },
        isError = NumericInput.preisUngueltig(preis),
        supportingText = { if (NumericInput.preisUngueltig(preis)) Text(stringResource(R.string.erfassen_preis_ungueltig), Modifier.ansagen()) },
        modifier = Modifier.fillMaxWidth(), singleLine = true,
        shape = Formen.feld,
        keyboardOptions = NumericInput.preisTastatur(),
    )
    Zustandszeile(zustand = zustand, onZustand = onZustand)
    LagerortErfassung(lagerort, lagerorte, onLagerort)
}

/**
 * Die Kachel eines manuell erfassten Teils oder einer Figur — eine Fassung, damit
 * Plaketten und Fuss nicht nur in einer nachgezogen werden. Hinein kommen nur die
 * drei Unterschiede (Farbpunkt, Farbzeile, Bezeichnung); Grösse, Form, Ersatzbild
 * und Reihenfolge gehören zur Kachel.
 */
@Composable
fun ManuelleKachel(
    bildUrl: String?,
    onBildFehler: () -> Unit,
    imageLoader: ImageLoader,
    name: String,
    menge: Int,
    zustaende: List<Zustand>,
    zustand: Zustand?,
    besitzer: List<KontoAnsicht>,
    preis: Double?,
    waehrung: String,
    onEdit: () -> Unit,
    farbe: Color? = null,
    farbname: String? = null,
) {
    val ctx = LocalContext.current
    Card(
        onClick = onEdit,  // ganze Karte klickbar — öffnet den Kaufpreis/Anzahl-Dialog, analog Sets
        modifier = Modifier.width(Formen.kachelBreite).heightIn(min = Formen.kachelHoehe),
        shape = Formen.leiste,
        elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column {
            Box(Modifier.fillMaxWidth().height(76.dp)) {
                ProduktBild(
                    model = bildUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(!bewegungReduziert()).build() },
                    imageLoader = imageLoader,
                    // Ohne Beschreibung: Der Name steht darunter, TalkBack las ihn sonst zweimal.
                    contentDescription = null,
                    onState = { st ->
                        if (st is coil3.compose.AsyncImagePainter.State.Error) onBildFehler()
                    },
                    modifier = Modifier.fillMaxSize().clip(Formen.kachelBildEcken),
                    contentScale = ContentScale.Fit,
                    ersatzGroesse = 28.dp,
                )
                Surface(
                    color = MaterialTheme.colorScheme.primary,
                    shape = Formen.marke,
                    modifier = Modifier.align(Alignment.TopEnd).padding(3.dp),
                ) {
                    // Die Menge-Plakette: „×N" auf einer MANUELL erfassten Kachel,
                    // „N×" auf einer Kachel aus einem Set. Das ist keine Laune,
                    // sondern die Regel der Webapp — `man-tile` traegt dort ein
                    // `qbadge` mit ×N, `part-card` ein `part-qty` mit N×.
                    Text(mengeManuell(menge), Modifier.padding(horizontal = Abstaende.winzig, vertical = 1.dp).vorgelesenAls(stueckzahl(menge)),
                        color = MaterialTheme.colorScheme.onPrimary,
                        style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                }
                if (farbe != null) {
                    Box(Modifier.size(12.dp).align(Alignment.BottomStart).padding(3.dp)
                        .clip(CircleShape).background(farbe))
                }
                Row(Modifier.align(Alignment.TopStart).padding(Abstaende.haar)) {
                    MitTooltip(stringResource(R.string.common_edit)) {
                        IconButton(onClick = onEdit) {
                            Icon(Icons.Default.Edit, stringResource(R.string.common_edit),
                                Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
                // Kein Papierkorb auf der Kachel: Die Karte öffnet das Detail, und dort steht er
                // an derselben Stelle wie beim Set.
            }
            Column(Modifier.padding(horizontal = 6.dp, vertical = Abstaende.winzig)) {
                Text(name, style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (farbname != null) {
                    Text(farbname, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Box(Modifier.padding(top = 3.dp)) { ConditionBadges(zustaende, zustand) }
                // Wem gehört der Eintrag? Der Server hängt owners nur an, wenn
                // mehrere Konten im Blickfeld sind — im Einzelkonto stünde an
                // jeder Kachel „gehört mir".
                OwnerBadges(besitzer, Modifier.padding(top = Abstaende.haar))
                ManuelleKachelFuss(preis = preis, waehrung = waehrung)
            }
        }
    }
}
