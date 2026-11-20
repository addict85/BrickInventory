package ch.brickinventoryapp.katalog.ui.screens

import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.model.fach.KatalogSetAnsicht
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.AppKarte
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.components.TileBalance
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.BrickStudCap
import ch.brickinventoryapp.ui.theme.StudsSeries
import ch.brickinventoryapp.ui.theme.BrickEdgesHistory
import ch.brickinventoryapp.ui.theme.StudsMass
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.LocalIsStudTheme
import ch.brickinventoryapp.ui.theme.LocalIsGloss
import ch.brickinventoryapp.ui.theme.brickTone
import ch.brickinventoryapp.ui.theme.LocalIsColorSlotsTheme
import ch.brickinventoryapp.ui.theme.slotsTone
import ch.brickinventoryapp.ui.util.rememberTileImageWithFallback
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.Color
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.readAloudAs
import ch.brickinventoryapp.ui.util.fmtInt
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.LocalBrickDecor
import ch.brickinventoryapp.ui.theme.lightStrip

@Composable
fun CatalogSetCard(
    set: KatalogSetAnsicht,
    imageLoader: ImageLoader,
    serverUrl: String,
    onClick: (String) -> Unit,
    /** Position in der Kachelwand — nur fuer die Deckelfarbe des Designs "noppe". */
    position: Int = 0
) {
    val ctx = LocalContext.current
    val isBrick = LocalIsBrickTheme.current
    val isStud = LocalIsStudTheme.current
    val isGloss = LocalIsGloss.current
    // Der Thementon des Designs "farbfaecher" — dieselbe Rechnung wie
    // --faecher-ton in js/katalog.js. Ohne Thema-Nummer gibt es keinen
    // Streifen, statt eines falschen.
    val tone = if (LocalIsColorSlotsTheme.current) slotsTone(set.themeId) else null
    val ownership = set.ownedQuantity.coerceAtLeast(1)
    val ownershipAnnouncement = if (set.owned) pluralStringResource(R.plurals.cd_in_sammlung, ownership, ownership) else null
    // Die Noppen stehen über der Karte: Eine Material-Card klippt auf ihre Form.
    // Deshalb rückt die Karte um die Noppenhöhe nach unten, und die Reihe wird daneben
    // gezeichnet und darübergelegt — wie `top:-6px` im CSS.
    Box {
        AppKarte(
            modifier = Modifier.then(if (isBrick) Modifier.padding(top = StudsMass.Stein.hoehe) else Modifier),
            onClick = { onClick(set.setNumber) },
            onClickLabel = stringResource(R.string.cd_details_oeffnen),
        ) {
            Column {
                // Die Steinkante und der Steindeckel wie in der Galerie (SetCard).
                if (isBrick) BoxWithConstraints {
                    BrickStudCap(mass = StudsMass.Stein, verlauf = BrickEdgesHistory,
                        height = if (maxWidth < 240.dp) 12.dp else null)
                }
                if (isStud) BrickStudCap(color = brickTone(position), gloss = isGloss)
                if (tone != null) {
                    Box(Modifier.fillMaxWidth().height(5.dp).background(tone))
                }
                // 4:3 wie die Kacheln der Galerie: Eine feste Höhe liess das Bild auf dem
                // Tablet schmal in der Kachel stehen.
                Box(Modifier.fillMaxWidth().aspectRatio(CATALOG_IMAGE_RATIO)) {
                    // Über den Server auflösen statt roher CDN-Adresse; scheitert die Vorschau,
                    // Rückfall auf die volle Auflösung vor dem Platzhalter.
                    val (thumbUrl, onThumbError) = rememberTileImageWithFallback(serverUrl, set.imageLocal, set.imageUrl)
                    ProduktBild(
                        model = thumbUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(!movementReduced()).build() },
                        imageLoader = imageLoader,
                        // Ohne Beschreibung: Der Name steht darunter, TalkBack las ihn sonst zweimal.
                        contentDescription = null,
                        onState = { if (it is coil3.compose.AsyncImagePainter.State.Error) onThumbError() },
                        modifier = Modifier.fillMaxSize()
                            .then(if (isBrick) Modifier else Modifier.clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp))),
                        contentScale = ContentScale.Fit,
                        fallbackSize = 44.dp,
                        bildgrund = true,
                        innerGap = Abstaende.klein,
                    )
                    // Die Spiegelung auf der Glasscheibe, nur über dem Bild (LightStrip in BrickDecor.kt).
                    if (isGloss) Box(Modifier.matchParentSize().background(lightStrip()))
                    // Eine Pille innerhalb des Bilds wie die Mengenplakette der Galerie; vorgelesen am Ende.
                    if (set.owned) {
                        Surface(
                            color = MaterialTheme.colorScheme.primary,
                            shape = Formen.etikett,
                            modifier = Modifier.align(Alignment.TopEnd).padding(CATALOG_BADGE_EDGE).clearAndSetSemantics {}
                        ) {
                            Text(
                                if (set.ownedQuantity > 1) "✓ ×${set.ownedQuantity}" else "✓",
                                color = MaterialTheme.colorScheme.onPrimary,
                                style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = Abstaende.hairline),
                            )
                        }
                    }
                }
                // Der Name zuerst, wie er vorgelesen wird; Nummer, Jahr und Teile darunter.
                // Ein kurzer Name lässt keine Lücke; die Zeile fehlt am Fuss (TileBalance).
                var namedRows by remember { mutableIntStateOf(2) }
                Box {
                    Column(Modifier.padding(horizontal = Abstaende.mittel, vertical = Abstaende.klein),
                        verticalArrangement = Arrangement.spacedBy(Abstaende.hairline)) {
                        Text(set.name ?: "—", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold,
                            maxLines = 2, overflow = TextOverflow.Ellipsis, onTextLayout = { namedRows = it.lineCount })
                        Text(set.setNumber, Modifier.readAloudAs(stringResource(R.string.cd_set_nummer, set.setNumber)),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.Bold)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            val jahr = set.year
                            if (jahr != null) Text("$jahr", Modifier.readAloudAs(stringResource(R.string.cd_jahr, "$jahr")),
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if ((set.numParts ?: 0) > 0) {
                                // Dasselbe Teile-Symbol wie im Reiter „Teile" und in der Webapp.
                                Icon(
                                    ImageVector.vectorResource(R.drawable.ic_parts_bricks),
                                    contentDescription = null,
                                    tint = Color.Unspecified,
                                    modifier = Modifier.size(withFont(13.dp))
                                )
                                // Die Zahl mit Wort: „500“ allein neben dem Steinsymbol las sich wie ein Preis.
                                val teile = set.numParts ?: 0
                                Text(pluralStringResource(R.plurals.gallery_stat_parts, teile, fmtInt(teile)),
                                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        TileBalance(2 - namedRows)
                    }
                    if (ownershipAnnouncement != null) Box(Modifier.semantics { contentDescription = ownershipAnnouncement })
                }
            }
        }
        if (isBrick) StudsSeries(
            mass = StudsMass.Stein,
            modifier = Modifier.align(Alignment.TopStart),
            farbe = LocalBrickDecor.current.studs,
        )
    }
}

/** Seitenverhältnis der Kachelbilder, wie in der Galerie. */
private const val CATALOG_IMAGE_RATIO = 4f / 3f

/** Abstand der Besitzplakette vom Bildrand, wie in der Galerie. */
private val CATALOG_BADGE_EDGE = Abstaende.klein + Abstaende.tiny

/**
 * Platzhalter für einen Platz, dessen Seite noch nicht geladen ist — gleich hoch
 * wie eine echte Kachel, sonst springt die Liste beim Eintreffen, und ein Sprung
 * an eine Jahresgrenze landete daneben.
 */
@Composable
internal fun CatalogPlaceholderCard() {
    Card(
        shape = Formen.leiste,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)),
        modifier = Modifier.fillMaxWidth().height(200.dp)
    ) {}
}
