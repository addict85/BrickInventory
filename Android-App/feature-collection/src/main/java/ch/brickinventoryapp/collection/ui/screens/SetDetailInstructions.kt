package ch.brickinventoryapp.collection.ui.screens

import ch.brickinventoryapp.model.ui.loading
import androidx.compose.foundation.layout.heightIn
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.model.domain.InstructionView
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.ui.theme.Shapes
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
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.collection.ui.SetDetailUiState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.*
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.network.util.ownAddress
import ch.brickinventoryapp.network.util.externalAddress
import ch.brickinventoryapp.ui.util.openExtern
import ch.brickinventoryapp.shared.ui.SectionCard

/**
 * Manuals — view, add and remove. The card exists even with no
 * manual, because it carries the path to add a first one.
 */
internal fun LazyListScope.setDetailInstructionsSection(
    set: SetView, detailState: SetDetailUiState, serverUrl: String,
    onOpenPdf: (url: String, title: String) -> Unit,
    onInstructionChoose: () -> Unit,
    onInstructionDelete: (Int) -> Unit,
    /** No app opens the address — the screen reports it in its own scaffold. */
    onNoApp: () -> Unit,
) {
        // ── Instructions section ───────────────────────────────────────────
        val instructions = set.instructions
        run {
            item {
                SectionCard(
                    title = if (instructions.isNotEmpty())
                        stringResource(R.string.detail_instructions_with_count, instructions.size) else stringResource(R.string.detail_instructions)
                ) {
                    if (detailState.detailFetch.loading && instructions.isEmpty()) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(Spacing.small),
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
                                Modifier.padding(vertical = Spacing.tiny),
                                color = MaterialTheme.colorScheme.outlineVariant
                            )
                            InstructionRow(instr, serverUrl, onOpenPdf, onInstructionDelete, onNoApp)
                        }
                        // The path to add a first manual — below the list, because
                        // viewing is more common; at most control width, not across the column on the tablet.
                        OutlinedButton(
                            onClick = onInstructionChoose,
                            modifier = Modifier.padding(top = Spacing.small).fillMaxWidth(),
                            colors = secondaryButtonColors(),
                            border = secondaryButtonRand(),
                        ) {
                            Icon(Icons.Default.Add, null, Modifier.size(withFont(18.dp)))
                            Spacer(Modifier.width(Spacing.small))
                            Text(stringResource(R.string.instr_upload))
                        }
                    }
                }
            }
        }
}

/** A manual: the whole row opens it, the trash icon next to it removes its own. */
@Composable
private fun InstructionRow(
    instr: InstructionView,
    serverUrl: String,
    onOpenPdf: (url: String, title: String) -> Unit,
    onInstructionDelete: (Int) -> Unit,
    onNoApp: () -> Unit,
) {
    val ctx = LocalContext.current
    // No `?token=` in the address: the session token would otherwise sit in the
    // back stack, as text under the manual and in the access log. The
    // in-app viewer loads via the shared client, which sets the
    // Authorization header (di/ServerClient.kt).
    val own = instr.localPath?.let { ownAddress(serverUrl, it) }
    val openUrl = own ?: instr.url

    // The whole row opens the manual — it looked like a reference.
    // The icon on the right is only a hint, not a second destination for the same
    // action. The trash icon sits beside, not inside, the tappable row,
    // so a mistap doesn't delete.
    val openInstruction: () -> Unit = {
        if (own != null) {
            onOpenPdf(own, instr.description ?: "")
        } else if (!openExtern(ctx, externalAddress(instr.url))) {
            // Feedback instead of silence, see CatalogDetailScreen.
            onNoApp()
        }
    }
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.medium)
    ) {
        Row(
            Modifier
                .weight(1f)
                // clickable BEFORE padding: this way the
                // inner padding belongs to the tap area, and the
                // press ripple covers the whole row height.
                // The other way round, a few dead pixels would remain
                // at the top and bottom.
                .clickable(role = Role.Button, onClick = openInstruction)
                .heightIn(min = 48.dp)
                .padding(vertical = Spacing.tiny),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.medium)
        ) {
            PdfTile()
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
            // The same surface as the earlier button, so
            // the rows stay as wide as before.
            Box(Modifier.size(36.dp), Alignment.Center) {
                Icon(
                    Icons.AutoMirrored.Filled.OpenInNew, null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(18.dp)
                )
            }
        }
        InstructionDelete(instr, onInstructionDelete)
    }
}

/** The PDF icon at the front of the row; only a hint, not tappable on its own. */
@Composable
private fun PdfTile() {
    Surface(
        shape = Shapes.tile,
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
 * Removal only for self-uploaded manuals (`isManual`):
 * both sources deliver an `id`, and because their counters run
 * independently, a click could otherwise hit the
 * same-named own manual.
 */
@Composable
private fun InstructionDelete(instr: InstructionView, onInstructionDelete: (Int) -> Unit) {
    val id = instr.id
    if (id != null && instr.isManual) {
        WithTooltip(stringResource(R.string.instr_delete)) {
            IconButton(
                onClick = { onInstructionDelete(id) },
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
