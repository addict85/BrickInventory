package ch.brickinventoryapp.verwaltung.ui.screens

import ch.brickinventoryapp.model.ui.model.BricksetEintragAnsicht
import ch.brickinventoryapp.model.ui.model.ZeitplanAnsicht
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.model.ui.model.*
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import androidx.compose.ui.text.font.FontFamily
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringAktionen
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.verwaltung.ui.*
import ch.brickinventoryapp.zustand.ui.*
import kotlinx.coroutines.launch
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.mitSchrift

/**
 * Die Abschnitte der Überwachungsseite unterhalb der Job-Liste — ganze Funktionen
 * aus MonitoringScreen.kt, keine zerschnittenen Rümpfe.
 */

@Composable
/**
 * `internal`, weil der Aufrufer in einer anderen Datei steht und `private` in
 * Kotlin dateiweit gilt.
 */
internal fun BricksetQueueRow(
    entry: BricksetEintragAnsicht,
    onRetry: (String) -> Unit,
    onDelete: (String) -> Unit
) {
    var showError by rememberSaveable { mutableStateOf(false) }

    Surface(
        shape = Formen.kachel,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(entry.setNumber, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
                    entry.name?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(stringResource(R.string.monitoring_retry_attempt, entry.attempts, entry.retryAfter ?: "—"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                BricksetAktionen(entry, onRetry, onDelete)
            }

            // Last error expandable. Lokal gelesen: Über die Modulgrenze (core-model)
            // gibt es keinen Smart Cast.
            val letzterFehler = entry.lastError
            if (!letzterFehler.isNullOrBlank()) {
                TextButton(
                    onClick = { showError = !showError },
                    contentPadding = PaddingValues(0.dp),
                    modifier = Modifier.heightIn(min = 24.dp)
                ) {
                    Text(if (showError) stringResource(R.string.monitoring_hide_error) else stringResource(R.string.monitoring_show_error),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error)
                }
                AnimatedVisibility(showError) {
                    Surface(
                        shape = Formen.marke,
                        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.4f)
                    ) {
                        Text(
                            letzterFehler,
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(Abstaende.klein)
                        )
                    }
                }
            }
        }
    }
}

/** Erneut versuchen und Löschen eines Eintrags der Brickset-Warteschlange. */
@Composable
private fun BricksetAktionen(
    entry: BricksetEintragAnsicht,
    onRetry: (String) -> Unit,
    onDelete: (String) -> Unit
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
        MitTooltip(stringResource(R.string.monitoring_icon_retry)) {
            FilledTonalIconButton(onClick = { onRetry(entry.setNumber) }) {
                Icon(Icons.Default.Refresh, stringResource(R.string.monitoring_icon_retry), Modifier.size(mitSchrift(14.dp)))
            }
        }
        MitTooltip(stringResource(R.string.common_delete)) {
            FilledTonalIconButton(
                onClick = { onDelete(entry.setNumber) },
                colors = IconButtonDefaults.filledTonalIconButtonColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer
                )
            ) {
                Icon(Icons.Default.Delete, stringResource(R.string.common_delete), Modifier.size(mitSchrift(14.dp)),
                    tint = MaterialTheme.colorScheme.onErrorContainer)
            }
        }
    }
}

/**
 * Der Zeitplan eines Jobs — anzeigen und ändern, wie in der Webapp. Tägliche Jobs
 * haben eine Uhrzeit, der Preis-Job einen Abstand in Minuten; der Server
 * unterscheidet am Feld und normalisiert beides („7:5“ → „07:05“, mindestens fünf
 * Minuten). Deshalb wird nach dem Speichern neu geladen: Es soll dastehen, was
 * gilt.
 */
@Composable
internal fun ZeitplanZeile(
    jobKey: String,
    plan: ZeitplanAnsicht,
    aktionen: MonitoringAktionen,
    onSnack: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val gespeichert = stringResource(R.string.monitoring_cache_saved)
    val taeglich = plan.type == "daily"
    var bearbeiten by rememberSaveable(jobKey) { mutableStateOf(false) }
    val gezeigt = if (taeglich) plan.time.orEmpty() else (plan.minutes ?: 60).toString()
    var eingabe by rememberSaveable(jobKey, gezeigt) { mutableStateOf(gezeigt) }

    Row(
        Modifier.fillMaxWidth(),
        Arrangement.SpaceBetween,
        Alignment.CenterVertically,
    ) {
        Text(
            stringResource(if (taeglich) R.string.monitoring_schedule_daily
                           else R.string.monitoring_schedule_every),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (bearbeiten) {
            ZeitplanEingabe(taeglich, eingabe, onEingabe = { eingabe = it },
                onSpeichern = {
                    scope.launch {
                        val ok = if (taeglich) aktionen.setzeJobZeitplan(jobKey, zeit = eingabe.trim())
                                 else aktionen.setzeJobZeitplan(jobKey, minuten = eingabe.toIntOrNull() ?: 60)
                        if (ok) onSnack(gespeichert)
                        bearbeiten = false
                    }
                },
                onAbbrechen = { bearbeiten = false })
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (taeglich) plan.time.orEmpty()
                    else stringResource(R.string.monitoring_schedule_minutes, plan.minutes ?: 60),
                    fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium,
                )
                MitTooltip(stringResource(R.string.cd_edit_schedule)) {
                    FilledTonalIconButton(
                        onClick = { bearbeiten = true },
                    ) { Icon(Icons.Default.Edit, stringResource(R.string.cd_edit_schedule), Modifier.size(mitSchrift(14.dp))) }
                }
            }
        }
    }
}

/** Das Eingabefeld des Zeitplans mit Speichern und Abbrechen. */
@Composable
private fun ZeitplanEingabe(
    taeglich: Boolean,
    eingabe: String,
    onEingabe: (String) -> Unit,
    onSpeichern: () -> Unit,
    onAbbrechen: () -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = eingabe,
            onValueChange = {
                // Bei Minuten nur Ziffern; bei der Uhrzeit auch der
                // Doppelpunkt — sonst liesse sich „03:00" nicht tippen.
                onEingabe(if (taeglich) it.filter { z -> z.isDigit() || z == ':' }.take(5)
                          else NumericInput.quantity(it))
            },
            // Aus den Sprachdateien, nicht als Klartext: „Min." und
            // „min" sind kurz, aber sie stehen im Bild und werden
            // gelesen. StringResourceParityTest hat genau das gemeldet.
            suffix = { if (!taeglich) Text(stringResource(R.string.monitoring_schedule_unit)) },
            modifier = Modifier.width(if (taeglich) 96.dp else 90.dp),
            singleLine = true,
            shape = Formen.kachel,
            keyboardOptions = NumericInput.ganzzahlTastatur(),
        )
        FilledTonalButton(
            onClick = onSpeichern,
            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp),
        ) { Text(stringResource(R.string.common_ok), style = MaterialTheme.typography.labelMedium) }
        MitTooltip(stringResource(R.string.common_cancel)) {
            IconButton(onClick = onAbbrechen) {
                Icon(Icons.Default.Close, stringResource(R.string.common_cancel))
            }
        }
    }
}
