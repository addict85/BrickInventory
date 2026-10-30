package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
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
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.Acquisition
import ch.brickinventoryapp.util.fmtMoney
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.BrickSage
import ch.brickinventoryapp.ui.theme.BrickSageText
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Gemeinsame Composables für manuell erfasste Teile UND Minifiguren.
 * Beide Typen haben identische Acquisition-Logik — kein Code-Duplikat.
 */

// ── Compact read-only acquisition summary (wie im Set-Detail) ─────────────────

@Composable
fun AcquisitionSummarySection(
    acquisitions: List<Acquisition>,
    currency: String,
    onEditPrices: () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top
        ) {
            Text(
                stringResource(R.string.detail_purchase_price),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = Abstaende.haar)
            )
            Column(horizontalAlignment = Alignment.End) {
                if (acquisitions.isEmpty()) {
                    Text("—", style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    acquisitions.forEach { acq ->
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("×${acq.quantity}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            ConditionBadge(acq.condition)
                            if (acq.effectivePrice != null) {
                                Text(fmtMoney(acq.effectivePrice ?: 0.0, currency),
                                    fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                }
                Spacer(Modifier.height(Abstaende.winzig))
                OutlinedButton(onClick = onEditPrices,
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = Abstaende.haar),
                    modifier = Modifier.heightIn(min = 28.dp)) {
                    Icon(Icons.Default.Edit, null, Modifier.size(14.dp))
                    Spacer(Modifier.width(Abstaende.winzig))
                    Text(stringResource(R.string.detail_edit_prices), style = MaterialTheme.typography.labelMedium)
                }
            }
        }
        HorizontalDivider()
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
fun ConditionBadges(conditions: List<String>, fallback: String? = null) {
    val list = if (conditions.isNotEmpty()) conditions else listOf(fallback ?: "N")
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        list.forEach { ConditionBadge(it) }
    }
}

@Composable
fun ConditionBadge(condition: String) {
    val isUsed = condition == "U"
    val isBrick = LocalIsBrickTheme.current
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

// Der frühere ManualItemDetailDialog steht hier nicht mehr: Die Detailansicht
// manueller Teile und Minifiguren ist seit hardened-99 ein ganzer Screen
// (ui/screens/ManualItemDetailScreen.kt), wie bei den Sets. Übrig bleiben hier
// die Bausteine, die BEIDE Seiten benutzen — AcquisitionSummarySection,
// ConditionBadge(s) und der Kaufpreis-Editor.

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
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.primary,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.padding(top = Abstaende.haar),
    )
}

/**
 * Die vier Eingaben, wie der Server sie braucht — eine Umrechnung für beide
 * Dialoge: Eine leere Anzahl heisst eins, das Komma der deutschen Tastatur wird
 * zum Punkt, und ohne Haushalt geht kein Besitzer mit, damit der Server beim
 * eigenen Konto bleibt.
 */
data class ErfassungsWerte(
    val anzahl: Int,
    val preis: Double?,
    val zustand: String,
    val besitzer: Int?,
)

/**
 * @param haushalt Die Konten des Haushalts — bei hoechstens einem geht KEIN
 *                 Besitzer mit.
 */
fun erfassungsWerte(
    anzahl: String,
    preis: String,
    zustand: String,
    besitzer: Int?,
    haushalt: List<ch.brickinventoryapp.data.model.HouseholdMember>,
): ErfassungsWerte = ErfassungsWerte(
    anzahl = anzahl.toIntOrNull() ?: 1,
    preis = preis.replace(',', '.').toDoubleOrNull(),
    zustand = zustand,
    besitzer = if (haushalt.size > 1) besitzer else null,
)

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
    zustand: String,
    onZustand: (String) -> Unit,
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
        modifier = Modifier.fillMaxWidth(), singleLine = true,
        shape = Formen.knopf,
        keyboardOptions = NumericInput.ganzzahlTastatur(),
    )
    OutlinedTextField(
        value = preis, onValueChange = { onPreis(NumericInput.price(it)) },
        label = { Text(stringResource(R.string.common_unit_price)) },
        placeholder = { Text(stringResource(R.string.common_unit_price_placeholder)) },
        modifier = Modifier.fillMaxWidth(), singleLine = true,
        shape = Formen.knopf,
        keyboardOptions = NumericInput.preisTastatur(),
    )
    Zustandszeile(zustand = zustand, onZustand = onZustand)
    LagerortErfassung(lagerort, lagerorte, onLagerort)
}

/**
 * Die Kachel eines manuell erfassten Teils oder einer Figur — eine Fassung, damit
 * Plaketten und Fuss nicht nur in einer nachgezogen werden. Hinein kommen nur die
 * vier Unterschiede (Ersatzbild, Farbpunkt, Farbzeile, Bezeichnung); Grösse, Form
 * und Reihenfolge gehören zur Kachel.
 *
 * @param platzhalter Was im Bildkasten steht, wenn es kein Bild gibt.
 */
@Composable
fun ManuelleKachel(
    bildUrl: String?,
    onBildFehler: () -> Unit,
    imageLoader: ImageLoader,
    name: String,
    menge: Int,
    zustaende: List<String>,
    zustand: String?,
    besitzer: List<ch.brickinventoryapp.data.model.KontoName>,
    preis: Double?,
    waehrung: String,
    onEdit: () -> Unit,
    farbe: Color? = null,
    farbname: String? = null,
    platzhalter: @Composable () -> Unit,
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
                if (bildUrl != null) {
                    AsyncImage(
                        model = ImageRequest.Builder(ctx).data(bildUrl).crossfade(true).build(),
                        imageLoader = imageLoader,
                        contentDescription = name,
                        onState = { st ->
                            if (st is coil3.compose.AsyncImagePainter.State.Error) onBildFehler()
                        },
                        modifier = Modifier.fillMaxSize().clip(Formen.kachelBildEcken),
                        contentScale = ContentScale.Fit,
                    )
                } else {
                    Box(Modifier.fillMaxSize(), Alignment.Center) { platzhalter() }
                }
                Surface(
                    color = MaterialTheme.colorScheme.primary,
                    shape = Formen.marke,
                    modifier = Modifier.align(Alignment.TopEnd).padding(3.dp),
                ) {
                    // Die Menge-Plakette: „×N" auf einer MANUELL erfassten Kachel,
                    // „N×" auf einer Kachel aus einem Set. Das ist keine Laune,
                    // sondern die Regel der Webapp — `man-tile` traegt dort ein
                    // `qbadge` mit ×N, `part-card` ein `part-qty` mit N×.
                    Text(ch.brickinventoryapp.ui.mengeManuell(menge), Modifier.padding(horizontal = Abstaende.winzig, vertical = 1.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                        style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                }
                if (farbe != null) {
                    Box(Modifier.size(12.dp).align(Alignment.BottomStart).padding(3.dp)
                        .clip(CircleShape).background(farbe))
                }
                Row(Modifier.align(Alignment.TopStart).padding(Abstaende.haar)) {
                    IconButton(onClick = onEdit) {
                        Icon(Icons.Default.Edit, stringResource(R.string.common_edit),
                            Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
                    }
                }
                // Kein Papierkorb auf der Kachel: Die Karte öffnet das Detail, und dort steht er
                // an derselben Stelle wie beim Set.
            }
            Column(Modifier.padding(horizontal = 6.dp, vertical = Abstaende.winzig)) {
                Text(name, style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (farbname != null) {
                    Text(farbname, style = MaterialTheme.typography.labelSmall,
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
