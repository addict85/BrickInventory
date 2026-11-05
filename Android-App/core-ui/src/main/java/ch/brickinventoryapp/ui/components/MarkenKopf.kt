package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen

/**
 * Der Kopf von Einrichten und Anmelden: Logo in gerahmter Kachel, Name, darunter
 * auf Wunsch ein Satz. Beide Bildschirme folgen direkt aufeinander und sahen
 * verschieden aus (Logo ohne Rahmen, Name zweizeilig).
 * Die Kachel liegt auf surface: Auf manchem primary verschwand der rote Stein.
 */
@Composable
fun MarkenKopf(modifier: Modifier = Modifier, untertitel: String? = null) {
    // Bei grosser Schrift klein in einer Zeile: Kachel und zweizeiliger Name nahmen bei
    // 200 % ein Viertel der Seite, und das erste Feld lag unter dem Falz.
    if (grosseSchrift()) {
        Column(modifier, horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                Image(painterResource(R.drawable.ic_logo), contentDescription = null, modifier = Modifier.size(32.dp))
                Text(stringResource(R.string.app_name), fontWeight = FontWeight.ExtraBold,
                    style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
            }
            if (untertitel != null) Text(untertitel, style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
        return
    }
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
        Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.size(80.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Image(painterResource(R.drawable.ic_logo), contentDescription = null, modifier = Modifier.size(64.dp))
            }
        }
        Spacer(Modifier.height(Abstaende.mittel))
        Text(stringResource(R.string.app_name), fontWeight = FontWeight.ExtraBold,
            style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center,
            modifier = Modifier.semantics { heading() })
        if (untertitel != null) Text(untertitel, style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
}

/**
 * Die Karte unter dem Markenkopf: Anmelden, Registrieren, Startpasswort und zweiter
 * Faktor stehen gleich gerahmt da. Vorher lagen die beiden Pflichtmasken frei auf dem
 * Grund, mit anderer Überschrift — es sah nach zwei Apps aus.
 */
@Composable
fun AnmeldeKarte(modifier: Modifier = Modifier, inhalt: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = Formen.chip,
        elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebungHoch),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 22.dp),
            verticalArrangement = Arrangement.spacedBy(Abstaende.mittel), content = inhalt)
    }
}

/** Die Überschrift in einer [AnmeldeKarte] — dieselbe für jede der vier Masken. */
@Composable
fun AnmeldeTitel(text: String) {
    Text(text, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.semantics { heading() })
}
