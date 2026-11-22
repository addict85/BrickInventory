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
import ch.brickinventoryapp.ui.components.ProductImage
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.Shapes
import coil3.ImageLoader

/**
 * The header of every part and figure detail, whether self-entered or from a set: an image to
 * enlarge and the key figures as chips. Below it follow only the sections the
 * entry has; two separate layouts would make the same part look different depending on origin.
 */
@Composable
internal fun PartDetailHeader(
    image: String?,
    imageLoader: ImageLoader,
    title: String?,
    metrics: List<Pair<String, String>>,
    onZoom: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.medium)) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = Shapes.chip,
            elevation = CardDefaults.cardElevation(defaultElevation = Shapes.cardElevationHigh),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
            ProductImage(
                model = image,
                imageLoader = imageLoader,
                contentDescription = title,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(PART_IMAGE_HEIGHT)
                    .clip(Shapes.chip)
                    .clickable(enabled = image != null, onClickLabel = stringResource(R.string.cd_image_enlarge),
                        role = Role.Button, onClick = onZoom)
                    .padding(Spacing.medium),
                contentScale = ContentScale.Fit,
                fallbackSize = 64.dp,
            )
        }
        // The name above (bar or sheet title) comes from the catalog and stays English.
        if (title != null) CatalogNameHint()
        if (metrics.isNotEmpty()) MetricsSeries {
            metrics.forEach { (label, value) -> StatChipV2(label = label, value = value) }
        }
    }
}

/** Height of the image in the header; the same in the sheet and on its own page. */
internal val PART_IMAGE_HEIGHT = 200.dp
