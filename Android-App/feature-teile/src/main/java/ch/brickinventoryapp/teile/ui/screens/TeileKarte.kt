package ch.brickinventoryapp.teile.ui.screens

import ch.brickinventoryapp.model.fach.Waehrung
import androidx.compose.material3.Button
import ch.brickinventoryapp.ui.components.fokusRahmen
import ch.brickinventoryapp.ui.theme.farbeAusHex
import ch.brickinventoryapp.model.ui.model.ManuellesTeilAnsicht
import ch.brickinventoryapp.model.ui.model.TeilAnsicht
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ressourcen.R
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ui.util.rememberTileImageWithFallback
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.stueckzahl
import ch.brickinventoryapp.ui.components.vorgelesenAls
import ch.brickinventoryapp.ui.components.Abschnittstitel
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.bewegungReduziert
import ch.brickinventoryapp.ui.components.farbUebersetzer
import ch.brickinventoryapp.ui.components.grosseSchrift
import ch.brickinventoryapp.ui.components.katalogName
import ch.brickinventoryapp.ui.components.kategorieUebersetzer
import ch.brickinventoryapp.gemeinsam.ui.ErsatzteilPlakette
import ch.brickinventoryapp.gemeinsam.ui.ManuelleKachel
import ch.brickinventoryapp.gemeinsam.ui.TabellenZeile
import ch.brickinventoryapp.gemeinsam.ui.mengeAusSet

@Composable
internal fun ManualPartTile(part: ManuellesTeilAnsicht, serverUrl: String, imageLoader: ImageLoader,
                   waehrung: Waehrung, onEdit: () -> Unit) {
    val farbe = remember(part.colorHex) {
        farbeAusHex(part.colorHex)
    }
    // Auf Nutzerwunsch läuft auch die volle Auflösung (Rückfall) über
    // den Server-Proxy, nicht direkt zum CDN — anders als bei Sets/Katalog.
    val (bild, onBildFehler) =
        rememberTileImageWithFallback(serverUrl, part.imageLocal, part.imageUrl, fullViaProxy = true)
    // Gemeinsame Kachel mit den Minifiguren — siehe ManuelleKachel.
    ManuelleKachel(
        bildUrl = bild,
        onBildFehler = onBildFehler,
        imageLoader = imageLoader,
        name = part.partName ?: part.partNumber,
        menge = part.quantity,
        zustaende = part.conditions,
        zustand = part.condition,
        besitzer = part.owners,
        preis = part.avgPurchasePrice ?: part.unitPrice ?: part.purchasePrice,
        waehrung = waehrung,
        onEdit = onEdit,
        farbe = farbe,
        farbname = part.colorName?.let { farbUebersetzer()(it) },
    )
}

/** Bildfläche der Teilekachel: wächst mit der Kachel, auf dem Telefon wie bisher rund 90 dp hoch. */
private const val TEIL_BILD_VERHAELTNIS = 4f / 3f

@Composable
fun PartCard(part: TeilAnsicht, serverUrl: String, imageLoader: ImageLoader,
             onClick: (() -> Unit)? = null, ausgewaehlt: Boolean = false) {
    val ctx = LocalContext.current
    val qty = part.totalQuantity.takeIf { it > 0 } ?: 1
    val colorObj = remember(part.colorHex) {
        farbeAusHex(part.colorHex)
    }
    // Auf Nutzerwunsch läuft auch die volle Auflösung (Rückfall) über
    // den Server-Proxy, nicht direkt zum CDN — anders als bei Sets/Katalog.
    val (imageUrl, onImageError) = rememberTileImageWithFallback(serverUrl, part.imageLocal, part.imageUrl, fullViaProxy = true)
    // Ab grosser Schrift eine Listenzeile wie die Sets: Das Bild über die volle Breite
    // liess ein Teil je Bildschirm. Die Menge rückt dann vom Bild in den Text.
    val zeile = grosseSchrift()
    val weich = !bewegungReduziert()
    val menge: @Composable () -> Unit = {
        Surface(color = MaterialTheme.colorScheme.primary, shape = Formen.marke) {
            Text(mengeAusSet(qty), Modifier.padding(horizontal = Abstaende.winzig, vertical = 1.dp)
                .vorgelesenAls(stueckzahl(qty)),
                color = MaterialTheme.colorScheme.onPrimary,
                style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
        }
    }

    // Mit der Kachel wachsend statt fest 90 dp: Auf dem Tablet stand sonst ein kleines
    // Bild über einer breiten Kachel.
    val bildflaeche: @Composable (Modifier) -> Unit = { flaeche ->
        Box(flaeche) {
            ProduktBild(
                model = imageUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(weich).build() },
                imageLoader = imageLoader,
                // Ohne Beschreibung: Der Name steht darunter, TalkBack las ihn sonst zweimal.
                contentDescription = null,
                onState = { st ->
                    if (st is coil3.compose.AsyncImagePainter.State.Error) onImageError()
                },
                modifier = Modifier.fillMaxSize()
                    .clip(Formen.kachelBildEcken),
                contentScale = ContentScale.Fit,
                ersatzGroesse = 32.dp,
                // Der Bildgrund über die ganze Kachelbreite wie bei den Sets: Ein schmales
                // Bild stand sonst als Kasten mit weissen Rändern in der Karte.
                bildgrund = true,
                innenAbstand = Abstaende.winzig,
            )
            if (!zeile) Box(Modifier.align(Alignment.TopEnd).padding(Abstaende.winzig)) { menge() }
            // Color dot
            if (colorObj != null) {
                Box(
                    Modifier.size(14.dp).align(Alignment.BottomStart).padding(3.dp)
                        .clip(CircleShape).background(colorObj)
                )
            }
        }
    }

    val texte: @Composable (Modifier) -> Unit = { spalte ->
        Column(spalte.padding(horizontal = 7.dp, vertical = 5.dp), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            if (zeile) menge()
            val nummer = part.blPartNumber ?: part.partNumber
            Text(nummer, Modifier.vorgelesenAls(stringResource(R.string.cd_teil_nummer, nummer)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.SemiBold)
            Text(part.partName?.let { katalogName(it) }
                    ?: androidx.compose.ui.text.AnnotatedString(stringResource(R.string.name_unknown)),
                style = MaterialTheme.typography.bodySmall,
                color = if (part.partName == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                // Im Raster immer zwei Zeilen Platz: Kacheln einer Reihe sind gleich hoch,
                // auch wenn ein Name kurz ist. Die Zeile muss niemandem gleichen.
                minLines = if (zeile) 1 else 2,
                maxLines = if (zeile) 4 else 2, overflow = TextOverflow.Ellipsis)
            part.colorName?.let {
                Text(farbUebersetzer()(it), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
            // Ersatzteil — Sets enthalten ein Tuetchen davon. Nur wenn es
            // eines IST: eine Plakette „kein Ersatzteil" an jeder Kachel
            // waere Rauschen.
            if (part.isSpare) ErsatzteilPlakette(Modifier.padding(top = Abstaende.haar))
        }
    }

    Card(
        // Antippen öffnet den Detail-Dialog, wie bei manuell erfassten Teilen.
        modifier = Modifier.fillMaxWidth().heightIn(min = if (zeile) 0.dp else 164.dp)
            .semantics { selected = ausgewaehlt }
            .then(if (ausgewaehlt) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, Formen.leiste) else Modifier)
            .let { if (onClick != null) it.fokusRahmen(Formen.leiste).clickable(role = Role.Button, onClick = onClick) else it },
        shape = Formen.leiste,
        elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        if (zeile) Row(verticalAlignment = Alignment.Top) {
            bildflaeche(Modifier.width(ZEILE_BILD_BREITE).aspectRatio(TEIL_BILD_VERHAELTNIS))
            texte(Modifier.weight(1f))
        } else Column {
            bildflaeche(Modifier.fillMaxWidth().aspectRatio(TEIL_BILD_VERHAELTNIS))
            texte(Modifier)
        }
    }
}

/** Breite des Vorschaubilds, wenn die Kachel bei grosser Schrift eine Listenzeile ist. */
private val ZEILE_BILD_BREITE = 96.dp

/** Sektions-Überschrift innerhalb der Grids (Manuell erfasst / Aus Sets). */
@Composable
internal fun SectionHeader(text: String) {
    Abschnittstitel(text,
        Modifier.padding(horizontal = Abstaende.haar, vertical = Abstaende.winzig))
}

/**
 * Ein Teil als Tabellenzeile.
 * Kategorie und Sets stehen als zweite Zeile darunter, weil sieben Spalten wie in der Webapp auf
 * kein Telefon passen.
 */
@Composable
internal fun PartTableRow(part: TeilAnsicht, serverUrl: String, imageLoader: ImageLoader,
                 onClick: (() -> Unit)? = null) {
    val farbe = remember(part.colorHex) {
        farbeAusHex(part.colorHex)
    }
    val (bildUrl, onFehler) = rememberTileImageWithFallback(
        serverUrl, part.imageLocal, part.imageUrl, fullViaProxy = true)
    // Kategorie und Sets in einer Zeile, mit „·" getrennt — und nur, was da
    // ist. Ein leeres „ · " sieht nach einem fehlenden Wert aus.
    val ersatzteil = stringResource(R.string.parts_spare_tag)
    val kategorie = kategorieUebersetzer()
    val zweite = listOfNotNull(
        part.categoryName?.takeIf { it.isNotBlank() }?.let(kategorie),
        part.inSets?.takeIf { it.isNotBlank() }?.replace(",", ", "),
        // In der Tabellenzeile als Wort statt als Plakette: Die Zeile ist auf
        // Dichte gebaut, eine Flaeche mit eigenem Hintergrund saehe darin aus
        // wie ein Knopf.
        ersatzteil.takeIf { part.isSpare },
    ).joinToString(" · ").ifBlank { null }

    TabellenZeile(
        bildUrl = bildUrl,
        nummer = part.blPartNumber ?: part.partNumber,
        name = part.partName,
        menge = part.totalQuantity.takeIf { it > 0 } ?: 1,
        imageLoader = imageLoader,
        farbe = farbe,
        zweiteZeile = zweite,
        onBildFehler = onFehler,
        onClick = onClick,
    )
}
