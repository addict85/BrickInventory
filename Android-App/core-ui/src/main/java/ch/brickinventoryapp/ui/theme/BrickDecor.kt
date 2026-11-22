package ch.brickinventoryapp.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The light falloff of a glossy surface — light at the top, shadow at the bottom, the same
 * stops as in themes/hochglanz.css. The light rim is narrow (0.34 at 30%),
 * so it doesn't eat away the lid color on the phone; that color is the theme's
 * defining beat. Numbers instead of design-tokens.json, because a gradient of white and
 * black proportions is not a color, but sits on top of every base color.
 */
val LackHistory = Brush.verticalGradient(
    0.00f to Color.White.copy(alpha = 0.34f),
    0.30f to Color.White.copy(alpha = 0.10f),
    0.62f to Color.Black.copy(alpha = 0.10f),
    1.00f to Color.Black.copy(alpha = 0.20f),
)

/**
 * The shape of a stud: flush at the bottom with the lid, round at the
 * top — the same as `--studs-form` in styles.css, in one place.
 */
val StudsForm = RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp)

/**
 * The light falloff on the brick edge, the same stops as `.sc::before` in
 * themes/brick.css. Weaker than LackHistory, because the brick theme is matte
 * plastic; without it the edge would be flat.
 */
val BrickEdgesHistory = Brush.verticalGradient(
    0.00f to Color.White.copy(alpha = 0.20f),
    0.40f to Color.White.copy(alpha = 0.05f),
    1.00f to Color.Black.copy(alpha = 0.12f),
)

/**
 * The dimensions of a row of studs — the same numbers as in the CSS, as one record: the
 * themes differ exactly there, and spread across several call sites, a
 * fix wouldn't carry over to all of them.
 */
data class StudsMass(
    /** Height of the edge as a whole — `height` of the ::before rule in the CSS. */
    val edgeHeight: Dp,
    /** Distance from stud center to stud center — `mask-size` in the CSS. */
    val takt: Dp,
    val breite: Dp,
    val hoehe: Dp,
    /** Inset left and right — `left`/`right` in the CSS. */
    val edge: Dp,
    /**
     * Distance from the top edge of the border — `top` in the CSS. Negative means: the studs
     * stick out as on a real brick; then the row is drawn outside the card
     * (StudsSeries).
     */
    val oben: Dp,
    /** Does the row fill the whole width? Otherwise `anzahl` pieces apply. */
    val filling: Boolean,
    val anzahl: Int = 4,
) {
    /** Does the row stick out past the edge? Then it doesn't belong inside the card. */
    val overhanging: Boolean get() = oben < 0.dp

    companion object {
        /** themes/brick.css: one row across the whole edge, beat 17. */
        val Stein = StudsMass(edgeHeight = 22.dp, takt = 17.dp, breite = 10.dp,
                               hoehe = 6.dp, edge = 10.dp, oben = (-6).dp, filling = true)

        /** themes/noppe.css: four studs on the lid, beat 22. */
        val Deckel = StudsMass(edgeHeight = 16.dp, takt = 22.dp, breite = 14.dp,
                                hoehe = 7.dp, edge = 12.dp, oben = 6.dp, filling = false, anzahl = 4)
    }
}

/**
 * Stud lid for brick cards: a narrow colored strip with studs; the
 * card's clipping rounds it off at the top. A stud is a rectangle with a round
 * top edge, as in themes/noppe.css (13 × 6, radius 4, spacing 7). `gloss` curves
 * the lid — a parameter instead of a second building block, because it's the same
 * lid in a different material.
 */
@Composable
fun BrickStudCap(
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
    /** Without one given, the height from `mass` — then no number sits at the call site. */
    height: Dp? = null,
    gloss: Boolean = false,
    mass: StudsMass = StudsMass.Deckel,
    studsColor: Color? = null,
    /** Light falloff over the base color — see BrickEdgesHistory. */
    verlauf: Brush? = null,
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(height ?: mass.edgeHeight)
            .background(color)
            .then(if (verlauf != null) Modifier.background(verlauf) else Modifier)
            .then(if (gloss) Modifier.background(LackHistory) else Modifier)
    ) {
        // If the row sticks out past the edge, it doesn't belong here: a
        // Material Card clips to its shape, and the studs would be gone. The
        // call site then draws them next to the card (see GalleryScreen).
        if (!mass.overhanging) {
            StudsSeries(
                mass = mass,
                modifier = Modifier.align(Alignment.TopStart).offset(y = mass.oben),
                farbe = studsColor,
                gloss = gloss,
            )
        }
    }
}

/**
 * Only the studs, without the edge: Compose has no `overflow:visible`, and the Card
 * clips to its shape. So the row is drawn next to the card and
 * pushed over it with an offset.
 */
@Composable
fun StudsSeries(
    mass: StudsMass,
    modifier: Modifier = Modifier,
    farbe: Color? = null,
    gloss: Boolean = false,
) {
    BoxWithConstraints(modifier.fillMaxWidth().height(mass.hoehe)) {
        // How many studs fit on the edge? In the CSS,
        // `mask-repeat:repeat-x` computes this on its own; here it needs the width,
        // and that only exists once measured. BoxWithConstraints exists for exactly this.
        val anzahl =
            if (mass.filling) (((maxWidth - mass.edge * 2) / mass.takt).toInt()).coerceAtLeast(1)
            else mass.anzahl
        Row(
            Modifier.align(Alignment.TopStart).padding(start = mass.edge),
            horizontalArrangement = Arrangement.spacedBy(mass.takt - mass.breite)
        ) {
            repeat(anzahl) {
                Box(
                    Modifier
                        .size(width = mass.breite, height = mass.hoehe)
                        .clip(StudsForm)
                        // The dome: a highlight at the top instead of an evenly
                        // bright disc. The same radial gradient as
                        // `radial-gradient(ellipse at 50% 20%, …)` on the web.
                        .then(
                            if (gloss) Modifier.background(
                                Brush.radialGradient(
                                    0.00f to Color.White.copy(alpha = 0.95f),
                                    0.45f to Color.White.copy(alpha = 0.55f),
                                    1.00f to Color.White.copy(alpha = 0.18f),
                                )
                            ) else Modifier.background(
                                farbe ?: Color.White.copy(alpha = 0.55f)
                            )
                        )
                )
            }
        }
    }
}

/**
 * The diagonal light streak — the reflection on glass. Only on the image area and
 * on colored surfaces: over white text, a white overlay would be gray instead of
 * gloss.
 */
val LightStrip = Brush.linearGradient(
    0.20f to Color.White.copy(alpha = 0.00f),
    0.36f to Color.White.copy(alpha = 0.55f),
    0.44f to Color.White.copy(alpha = 0.15f),
    0.56f to Color.White.copy(alpha = 0.00f),
)

/**
 * In the dark theme only a hint: a bright streak at 0.85 opacity on a dark
 * image area glowed like a spotlight and sat beneath the menu and the quantity badge.
 */
private val LightStripDark = Brush.linearGradient(
    0.20f to Color.White.copy(alpha = 0.00f),
    0.36f to Color.White.copy(alpha = 0.10f),
    0.44f to Color.White.copy(alpha = 0.03f),
    0.56f to Color.White.copy(alpha = 0.00f),
)

/** The light streak matched to the brightness of the surface. */
@Composable
fun lightStrip(): Brush =
    if (MaterialTheme.colorScheme.surface.luminance() < 0.5f) LightStripDark else LightStrip
