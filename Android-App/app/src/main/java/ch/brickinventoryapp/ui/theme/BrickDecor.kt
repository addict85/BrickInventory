package ch.brickinventoryapp.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Der Lichtabfall einer lackierten Flaeche — Licht oben, Schatten unten.
 *
 * Dieselben vier Haltepunkte wie `linear-gradient(180deg, …)` in
 * themes/hochglanz.css. Sie stehen hier als Zahlen und nicht in
 * design-tokens.json, weil sie keine FARBE sind: Ein Verlauf aus Weiss- und
 * Schwarzanteilen liegt ueber jeder beliebigen Grundfarbe und gehoert damit
 * nicht in eine Palette.
 */
val LackVerlauf = Brush.verticalGradient(
    0.00f to Color.White.copy(alpha = 0.55f),
    0.42f to Color.White.copy(alpha = 0.12f),
    0.62f to Color.Black.copy(alpha = 0.10f),
    1.00f to Color.Black.copy(alpha = 0.20f),
)

/**
 * Die Form EINER Noppe: unten bündig am Deckel, oben rund.
 *
 * Dieselbe Form, die themes/noppe.css als Maske führt (`--noppen-form`). Sie
 * steht hier als eigener Wert und nicht dreimal im Baustein, damit beide
 * Oberflächen sie an genau einer Stelle führen.
 */
val NoppenForm = RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp)

/**
 * Noppen-„Deckel" für Stein-Karten: eine schmale, farbige Leiste mit hellen
 * Noppen links. Wird oben in Karten platziert und über das Karten-Clipping
 * automatisch oben abgerundet.
 *
 * ── Die Form der Noppe (Nachtrag 163) ────────────────────────────────
 *
 * Ein Rechteck mit RUNDER OBERKANTE, oben am Deckel angesetzt — die Noppe von
 * vorn gesehen, so wie sie im Entwurf steht und wie themes/noppe.css sie
 * zeichnet. Vorher standen hier Kreise: Marcos Vorgabe sind einheitliche
 * Ansichten, und ein Kreis in der App neben einer Noppe im Web sind zwei
 * Designs. Die Masse (13 × 6, Radius 4, Abstand 7) sind dieselben wie dort.
 *
 * ── Der Glanz (Nachtrag 162) ────────────────────────────────────────────────
 *
 * Mit `glanz = true` woelbt sich der Deckel: derselbe Lichtabfall wie im Web,
 * und die Noppen werden Kuppen statt heller Scheiben. Als PARAMETER und nicht
 * als zweiter Baustein — es ist derselbe Deckel in einem anderen Material, und
 * zwei Bausteine liefen beim naechsten Nachbessern auseinander.
 */
@Composable
fun BrickStudCap(
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
    height: Dp = 16.dp,
    studCount: Int = 4,
    glanz: Boolean = false
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(height)
            .background(color)
            .then(if (glanz) Modifier.background(LackVerlauf) else Modifier)
    ) {
        Row(
            Modifier.align(Alignment.TopStart).padding(top = 5.dp, start = 11.dp),
            horizontalArrangement = Arrangement.spacedBy(7.dp)
        ) {
            repeat(studCount) {
                Box(
                    Modifier
                        .size(width = 13.dp, height = 6.dp)
                        .clip(NoppenForm)
                        // Die Kuppe: ein Lichtpunkt oben statt einer gleichmaessig
                        // hellen Scheibe. Derselbe radiale Verlauf wie
                        // `radial-gradient(ellipse at 50% 20%, …)` im Web.
                        .then(
                            if (glanz) Modifier.background(
                                Brush.radialGradient(
                                    0.00f to Color.White.copy(alpha = 0.95f),
                                    0.45f to Color.White.copy(alpha = 0.55f),
                                    1.00f to Color.White.copy(alpha = 0.18f),
                                )
                            ) else Modifier.background(Color.White.copy(alpha = 0.55f))
                        )
                )
            }
        }
    }
}

/**
 * Der schraege Lichtstreifen — die Spiegelung auf einer Glasflaeche.
 *
 * ── Wo er liegen darf ───────────────────────────────────────────────────────
 *
 * Auf dem BILDFELD und auf farbigen Flaechen, NICHT auf der ganzen Kachel. Ein
 * weisser Schleier ueber weissem Text ist kein Glanz, sondern Grau: Die erste
 * Fassung des Entwurfs hatte ihn ueber der ganzen Karte, und die Kacheln sahen
 * blasser aus als ohne Glanz statt lackierter. Gesehen hat man das erst im
 * Browser, nicht an den Werten.
 */
val LichtStreifen = Brush.linearGradient(
    0.20f to Color.White.copy(alpha = 0.00f),
    0.36f to Color.White.copy(alpha = 0.85f),
    0.44f to Color.White.copy(alpha = 0.25f),
    0.56f to Color.White.copy(alpha = 0.00f),
)

/**
 * Farbige Wert-Kachel für die Set-Details (z. B. "Aktueller Wert" in Petrol,
 * "Kaufpreis" in Schiefer) — Label oben, großer Wert darunter.
 */
@Composable
fun BrickStatTile(
    label: String,
    value: String,
    container: Color,
    onContainer: Color,
    modifier: Modifier = Modifier
) {
    Box(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(container)
            .padding(horizontal = 16.dp, vertical = 14.dp)
    ) {
        Column {
            Text(
                label,
                color = onContainer.copy(alpha = 0.85f),
                style = MaterialTheme.typography.labelMedium
            )
            Text(
                value,
                color = onContainer,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold
            )
        }
    }
}
