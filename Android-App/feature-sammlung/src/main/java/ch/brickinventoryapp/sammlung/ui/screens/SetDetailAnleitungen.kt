package ch.brickinventoryapp.sammlung.ui.screens

import androidx.compose.foundation.layout.heightIn
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.model.ui.model.AnleitungAnsicht
import ch.brickinventoryapp.model.ui.model.SetAnsicht
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.sammlung.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.zustand.ui.*
import ch.brickinventoryapp.sammlung.ui.SetDetailUiState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.*
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.netz.util.eigeneAdresse
import ch.brickinventoryapp.netz.util.externeAdresse
import ch.brickinventoryapp.ui.util.oeffneExtern
import ch.brickinventoryapp.gemeinsam.ui.SectionCard

/**
 * Anleitungen — ansehen, hinzufügen und entfernen. Die Karte steht auch ohne
 * Anleitung, weil sie den Weg trägt, eine erste hinzuzufügen.
 */
internal fun LazyListScope.setDetailInstructionsSection(
    set: SetAnsicht, detailState: SetDetailUiState, serverUrl: String,
    onOpenPdf: (url: String, title: String) -> Unit,
    onAnleitungWaehlen: () -> Unit,
    onAnleitungLoeschen: (Int) -> Unit,
    /** Kein Programm öffnet die Adresse — der Bildschirm meldet es in seinem Gerüst. */
    onKeineApp: () -> Unit,
) {
        // ── Instructions section ───────────────────────────────────────────
        val instructions = set.instructions
        run {
            item {
                SectionCard(
                    title = if (instructions.isNotEmpty())
                        stringResource(R.string.detail_instructions_with_count, instructions.size) else stringResource(R.string.detail_instructions)
                ) {
                    if (detailState.setDetailLoading && instructions.isEmpty()) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                            Text(stringResource(R.string.common_loading),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    } else {
                        instructions.forEachIndexed { idx, instr ->
                            if (idx > 0) HorizontalDivider(
                                Modifier.padding(vertical = Abstaende.winzig),
                                color = MaterialTheme.colorScheme.outlineVariant
                            )
                            AnleitungZeile(instr, serverUrl, onOpenPdf, onAnleitungLoeschen, onKeineApp)
                        }
                        // Der Weg, eine erste Anleitung hinzuzufügen — unter der Liste, weil das
                        // Ansehen häufiger ist; höchstens Bedienbreite, auf dem Tablet nicht über die Spalte.
                        OutlinedButton(
                            onClick = onAnleitungWaehlen,
                            modifier = Modifier.padding(top = Abstaende.klein).fillMaxWidth(),
                            colors = nebenKnopfFarben(),
                            border = nebenKnopfRand(),
                        ) {
                            Icon(Icons.Default.Add, null, Modifier.size(mitSchrift(18.dp)))
                            Spacer(Modifier.width(Abstaende.klein))
                            Text(stringResource(R.string.instr_upload))
                        }
                    }
                }
            }
        }
}

/** Eine Anleitung: Die ganze Zeile öffnet sie, der Papierkorb daneben entfernt eine eigene. */
@Composable
private fun AnleitungZeile(
    instr: AnleitungAnsicht,
    serverUrl: String,
    onOpenPdf: (url: String, title: String) -> Unit,
    onAnleitungLoeschen: (Int) -> Unit,
    onKeineApp: () -> Unit,
) {
    val ctx = LocalContext.current
    // Kein `?token=` an der Adresse: Der Sitzungstoken läge sonst im
    // Backstack, als Text unter der Anleitung und im Zugriffsprotokoll. Der
    // In-App-Betrachter lädt über den geteilten Client, der den
    // Authorization-Kopf setzt (di/ServerClient.kt).
    val eigene = instr.localPath?.let { eigeneAdresse(serverUrl, it) }
    val openUrl = eigene ?: instr.url

    // Die ganze Zeile öffnet die Anleitung — sie sah aus wie ein Verweis.
    // Das Symbol rechts ist nur ein Hinweis, kein zweites Ziel für dieselbe
    // Handlung. Der Papierkorb liegt neben, nicht in der antippbaren Zeile,
    // damit ein Fehlgriff nicht löscht.
    val oeffneAnleitung: () -> Unit = {
        if (eigene != null) {
            onOpenPdf(eigene, instr.description ?: "")
        } else if (!oeffneExtern(ctx, externeAdresse(instr.url))) {
            // Rückmeldung statt Stille, siehe CatalogDetailScreen.
            onKeineApp()
        }
    }
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel)
    ) {
        Row(
            Modifier
                .weight(1f)
                // clickable VOR padding: So gehoert der
                // Innenabstand zur Antippflaeche, und der
                // Druckkreis deckt die ganze Zeilenhoehe.
                // Umgekehrt blieben oben und unten je ein
                // paar totes Pixel.
                .clickable(role = Role.Button, onClick = oeffneAnleitung)
                .heightIn(min = 48.dp)
                .padding(vertical = Abstaende.winzig),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel)
        ) {
            PdfKachel()
            Column(Modifier.weight(1f)) {
                Text(
                    instr.description ?: stringResource(R.string.detail_instruction_default),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    openUrl,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            // Dieselbe Flaeche wie der frühere Knopf, damit
            // die Zeilen so breit bleiben wie bisher.
            Box(Modifier.size(36.dp), Alignment.Center) {
                Icon(
                    Icons.AutoMirrored.Filled.OpenInNew, null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(18.dp)
                )
            }
        }
        AnleitungLoeschen(instr, onAnleitungLoeschen)
    }
}

/** Das PDF-Zeichen vorn in der Zeile; nur Hinweis, nicht antippbar für sich. */
@Composable
private fun PdfKachel() {
    Surface(
        shape = Formen.kachel,
        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.5f),
        modifier = Modifier.size(38.dp)
    ) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Icon(
                Icons.Default.PictureAsPdf, null,
                tint = MaterialTheme.colorScheme.error,
                modifier = Modifier.size(20.dp)
            )
        }
    }
}

/**
 * Entfernen nur bei selbst hochgeladenen Anleitungen (`isManual`):
 * Beide Quellen bringen eine `id`, und weil ihre Zähler unabhängig
 * laufen, könnte ein Klick sonst die gleichnamige eigene Anleitung
 * treffen.
 */
@Composable
private fun AnleitungLoeschen(instr: AnleitungAnsicht, onAnleitungLoeschen: (Int) -> Unit) {
    val id = instr.id
    if (id != null && instr.isManual) {
        MitTooltip(stringResource(R.string.instr_delete)) {
            IconButton(
                onClick = { onAnleitungLoeschen(id) },
            ) {
                Icon(
                    Icons.Default.Delete,
                    stringResource(R.string.instr_delete),
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(18.dp)
                )
            }
        }
    }
}
