package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.indication
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.theme.Formen

/**
 * Ein Knopf, der klein aussieht ([flaeche] in [form]) und doch 48 × 48 dp Tippfläche hat.
 * Material vergrössert bei kleinen Knöpfen nur das Layout drumherum; der Knoten, den
 * Tippen und TalkBack sehen, bliebe so klein wie die Form. Hier ist er die ganze Fläche,
 * die Welle zeigt sich auf der Form.
 */
@Composable
fun SmallerButton(
    onClick: () -> Unit,
    form: Shape,
    modifier: Modifier = Modifier,
    flaeche: Modifier = Modifier,
    farbe: Color = Color.Transparent,
    inhaltFarbe: Color = LocalContentColor.current,
    edge: BorderStroke? = null,
    innen: PaddingValues = PaddingValues(0.dp),
    inhalt: @Composable RowScope.() -> Unit,
) {
    val quelle = remember { MutableInteractionSource() }
    Box(
        modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)
            .clickable(interactionSource = quelle, indication = null, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            flaeche.clip(form).background(farbe, form)
                .then(if (edge != null) Modifier.border(edge, form) else Modifier)
                .indication(quelle, ripple())
                .padding(innen),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CompositionLocalProvider(LocalContentColor provides inhaltFarbe) { inhalt() }
        }
    }
}

/** Plus oder Minus eines Mengenreglers: sichtbar 40 dp tonal wie ein FilledTonalIconButton, getippt 48 dp. */
@Composable
fun QuantitiesButton(onClick: () -> Unit, symbol: @Composable RowScope.() -> Unit) = SmallerButton(
    onClick = onClick,
    form = Formen.etikett,
    flaeche = Modifier.size(40.dp),
    farbe = MaterialTheme.colorScheme.secondaryContainer,
    inhaltFarbe = MaterialTheme.colorScheme.onSecondaryContainer,
    inhalt = symbol,
)
