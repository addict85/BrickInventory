package ch.brickinventoryapp.teile.ui.screens

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
import ch.brickinventoryapp.gemeinsam.ui.MetricsSeries
import ch.brickinventoryapp.gemeinsam.ui.StatChipV2
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import coil3.ImageLoader

/**
 * Der Kopf jedes Teile- und Figurendetails, ob selbst erfasst oder aus einem Set: Bild zum
 * Vergrössern und die Kennzahlen als Chips. Darunter folgen nur die Abschnitte, die der
 * Eintrag hat; zwei eigene Bauformen liessen dasselbe Teil je nach Herkunft anders aussehen.
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
        if (metrics.isNotEmpty()) MetricsSeries {
            metrics.forEach { (label, wert) -> StatChipV2(label = label, value = wert) }
        }
    }
}

/** Höhe des Bilds im Kopf; im Blatt und auf der eigenen Seite dieselbe. */
internal val PART_IMAGE_HEIGHT = 200.dp
