package ch.brickinventoryapp.shared.ui

import ch.brickinventoryapp.ui.theme.Shapes
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.description
import coil3.ImageLoader
import ch.brickinventoryapp.ui.components.ProductImage

/**
 * The preview image of a finance row — 52 dp, falling back to the shared placeholder. One function
 * for the set row (FinanceSections.kt) and the row for manual entries, because
 * both sit in the same table and any deviation would stand out immediately.
 */
@Composable
fun FinanceImage(imageUrl: String?, imageLoader: ImageLoader, description: String?) {
    Surface(
        shape = Shapes.tile,
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.size(52.dp)
    ) {
        ProductImage(
            model = imageUrl, imageLoader = imageLoader,
            contentDescription = description,
            modifier = Modifier.fillMaxSize().clip(Shapes.tile),
            contentScale = ContentScale.Fit,
            fallbackSize = 28.dp,
            imageBackground = true,
            innerGap = 2.dp,
        )
    }
}
