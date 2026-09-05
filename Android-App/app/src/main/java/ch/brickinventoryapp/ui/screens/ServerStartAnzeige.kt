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
import ch.brickinventoryapp.data.model.StartupStatus

/**
 * „Der Server startet gerade" — mit Fortschritt statt einer Fehlermeldung.
 *
 * ── Woher das kommt (Nachtrag 136) ──────────────────────────────────────────
 *
 * Gemessen ueber die Server-Adressen beider Clients: /v1/startup-status war
 * eine der Adressen, die nur die Webapp ruft. Sie zeigt damit einen
 * Fortschrittsbalken, solange der Server hochfaehrt — und der Kommentar dort
 * sagt, warum das noetig ist: Der erste Start einer Neuinstallation holt den
 * Rebrickable-Katalog und dauert VIELE MINUTEN.
 *
 * Die App zeigte in dieser ganzen Zeit ihre allgemeine Netzmeldung. Wer seinen
 * Server frisch aufsetzt und die App oeffnet, sieht „keine Verbindung" und
 * haelt das eine oder das andere fuer kaputt — obwohl alles richtig laeuft.
 *
 * ── Warum kein Kringel ──────────────────────────────────────────────────────
 *
 * Ein unbestimmter Kringel sagt „ich weiss nichts". Hier ist das Gegenteil der
 * Fall: Der Server nennt Schritt und Anzahl. Bei 0 von 0 — er hat noch nicht
 * gezaehlt — steht ein unbestimmter Balken, sonst der echte Anteil.
 *
 * @param status Der zuletzt gemeldete Stand; nie `ready`, sonst zeigt der
 *        Aufrufer diese Anzeige gar nicht erst.
 */
@Composable
fun ServerStartAnzeige(status: StartupStatus, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            Modifier.padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                stringResource(R.string.startup_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            // Der Schritt kommt fertig uebersetzt vom Server — dieselbe
            // Zeichenkette, die die Webapp anzeigt.
            status.step?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center)
            }
            if (status.total > 0) {
                val anteil = status.progress.toFloat() / status.total
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
            status.sub?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(4.dp))
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
