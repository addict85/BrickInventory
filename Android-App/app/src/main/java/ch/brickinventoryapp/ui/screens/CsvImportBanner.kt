package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.brickinventoryapp.R

@Composable
fun CsvImportBanner(
    done: Int, total: Int, current: String?,
    ok: Int, warn: Int, err: Int, running: Boolean
) {
    var expanded by remember { mutableStateOf(false) }
    val pct = if (total > 0) done.toFloat() / total else 0f
    val bg  = if (running) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondaryContainer

    Column {
        Surface(
            color = bg,
            modifier = Modifier.fillMaxWidth().clickable { expanded = !expanded }
        ) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text("📦", fontSize = 14.sp)
                    LinearProgressIndicator(
                        progress = { pct },
                        modifier = Modifier.weight(1f).height(6.dp).clip(MaterialTheme.shapes.small),
                        color = if (running) MaterialTheme.colorScheme.onPrimary
                                else MaterialTheme.colorScheme.primary,
                        trackColor = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.25f)
                    )
                    Text(
                        if (running) "$done/$total" else stringResource(R.string.csv_ok_count, ok),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (running) MaterialTheme.colorScheme.onPrimary
                                else MaterialTheme.colorScheme.onSecondaryContainer,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        if (expanded) "▴" else "▾",
                        color = if (running) MaterialTheme.colorScheme.onPrimary
                                else MaterialTheme.colorScheme.onSecondaryContainer
                    )
                }
                if (running && current != null) {
                    Text(
                        current,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f),
                        modifier = Modifier.padding(top = 2.dp)
                    )
                }
            }
        }
        if (expanded) {
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    listOf(
                        "✅ $ok" to stringResource(R.string.csv_stat_success),
                        "⚠️ $warn" to stringResource(R.string.csv_stat_warnings),
                        "❌ $err" to stringResource(R.string.csv_stat_errors)
                    ).forEach { (v, l) ->
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(v, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            Text(l, style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (!running) {
                        Spacer(Modifier.weight(1f))
                        Text(
                            stringResource(R.string.csv_import_done),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.align(Alignment.CenterVertically)
                        )
                    }
                }
            }
        }
    }
}
