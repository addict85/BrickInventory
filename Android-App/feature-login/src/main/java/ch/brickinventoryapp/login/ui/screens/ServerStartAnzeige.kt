package ch.brickinventoryapp.login.ui.screens

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
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.model.domain.StartStateView
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.outsideTheSystemBars

/**
 * „Der Server startet gerade“ — with progress instead of an error message, like the
 * web app via /v1/startup-status. A fresh install's first start fetches the
 * Rebrickable catalog and takes many minutes; a generic network message would
 * make the app or server look broken, even though everything is running correctly.
 */
@Composable
internal fun ServerStartAnzeige(status: StartStateView, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().outsideTheSystemBars(), contentAlignment = Alignment.Center) {
        Column(
            Modifier.padding(Abstaende.huge),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
        ) {
            Text(
                stringResource(R.string.startup_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            // The step arrives already translated from the server — the same
            // string the web app displays.
            status.schritt?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center)
            }
            val share = status.share
            if (share != null) {
                LinearProgressIndicator(
                    progress = { share },
                    modifier = Modifier.fillMaxWidth().height(6.dp).clip(MaterialTheme.shapes.small),
                )
                Text("${(share * 100).toInt()} %",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold)
            } else {
                // The server has not counted yet: indeterminate, but visible.
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth().height(6.dp).clip(MaterialTheme.shapes.small),
                )
            }
            status.undercut?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(Abstaende.tiny))
            // The sentence that explains the patience. Without it, a bar that
            // barely moves for minutes looks like it is stuck.
            Text(
                stringResource(R.string.startup_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}
