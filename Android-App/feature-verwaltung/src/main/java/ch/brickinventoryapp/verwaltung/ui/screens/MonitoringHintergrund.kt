package ch.brickinventoryapp.verwaltung.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ui.components.Rueckfrage
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.fach.AuftragAnsicht
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.AppKarte
import ch.brickinventoryapp.ui.components.Abschnittstitel
import ch.brickinventoryapp.verwaltung.ui.viewmodel.HintergrundUiState
import ch.brickinventoryapp.ui.util.fmtTag
import ch.brickinventoryapp.model.ui.fehlerMeldung
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.ui.satz

/**
 * Die Hintergrundarbeiten aus der Auftragstabelle, wie in der Webapp. Die
 * Warnung ohne Job-Prozess steht oben: Ohne ihn bewegt sich keiner der
 * Aufträge darunter, und das soll man nicht aus stehenden Zahlen erraten müssen.
 */
@Composable
internal fun HintergrundSection(
    zustand: HintergrundUiState,
    onStarten: (art: String, name: String) -> Unit,
    onLeeren: (art: String) -> Unit,
    onAbbrechen: (id: String) -> Unit,
    onWiederholen: (id: String) -> Unit,
) {
    val ansicht = zustand.ansicht
    AppKarte {
        Column(Modifier.padding(Abstaende.gross), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            // „Aufträge“, nicht noch einmal der Name der Seite: Er steht schon darüber.
            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                Abschnittstitel(stringResource(R.string.hintergrund_auftraege))
                if (zustand.abruf.laedt) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            }
            zustand.abruf.fehlerMeldung?.let { Text(it.satz(), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            if (ansicht != null && !ansicht.jobProzessLaeuft) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                    Text(stringResource(R.string.hintergrund_kein_prozess), color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (ansicht == null) return@Column
            for (p in ansicht.pausen) {
                Text(stringResource(R.string.hintergrund_pause, auftragsArtText(p.art)?.let { stringResource(it) } ?: p.art,
                    fmtTag(p.bis) ?: "—", p.grund), style = MaterialTheme.typography.bodySmall)
            }
            if (ansicht.bildbedarf > 0) Text(pluralStringResource(R.plurals.hintergrund_bildbedarf,
                ansicht.bildbedarf, ansicht.bildbedarf), style = MaterialTheme.typography.bodySmall)
            if (ansicht.auftraege.isEmpty()) {
                Text(stringResource(R.string.hintergrund_leer), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            for ((art, gruppe) in ansicht.auftraege.groupBy { it.art }) {
                AuftragsGruppe(art, gruppe, onStarten, onLeeren, onAbbrechen, onWiederholen)
            }
        }
    }
}

/**
 * Die Aufträge einer Art unter ihrem Kopf mit „Jetzt“ und „Leeren“. Leeren fragt nach:
 * Entfernte Aufträge kommen nicht wieder. TalkBack hört bei jedem Knopf die Auftragsart,
 * sonst stünden fünfmal „Leeren“ untereinander.
 */
@Composable
private fun AuftragsGruppe(
    art: String,
    gruppe: List<AuftragAnsicht>,
    onStarten: (art: String, name: String) -> Unit,
    onLeeren: (art: String) -> Unit,
    onAbbrechen: (id: String) -> Unit,
    onWiederholen: (id: String) -> Unit,
) {
    HorizontalDivider()
    val name = auftragsArtText(art)?.let { stringResource(it) } ?: art
    var leerenFragen by rememberSaveable(art) { mutableStateOf(false) }
    if (leerenFragen) {
        Rueckfrage(
            titel = stringResource(R.string.hintergrund_leeren_titel),
            text = stringResource(R.string.hintergrund_leeren_text, name),
            bestaetigen = stringResource(R.string.hintergrund_leeren),
            onBestaetigen = { leerenFragen = false; onLeeren(art) },
            onAbbrechen = { leerenFragen = false },
        )
    }
    val jetztName = stringResource(R.string.hintergrund_jetzt_cd, name)
    val leerenName = stringResource(R.string.hintergrund_leeren_cd, name)
    Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
        Text(name, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        TextButton(onClick = { onStarten(art, name) }, modifier = Modifier.semantics { contentDescription = jetztName }) {
            Text(stringResource(R.string.hintergrund_jetzt))
        }
        TextButton(onClick = { leerenFragen = true }, modifier = Modifier.semantics { contentDescription = leerenName }) {
            Text(stringResource(R.string.hintergrund_leeren))
        }
    }
    for (a in gruppe) AuftragZeile(a, name,
        onAbbrechen = { onAbbrechen(a.id) },
        onWiederholen = { onWiederholen(a.id) })
}

/** Ein Auftrag; seine Knöpfe heissen „Auftrag abbrechen“, nicht „Abbrechen“ wie in jedem Dialog. */
@Composable
private fun AuftragZeile(a: AuftragAnsicht, artName: String, onAbbrechen: () -> Unit, onWiederholen: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            val kopf = listOfNotNull(
                a.status.statusText?.let { stringResource(it) },
                a.setNumber,
                a.fortschrittText,
                if (a.versuch > 1) stringResource(R.string.hintergrund_versuch, a.versuch, a.maxVersuche) else null,
            ).joinToString(" · ")
            Text(kopf, style = MaterialTheme.typography.bodyMedium)
            a.faelligAb?.let { zeit ->
                Text(stringResource(if (a.geplant) R.string.hintergrund_geplant else R.string.hintergrund_faellig,
                    fmtTag(zeit) ?: zeit), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            a.fehler?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        }
        val wer = listOfNotNull(artName, a.setNumber).joinToString(" ")
        if (a.abbrechbar) AuftragKnopf(stringResource(R.string.hintergrund_abbrechen), wer, onAbbrechen)
        if (a.wiederholbar) AuftragKnopf(stringResource(R.string.hintergrund_auftrag_wiederholen), wer, onWiederholen)
    }
}

/** Ein Knopf an einem Auftrag; vorgelesen mit Art und Set („Auftrag abbrechen: Bilder eines Sets 75192-1“). */
@Composable
private fun AuftragKnopf(aktion: String, wer: String, onClick: () -> Unit) {
    val name = stringResource(R.string.aktion_fuer, aktion, wer)
    TextButton(onClick = onClick, modifier = Modifier.semantics { contentDescription = name }) { Text(aktion) }
}
