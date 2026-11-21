package ch.brickinventoryapp.shared.ui

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.beschreibung
import coil3.ImageLoader
import ch.brickinventoryapp.ui.components.ProduktBild

/**
 * The preview image of a finance row — 52 dp, falling back to the shared placeholder. One function
 * for the set row (FinanceSections.kt) and the row for manual entries, because
 * both sit in the same table and any deviation would stand out immediately.
 */
@Composable
fun FinanzBild(imageUrl: String?, imageLoader: ImageLoader, beschreibung: String?) {
    Surface(
        shape = Formen.kachel,
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.size(52.dp)
    ) {
        ProduktBild(
            model = imageUrl, imageLoader = imageLoader,
            contentDescription = beschreibung,
            modifier = Modifier.fillMaxSize().clip(Formen.kachel),
            contentScale = ContentScale.Fit,
            fallbackSize = 28.dp,
            bildgrund = true,
            innerGap = 2.dp,
        )
    }
}
