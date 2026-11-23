package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import ch.brickinventoryapp.ui.theme.AppCard
import ch.brickinventoryapp.ui.theme.Spacing

/**
 * The frame of a settings section. Public in core-ui, because settings
 * and vouchers share it — a second implementation would eventually look different.
 * Without [title], no header: if the card is alone on its page, the bar
 * above it already names it, and the same title twice read like an error.
 */
@Composable
fun SettingsCard(
    title: String?,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    content: @Composable ColumnScope.() -> Unit
) {
    AppCard {
        // The spacing between a card's children lives here once, so every card
        // gets it without anyone having to think of it.
        Column(
            Modifier.padding(Spacing.large),
            verticalArrangement = Arrangement.spacedBy(Spacing.small),
        ) {
            if (title != null) SectionTitle(title, Modifier.padding(bottom = Spacing.medium), symbol = icon)
            content()
        }
    }
}
