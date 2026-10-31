package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.model.StartzustandAnsicht
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * „Der Server startet gerade“ — mit Fortschritt statt einer Fehlermeldung, wie die
 * Webapp über /v1/startup-status. Der erste Start einer Neuinstallation holt den
 * Rebrickable-Katalog und dauert viele Minuten; eine allgemeine Netzmeldung liesse
 * dabei App oder Server kaputt aussehen, obwohl alles richtig läuft.
 *
 * Kein Kringel: Ein unbestimmter Kringel sagt „ich weiss nichts“, der Server nennt
 * aber Schritt und Anzahl. Bei 0 von 0 — er hat noch nicht gezählt — steht ein
 * unbestimmter Balken, sonst der echte Anteil.
 *
 * @param status Der zuletzt gemeldete Stand; nie `ready`, sonst zeigt der Aufrufer
 *         diese Anzeige gar nicht erst.
 */
@Composable
fun ServerStartAnzeige(status: StartzustandAnsicht, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            Modifier.padding(Abstaende.riesig),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
        ) {
            Text(
                stringResource(R.string.startup_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            // Der Schritt kommt fertig uebersetzt vom Server — dieselbe
            // Zeichenkette, die die Webapp anzeigt.
            status.schritt?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center)
            }
            val anteil = status.anteil
            if (anteil != null) {
                LinearProgressIndicator(
                    progress = { anteil },
                    modifier = Modifier.fillMaxWidth().height(6.dp).clip(MaterialTheme.shapes.small),
                )
                Text("${(anteil * 100).toInt()} %",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold)
            } else {
                // Der Server hat noch nicht gezaehlt: unbestimmt, aber sichtbar.
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth().height(6.dp).clip(MaterialTheme.shapes.small),
                )
            }
            status.unterschritt?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(Abstaende.winzig))
            // Der Satz, der die Geduld erklaert. Ohne ihn sieht ein Balken, der
            // sich minutenlang kaum bewegt, wie ein Haenger aus.
            Text(
                stringResource(R.string.startup_hint),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}
