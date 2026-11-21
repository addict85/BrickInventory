package ch.brickinventoryapp.collection.ui.screens

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Waehrung
import androidx.compose.ui.semantics.clearAndSetSemantics
import ch.brickinventoryapp.model.domain.SetAnsicht
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.AppKarte
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.material.icons.automirrored.filled.TrendingDown
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.ui.semantics.selected
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.components.TileBalance
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.LocalIsStudTheme
import ch.brickinventoryapp.ui.theme.LocalIsGloss
import androidx.compose.foundation.shape.CircleShape
import ch.brickinventoryapp.ui.theme.brickTone
import ch.brickinventoryapp.ui.theme.BrickStudCap
import ch.brickinventoryapp.ui.theme.StudsSeries
import ch.brickinventoryapp.ui.theme.BrickEdgesHistory
import ch.brickinventoryapp.ui.theme.StudsMass
import ch.brickinventoryapp.ui.util.fmtInt
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtProzent
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
import ch.brickinventoryapp.ui.util.rememberTileImageWithFallback
import androidx.compose.material3.ExperimentalMaterial3Api
import coil3.ImageLoader
import coil3.compose.AsyncImagePainter
import coil3.request.ImageRequest
import coil3.request.crossfade
import kotlinx.coroutines.launch
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.readAloudAs
import androidx.compose.ui.res.pluralStringResource
import ch.brickinventoryapp.ui.components.SharedImage
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.LocalIsColorSlotsTheme
import ch.brickinventoryapp.ui.theme.LocalBrickDecor
import ch.brickinventoryapp.ui.theme.slotsTone
import ch.brickinventoryapp.ui.theme.lightStrip
import ch.brickinventoryapp.shared.ui.ConditionBadges
import ch.brickinventoryapp.shared.ui.OwnerBadges
import ch.brickinventoryapp.collection.ui.TilePrice
import ch.brickinventoryapp.collection.ui.TileSource
import ch.brickinventoryapp.collection.ui.tileAmount
import ch.brickinventoryapp.collection.ui.kachelQuelle

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SetCard(
    set: SetAnsicht,
    serverUrl: String,
    imageLoader: ImageLoader,
    onClick: (String) -> Unit,
    /** Position in the tile wall — only for the cap color of the "noppe" design. */
    position: Int = 0,
    /** Market price and P&L; if both are missing, the purchase price shows (as in the web). */
    preis: TilePrice? = null,
    waehrung: Waehrung = Waehrung.EUR,
    /** Is this set's detail open next to it? Then the tile gets a border. */
    ausgewaehlt: Boolean = false,
    /** As a list row instead of a tile; the grid decides it by font size and columns. */
    zeile: Boolean = largeFont(),
) {
    // Preview image via the server, with fallback to full resolution as long as
    // the `_thumb` file is missing (the server generates it after a CSV import)
    // — like data-orig in the web app; see util/BildRueckfall.kt.
    val (imageUrl, onImageError) = rememberTileImageWithFallback(serverUrl, set.imageLocal, set.imageUrl)

    // One delayed retry after a load error: right after
    // entering, the image is often not ready yet on the server, and Coil never retries
    // a failed request on its own. Tied to set number and address,
    // so a reused tile counts anew; memoryCacheKeyExtra("retry", …)
    var retryNonce by remember(set.setNumber, imageUrl) { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    val isBrick = LocalIsBrickTheme.current
    val isStud = LocalIsStudTheme.current
    val isGloss = LocalIsGloss.current
    // In the "farbfaecher" design, every tile carries its theme's tone as a stripe, as
    // in the catalog. The gallery only knows the name; the same name gives the same tone.
    val tone = if (LocalIsColorSlotsTheme.current)
        slotsTone(set.theme?.hashCode()) else null

    // In the list row, the badges move from the image into the text: the image is too small there.
    val pct = preis?.pnlPct
    val betrag = tileAmount(set, preis)
    // What the badges on the image say, TalkBack reads at the end of the tile: the name comes first.
    val guvAnnouncement = if (pct != null && betrag != null) stringResource(
        if (pct >= 0) R.string.gallery_pnl_gewinn else R.string.gallery_pnl_verlust, fmtProzent(pct)) else null
    val quantityAnnouncement = if (set.quantity > 1) pluralStringResource(R.plurals.gallery_stat_units, set.quantity, fmtInt(set.quantity)) else null
    val guv: (@Composable () -> Unit)? = if (pct != null && betrag != null) ({
        GuvBadge(pct)
    }) else null
    val menge: (@Composable () -> Unit)? = if (set.quantity > 1) ({
        QuantityBadge(set)
    }) else null

    // The image area; without badges in the row and rounded on the left instead of the top.
    val canvas: @Composable (Modifier) -> Unit = { flaeche ->
        TileImage(flaeche, set, imageUrl, imageLoader, retryNonce, zeile, isBrick, isGloss, guv, menge,
            onState = { st ->
                if (st is coil3.compose.AsyncImagePainter.State.Error && retryNonce == 0) {
                    // Delayed, not on the same moment: right after
                    // entering, the server is still only generating the
                    // preview.
                    scope.launch {
                        kotlinx.coroutines.delay(1000)
                        retryNonce = 1
                    }
                } else if (st is coil3.compose.AsyncImagePainter.State.Error) {
                    // The second attempt also failed — now fall back
                    // to the full resolution (a missing
                    // _thumb file is the most common reason).
                    onImageError()
                }
            })
    }
    val texts: @Composable (Modifier) -> Unit = { column ->
        TileTexts(column, set, zeile, tone, guv, menge, preis, betrag, waehrung, listOfNotNull(guvAnnouncement, quantityAnnouncement))
    }
    TileFrame(isBrick, isStud, isGloss, position, tone, zeile, ausgewaehlt,
        onClick = { onClick(set.setNumber) }, canvas = canvas, texts = texts)
}

/**
 * P&L as a badge: in the price line it wrapped next to "each", and the tile
 * grew taller than its neighbor. Arrow and "Profit …" announcement: a bare
 * number only told whoever already understands finance.
 */
@Composable
private fun GuvBadge(pct: Double) {
    val farbe = if (pct >= 0) LocalStatusFarben.current.erfolg else MaterialTheme.colorScheme.error
    val announcement = stringResource(if (pct >= 0) R.string.gallery_pnl_gewinn else R.string.gallery_pnl_verlust,
        fmtProzent(pct))
    Surface(color = MaterialTheme.colorScheme.surface, shape = Formen.etikett) {
        Row(Modifier.padding(horizontal = Abstaende.tiny + Abstaende.hairline, vertical = Abstaende.hairline),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Abstaende.hairline)) {
            Icon(if (pct >= 0) Icons.AutoMirrored.Filled.TrendingUp else Icons.AutoMirrored.Filled.TrendingDown,
                null, Modifier.size(withFont(12.dp)), tint = farbe)
            Text(fmtProzent(pct), Modifier.semantics { contentDescription = announcement },
                style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold,
                color = farbe, maxLines = 1, softWrap = false)
        }
    }
}

/** The quantity as a badge, read aloud as units instead of as "x2". */
@Composable
private fun QuantityBadge(set: SetAnsicht) {
    Surface(color = MaterialTheme.colorScheme.primary, shape = Formen.etikett) {
        Text(stringResource(R.string.gallery_quantity_badge, set.quantity), Modifier.padding(horizontal = 6.dp, vertical = Abstaende.hairline)
            .readAloudAs(pluralStringResource(R.plurals.gallery_stat_units, set.quantity, fmtInt(set.quantity))),
            color = MaterialTheme.colorScheme.onPrimary,
            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
    }
}

/** The tile's image with reflection and, except in the row, the badges on it. */
@Composable
private fun TileImage(
    modifier: Modifier,
    set: SetAnsicht,
    imageUrl: String?,
    imageLoader: ImageLoader,
    retryNonce: Int,
    zeile: Boolean,
    isBrick: Boolean,
    isGloss: Boolean,
    guv: (@Composable () -> Unit)?,
    menge: (@Composable () -> Unit)?,
    onState: (AsyncImagePainter.State) -> Unit,
) {
    val ctx = LocalContext.current
    // Fade in softly only if motion is wanted (movementReduced).
    val weich = !movementReduced()
    Box(modifier) {
        SharedImage(set.setNumber) { bild ->
            ProduktBild(
                model = imageUrl?.let { ImageRequest.Builder(ctx).data(it)
                    .memoryCacheKeyExtra("retry", retryNonce.toString())
                    .crossfade(weich).build() },
                imageLoader = imageLoader,
                // Without a description: the tile summarizes its content, and the
                // name already stood below it as text — TalkBack would read it twice.
                contentDescription = null,
                onState = onState,
                // Edge to edge, flush with the card's corners: the white image background fills the
                // space ContentScale.Fit leaves free next to the image.
                modifier = bild
                    .fillMaxSize()
                    .then(when {
                        isBrick -> Modifier
                        zeile -> Modifier.clip(RoundedCornerShape(topStart = 16.dp, bottomStart = 16.dp))
                        else -> Modifier.clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp))
                    }),
                contentScale = ContentScale.Fit,
                fallbackSize = if (zeile) 32.dp else 48.dp,
                bildgrund = true,
                innerGap = Abstaende.klein,
            )
        }
        // The reflection on the glass pane: above the image, but UNDER badges and
        // menu, so the controls sit on their own surface (lightStrip()).
        if (isGloss) Box(Modifier.matchParentSize().background(lightStrip()))
        // The tile carries no destructive action: deletion happens in the detail,
        // with a confirmation and "Undo" after. Badges with padding inside
        // the image (BADGE_EDGE): on its edge they sat over the corner.
        if (!zeile) {
            if (guv != null) Box(Modifier.align(Alignment.TopStart).padding(BADGE_EDGE).clearAndSetSemantics {}) { guv() }
            if (menge != null) Box(Modifier.align(Alignment.TopEnd).padding(BADGE_EDGE).clearAndSetSemantics {}) { menge() }
        }
    }
}

/**
 * Condition and owner below the image instead of above: above the image they needed
 * a free stripe, which sat as a gap between the image and "New".
 * The name first, visibly as it's read aloud: TalkBack used to read condition and number before it.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TileTexts(
    modifier: Modifier,
    set: SetAnsicht,
    zeile: Boolean,
    tone: Color?,
    guv: (@Composable () -> Unit)?,
    menge: (@Composable () -> Unit)?,
    preis: TilePrice?,
    betrag: Geld?,
    waehrung: Waehrung,
    /** What the image badges say; TalkBack reads it after the price. */
    announce: List<String>,
) {
    // A one-line name leaves no blank line below it; so the grid row stays the same
    // height, the missing line sits at the foot of the tile (TileBalance).
    var namedRows by remember { mutableIntStateOf(2) }
    Box(modifier) {
        Column(Modifier.padding(horizontal = Abstaende.mittel, vertical = Abstaende.klein), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(set.name ?: set.setNumber, fontWeight = FontWeight.SemiBold,
                maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium,
                onTextLayout = { namedRows = it.lineCount })
            Text(set.setNumber, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Column(Modifier.padding(vertical = Abstaende.hairline), verticalArrangement = Arrangement.spacedBy(Abstaende.hairline)) {
                // In the row, the badges sit before the condition in one line: each
                // on its own line cost a third of the next line at 200%.
                if (zeile) FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.tiny),
                    verticalArrangement = Arrangement.spacedBy(Abstaende.hairline),
                ) {
                    guv?.invoke()
                    menge?.invoke()
                    ConditionBadges(set.conditions, set.condition)
                } else ConditionBadges(set.conditions, set.condition)
                // Who owns this copy? Without that information, you'd
                // move the wrong one in the household.
                OwnerBadges(set.owners)
            }
            // Theme and part count in one line: separate, usually one of them sat empty.
            // In farbfaecher, a dot in the card bar's tone before it: that way the
            // bar reads as a theme, not just a color.
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstaende.tiny)) {
                if (tone != null && !set.theme.isNullOrBlank()) Box(Modifier.size(8.dp).background(tone, CircleShape))
                Text(themeAndParts(set.theme, set.pieces?.let { fmtInt(it) + stringResource(R.string.gallery_pieces_suffix) }),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            TileAmountRows(set, zeile, preis, betrag, waehrung)
            if (!zeile) TileBalance(2 - namedRows)
        }
        // Without a surface: only the image badges' announcement, after the price.
        val badges = announce.takeIf { !zeile && it.isNotEmpty() }
        if (badges != null) Box(Modifier.semantics { contentDescription = badges.joinToString(", ") })
    }
}

/** Where the amount comes from, below it the amount and, for more than one piece, "each". */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TileAmountRows(set: SetAnsicht, zeile: Boolean, preis: TilePrice?, betrag: Geld?, waehrung: Waehrung) {
    // As in the web, a line above saying what the amount is: without a market price it's
    // the purchase price (kachel_quelle), unlabeled it read as market value.
    // Empty without an amount, so tiles in a row stay the same height; in the
    // row, the label sits before the amount if the width allows.
    val quelle = when (if (betrag != null) kachelQuelle(set, preis) else null) {
        TileSource.MARKT -> stringResource(R.string.gallery_card_market)
        TileSource.PURCHASE -> stringResource(R.string.gallery_card_paid)
        null -> ""
    }
    if (!zeile) Text(quelle, style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1, overflow = TextOverflow.Ellipsis)
    // FlowRow with one line each: if the width doesn't suffice, "each" moves under
    // the amount instead of wrapping character by character.
    if (betrag != null) FlowRow(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        if (zeile) Text(quelle, style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, softWrap = false,
            modifier = Modifier.align(Alignment.CenterVertically))
        Text(fmtMoney(betrag, waehrung), style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.align(Alignment.CenterVertically))
        // The amount applies per piece; the finances show the same set with the value
        // of all pieces, and without the hint the numbers wouldn't match up.
        if (set.quantity > 1) Text(stringResource(R.string.gallery_price_each),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1, softWrap = false, modifier = Modifier.align(Alignment.CenterVertically))
    } else if (!zeile) Text("", style = MaterialTheme.typography.labelMedium)
}

/**
 * The studs sit above the card: a Material Card clips to its shape.
 * That's why the card moves down by the stud height, and the row is drawn
 * next to it and laid on top — like `top:-6px` in the CSS.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TileFrame(
    isBrick: Boolean,
    isStud: Boolean,
    isGloss: Boolean,
    position: Int,
    tone: Color?,
    zeile: Boolean,
    ausgewaehlt: Boolean,
    onClick: () -> Unit,
    canvas: @Composable (Modifier) -> Unit,
    texts: @Composable (Modifier) -> Unit,
) {
    Box {
        AppKarte(
            modifier = Modifier
                .then(if (isBrick) Modifier.padding(top = StudsMass.Stein.hoehe) else Modifier)
                .semantics { selected = ausgewaehlt }
                .then(if (ausgewaehlt) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, Formen.karte) else Modifier),
            onClick = onClick,
            onClickLabel = stringResource(R.string.cd_details_oeffnen),
        ) {
            Column {
                // The brick edge with the dimensions from themes/brick.css (StudsMass.Stein), as in
                // the web across the full width. Only the edge sits in the card; the studs are drawn
                // next to it, because the Card would clip them.
                // A slimmer edge on the narrow phone tile: 22 dp there visibly took room from the
                // image; from tablet width the full height as in the web.
                if (isBrick) BoxWithConstraints {
                    BrickStudCap(mass = StudsMass.Stein, verlauf = BrickEdgesHistory,
                        height = if (maxWidth < 240.dp) 12.dp else null)
                }
                // The "noppe" design's brick cap — position modulo six,
                // exactly like `.sc:nth-child(6n+…)` in themes/noppe.css. The same
                // building block as the brick design, only taller and in
                // varying color; hence the same component instead of a second one.
                if (isStud) BrickStudCap(color = brickTone(position), gloss = isGloss)
                if (tone != null) Box(Modifier.fillMaxWidth().height(5.dp).background(tone))
                // 4:3 like the set images themselves: a fixed height left a gap between the image
                // and text with ContentScale.Fit.
                if (zeile) Row(verticalAlignment = Alignment.Top) {
                    canvas(Modifier.width(ROW_IMAGE_WIDTH).aspectRatio(IMAGE_ASPECT_RATIO))
                    texts(Modifier.weight(1f))
                } else {
                    canvas(Modifier.fillMaxWidth().aspectRatio(IMAGE_ASPECT_RATIO))
                    texts(Modifier)
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

/** Width of the preview image when the tile is a list row at large font size. */
private val ROW_IMAGE_WIDTH = 96.dp

/** Aspect ratio of a tile's image area — that of the set images. */
internal const val IMAGE_ASPECT_RATIO = 4f / 3f

/** Badges on the image: the image's inner padding plus a margin, so they don't sit on its corner. */
private val BADGE_EDGE = Abstaende.klein + Abstaende.tiny

/**
 * "Star Wars · 7,541 parts" — the theme in semibold instead of blue: blue means
 * "tappable" in the app, and the theme on the tile isn't (filter is in the sheet).
 */
@Composable
private fun themeAndParts(thema: String?, teile: String?): androidx.compose.ui.text.AnnotatedString =
    androidx.compose.ui.text.buildAnnotatedString {
        if (!thema.isNullOrBlank()) {
            pushStyle(androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.SemiBold))
            append(thema)
            pop()
        }
        if (!thema.isNullOrBlank() && teile != null) append(" · ")
        if (teile != null) append(teile)
    }
