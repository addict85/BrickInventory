package ch.brickinventoryapp.shared.ui

import ch.brickinventoryapp.model.domain.Zustand
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import coil3.compose.AsyncImagePainter
import ch.brickinventoryapp.ui.components.catalogName
import ch.brickinventoryapp.ui.components.focusFrame
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.stueckzahl
import ch.brickinventoryapp.ui.components.readAloudAs
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.SegmentChoice
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.ui.util.fmtInt

/**
 * A row of the table view — for parts and figures, like the web app's two
 * identically built tables; one implementation, so they don't
 * drift apart. No real columns: seven columns would have to be scrolled sideways
 * on the phone, which is why the wide ones sit as a second row
 * below.
 *
 * @param bildUrl     preview image, or null
 * @param nummer      part or figure number (monospace)
 * @param name        label
 * @param menge       quantity shown on the right
 * @param farbe       color dot before the name (parts only)
 * @param secondRow category/sets resp. capture date, or null
 * @param onBildFehler fallback to the full resolution
 *         (rememberTileImageWithFallback)
 * @param onClick tapping the whole row, or null for „not clickable“
 * @param onClickLabel what tapping does, for voice output — otherwise it only
 *         says „double-tap to activate“. Defaults to null for callers without
 *         text of their own.
 */
@Composable
fun TabellenZeile(
    bildUrl: String?,
    nummer: String,
    name: String?,
    menge: Int,
    imageLoader: ImageLoader,
    modifier: Modifier = Modifier,
    farbe: Color? = null,
    secondRow: String? = null,
    onBildFehler: () -> Unit = {},
    onClick: (() -> Unit)? = null,
    onClickLabel: String? = null,
) {
    val ctx = LocalContext.current
    // onClick: both views open the same dialog as in the web app; one view
    // shouldn't do less than the other. `null` means not clickable.
    Surface(
        modifier = modifier.fillMaxWidth()
            .let {
                if (onClick != null) it.focusFrame(Formen.etikett).clickable(onClickLabel = onClickLabel, role = Role.Button, onClick = onClick)
                else it
            },
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = Abstaende.klein),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                ProduktBild(
                    model = bildUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(!movementReduced()).build() },
                    imageLoader = imageLoader,
                    // Without a description: the name sits next to it, TalkBack would otherwise read it twice.
                    contentDescription = null,
                    onState = { st ->
                        if (st is AsyncImagePainter.State.Error) onBildFehler()
                    },
                    modifier = Modifier.size(36.dp).clip(Formen.etikett),
                    contentScale = ContentScale.Fit,
                    fallbackSize = 20.dp,
                )
                TablesText(nummer, name, farbe, secondRow, Modifier.weight(1f))
                Text(
                    fmtInt(menge),
                    Modifier.readAloudAs(stueckzahl(menge)),
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

/** Number with color dot, name and second row: the middle of a [TabellenZeile]. */
@Composable
private fun TablesText(nummer: String, name: String?, farbe: Color?, secondRow: String?, modifier: Modifier) {
    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            if (farbe != null) {
                Surface(color = farbe,
                    shape = CircleShape,
                    modifier = Modifier.size(10.dp)) {}
            }
            Text(
                nummer,
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.primary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        // Catalog names are in English; TalkBack pronounces them that way (catalogName).
        Text(
            name?.let { catalogName(it) } ?: AnnotatedString(stringResource(R.string.name_unknown)),
            color = if (name == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            style = MaterialTheme.typography.bodySmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (!secondRow.isNullOrBlank()) {
            Text(
                secondRow,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * The condition row: label „Zustand“ and next to it new/used. One
 * implementation for all capture dialogs, so the same choice looks the same
 * everywhere and the label, with its fixed width, lines up flush.
 *
 */
@Composable
fun Zustandszeile(
    zustand: Zustand,
    onZustand: (Zustand) -> Unit,
    modifier: Modifier = Modifier,
    /** Durchgereicht an [ConditionToggle] — siehe dort. */
    optionen: List<Pair<Zustand, Int>> = STATE_NEW_USED,
) {
    // From 130% text size the label sits above the choice: in the fixed column
    // next to it, „Zustan|d“ broke in the middle of the word.
    if (LocalDensity.current.fontScale > 1.3f) {
        Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            Text(stringResource(R.string.common_condition), style = MaterialTheme.typography.bodyMedium)
            ConditionToggle(selected = zustand, onSelect = onZustand, optionen = optionen)
        }
        return
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier.fillMaxWidth(),
    ) {
        Text(
            stringResource(R.string.common_condition),
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.width(90.dp),
        )
        Spacer(Modifier.width(Abstaende.klein))
        ConditionToggle(selected = zustand, onSelect = onZustand, modifier = Modifier.weight(1f), optionen = optionen)
    }
}

/**
 * The default of [ConditionToggle] and [Zustandszeile] — in one place,
 * so the two don't end up with different lists.
 */
val STATE_NEW_USED: List<Pair<Zustand, Int>> =
    listOf(Zustand.NEU to R.string.condition_new, Zustand.GEBRAUCHT to R.string.condition_used)

/**
 * New/used as two surfaces, next to the row that embeds it.
 */
@Composable
fun ConditionToggle(
    selected: Zustand,
    onSelect: (Zustand) -> Unit,
    modifier: Modifier = Modifier,
    /** Value → label, defaulting to „neu / gebraucht“. */
    optionen: List<Pair<Zustand, Int>> = STATE_NEW_USED,
) {
    // The same segmented button as every single choice in the app (SegmentChoice): the
    // own implementation with borderless surfaces made „Gebraucht“ look like plain text.
    SegmentChoice(
        optionen = optionen.map { (wert, text) -> wert to stringResource(text) },
        gewaehlt = selected,
        onWahl = onSelect,
        modifier = modifier,
    )
}
