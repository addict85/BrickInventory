package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.request.ImageRequest
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
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top
        ) {
            Text(
                stringResource(R.string.detail_purchase_price),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp)
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
                                    fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            }
                        }
                    }
                }
                Spacer(Modifier.height(4.dp))
                OutlinedButton(onClick = onEditPrices,
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 2.dp),
                    modifier = Modifier.height(28.dp)) {
                    Text("✏️ ${stringResource(R.string.detail_edit_prices)}", fontSize = 12.sp)
                }
            }
        }
        HorizontalDivider()
    }
}

// ── Condition badge (shared by sets, parts, figs) ────────────────────────────

/**
 * Eine Plakette JE erfasstem Zustand.
 *
 * `condition` ist ein Aggregat und kennt nur einen Wert („gebraucht, sobald
 * eine Erfassung gebraucht ist"). Wer ein Exemplar neu und eines gebraucht
 * gekauft hat, sah damit nur „Gebraucht" — obwohl die Neu-Erfassung mit ihrem
 * eigenen Preis in die Bewertung eingeht.
 *
 * Welche Plaketten es gibt, entscheidet der Server (`conditions`); hier wird
 * nichts abgeleitet. Ältere Antworten ohne das Feld fallen auf `condition`
 * zurück — dann sieht es aus wie bisher.
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
 * Ersatzteil-Plakette — dieselbe Form wie [ConditionBadge] daneben.
 *
 * Sets enthalten ein Tuetchen Ersatzteile; Rebrickable kennzeichnet sie. Der
 * Text dafuer lag in beiden Sprachen bereit und in der App gab es sogar einen
 * Helfer, der das Kennzeichen deutete — gezeichnet hat die Plakette nie
 * jemand. Der Grund stand im Feld selbst: `is_spare` kam in vier
 * verschiedenen Schreibweisen an. Seit der Server sie an einer Stelle liest
 * (istErsatzteil() in utils/validate.ts), ist es ein Wahrheitswert.
 *
 * Zurueckhaltender als die Zustands-Plakette: Ein Ersatzteil ist eine
 * Nebeninformation, kein Zustand — deshalb der ruhige Flaechenton statt der
 * Signalfarbe.
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
 * Der Fuss einer Kachel fuer einen MANUELL erfassten Eintrag: Preis und Notiz.
 *
 * ── Warum es das jetzt gibt (Nachtrag 134) ──────────────────────────────────
 *
 * Die Webapp zeigt auf ihrer `man-tile` unter den Plaketten zwei weitere
 * Zeilen (06-minifigs.js Zeilen 328-330 fuer Figuren, 486-488 fuer Teile):
 *
 *     <div style="font-weight:700;…">${priceStr}</div>
 *     ${p.note ? `<div class="man-tile-note">${esc(p.note)}</div>` : ''}
 *
 * Die App zeigte beides nicht. Bei der NOTIZ ist das mehr als eine fehlende
 * Zeile: Der Erfassungsdialog fragt sie ab (`parts_note`, `minifigs_note`),
 * schickt sie an den Server — und danach war sie in der ganzen App nirgends
 * mehr zu sehen, weder auf der Kachel noch im Detail. Eine Eingabe, die
 * nirgends wieder auftaucht, sieht aus, als waere sie verlorengegangen.
 *
 * ── Welcher Preis ───────────────────────────────────────────────────────────
 *
 * Dieselbe Reihenfolge wie in der Webapp:
 *
 *     avg_purchase_price ?? unit_price ?? purchase_price
 *
 * Der erste ist der mengengewichtete Kaufpreis ueber alle Erfassungen; der
 * zweite ist nur der ZULETZT geschriebene Einzelpreis. Wer ein Teil einmal
 * fuer 2.- und einmal fuer 8.- gekauft hat, saehe sonst 8.- statt 5.-.
 *
 * @param preis    Roher Betrag; null = keiner hinterlegt, dann steht „—" da.
 * @param waehrung Waehrungscode aus den Einstellungen.
 * @param notiz    Notiz des Eintrags, oder null/leer.
 */
@Composable
fun ManuelleKachelFuss(preis: Double?, waehrung: String, notiz: String?) {
    Text(
        if (preis != null) fmtMoney(preis, waehrung) else "—",
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.primary,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.padding(top = 2.dp),
    )
    if (!notiz.isNullOrBlank()) {
        Text(
            notiz,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * Anzahl, Kaufpreis, Notiz und Zustand — die vier Angaben, die JEDE manuelle
 * Erfassung hat, ob Teil oder Minifigur.
 *
 * ── Warum das zusammengezogen ist ───────────────────────────────────────────
 *
 * NACHGEMESSEN: Der Block stand zeichengleich in AddPartDialog (PartsDialogs.kt)
 * und AddMinifigDialog (MinifigsScreen.kt) — vier Felder, dieselben Formen,
 * dieselben Tastaturen, und darunter dieselbe Zustandszeile. Nur die Namen der
 * Textressourcen waren verschieden, und deren INHALT war in beiden Sprachen
 * wortgleich. Zwei Dialoge, die dasselbe erfassen und gleich aussehen sollen,
 * sind der Fall, für den es diese Datei gibt.
 *
 * Der Zustand bleibt bei den Aufrufern: Dort steht er in `rememberSaveable` und
 * übersteht damit eine Drehung. Hierher gereicht wird nur, was angezeigt wird —
 * eine Textfeld-Gruppe, die ihre Werte selbst hielte, wäre in einem Dialog
 * genau einmal richtig und beim nächsten Aufruf falsch vorbelegt.
 *
 * Was NICHT hierher kommt, ist die jeweilige Nummer: Ein Teil hat Nummer und
 * Farbe, eine Figur ihre Rebrickable- und ihre BrickLink-Nummer. Das ist der
 * echte Unterschied zwischen den beiden Dialogen, und er soll sichtbar bleiben.
 */
@Composable
fun ErfassungsFelder(
    anzahl: String,
    onAnzahl: (String) -> Unit,
    preis: String,
    onPreis: (String) -> Unit,
    notiz: String,
    onNotiz: (String) -> Unit,
    zustand: String,
    onZustand: (String) -> Unit,
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
    OutlinedTextField(
        value = notiz, onValueChange = onNotiz,
        label = { Text(stringResource(R.string.common_note)) },
        modifier = Modifier.fillMaxWidth(), singleLine = true,
        shape = Formen.knopf,
    )
    Zustandszeile(zustand = zustand, onZustand = onZustand)
}

/**
 * Die Kachel eines MANUELL erfassten Teils oder einer manuell erfassten
 * Minifigur.
 *
 * ── Warum eine gemeinsame Fassung ───────────────────────────────────────────
 *
 * NACHGEMESSEN standen ManualPartTile (PartsScreen.kt) und ManualFigTile
 * (MinifigsScreen.kt) mit drei sich ueberlappenden Achtzeilern in der
 * Doppelungsmessung — Rahmen, Bildkasten, Mengen-Plakette, beide Knoepfe und
 * der Fuss waren zeichengleich. Was die Doppelung kostet, steht schon in
 * ManualFigTile: Der Figuren-Kachel fehlten Zustands- und Besitzer-Plaketten
 * MONATELANG, weil sie nur in der Teile-Kachel nachgezogen wurden. Gefunden
 * wurde das nicht durch Lesen, sondern durch den Vergleich der beiden Dateien.
 *
 * Eine gemeinsame Kachel macht diesen Fehler unmoeglich: Was hier steht, steht
 * fuer beide.
 *
 * ── Was Parameter ist und was nicht ─────────────────────────────────────────
 *
 * Verschieden sind nur vier Dinge, und die kommen herein: das Ersatzbild (Stein
 * bzw. Figur), der Farbpunkt und die Farbzeile (beides gibt es nur bei Teilen)
 * und die Bezeichnung. Alles andere — Groesse, Form, Erhebung, die Stellen der
 * Plaketten, die Reihenfolge Name/Farbe/Zustand/Besitzer/Preis — gehoert zur
 * Kachel und nicht zum Aufrufer.
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
    besitzer: List<ch.brickinventoryapp.data.model.HouseholdMember>,
    preis: Double?,
    waehrung: String,
    notiz: String?,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    farbe: Color? = null,
    farbname: String? = null,
    platzhalter: @Composable () -> Unit,
) {
    val ctx = LocalContext.current
    Card(
        onClick = onEdit,  // ganze Karte klickbar — öffnet den Kaufpreis/Anzahl-Dialog, analog Sets
        modifier = Modifier.width(Formen.kachelBreite).height(Formen.kachelHoehe),
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
                            if (st is coil.compose.AsyncImagePainter.State.Error) onBildFehler()
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
                    Text("×$menge", Modifier.padding(horizontal = 4.dp, vertical = 1.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                        style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                }
                if (farbe != null) {
                    Box(Modifier.size(12.dp).align(Alignment.BottomStart).padding(3.dp)
                        .clip(CircleShape).background(farbe))
                }
                Row(Modifier.align(Alignment.TopStart).padding(2.dp)) {
                    IconButton(onClick = onEdit, modifier = Modifier.size(24.dp)) {
                        Icon(Icons.Default.Edit, stringResource(R.string.common_edit),
                            Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
                    }
                }
                IconButton(onClick = onDelete,
                    modifier = Modifier.align(Alignment.BottomEnd).size(24.dp)) {
                    Icon(Icons.Default.Delete, stringResource(R.string.common_delete),
                        Modifier.size(14.dp), tint = MaterialTheme.colorScheme.error)
                }
            }
            Column(Modifier.padding(horizontal = 6.dp, vertical = 4.dp)) {
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
                OwnerBadges(besitzer, Modifier.padding(top = 2.dp))
                ManuelleKachelFuss(preis = preis, waehrung = waehrung, notiz = notiz)
            }
        }
    }
}
