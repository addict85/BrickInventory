package ch.brickinventoryapp.parts.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.shared.ui.MetricsSeries
import ch.brickinventoryapp.shared.ui.StatChipV2
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.CatalogNameHint
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import coil3.ImageLoader

/**
 * The header of every part and figure detail, whether self-entered or from a set: an image to
 * enlarge and the key figures as chips. Below it follow only the sections the
 * entry has; two separate layouts would make the same part look different depending on origin.
 */
@Composable
internal fun PartDetailHeader(
    bild: String?,
    imageLoader: ImageLoader,
    titel: String?,
    metrics: List<Pair<String, String>>,
    onZoom: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = Formen.chip,
            elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebungHoch),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
            ProduktBild(
                model = bild,
                imageLoader = imageLoader,
                contentDescription = titel,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(PART_IMAGE_HEIGHT)
                    .clip(Formen.chip)
                    .clickable(enabled = bild != null, onClickLabel = stringResource(R.string.cd_bild_vergroessern),
                        role = Role.Button, onClick = onZoom)
                    .padding(Abstaende.mittel),
                contentScale = ContentScale.Fit,
                fallbackSize = 64.dp,
            )
        }
        // The name above (bar or sheet title) comes from the catalog and stays English.
        if (titel != null) CatalogNameHint()
        if (metrics.isNotEmpty()) MetricsSeries {
            metrics.forEach { (label, wert) -> StatChipV2(label = label, value = wert) }
        }
    }
}

/** Height of the image in the header; the same in the sheet and on its own page. */
internal val PART_IMAGE_HEIGHT = 200.dp
