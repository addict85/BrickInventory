package ch.brickinventoryapp

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.CompareArrows
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Assessment
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.Redeem
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material3.Badge
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.navigation.NavController
import androidx.navigation.NavGraph.Companion.findStartDestination
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.Screen
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.theme.mittigBis

/**
 * Das Ziel „Mehr“ der unteren Leiste: alle Seiten, die kein Bestandsreiter sind, in
 * Gruppen auf EINER Seite. Vorher verteilten sie sich auf Schublade und Kontomenü —
 * mit Leiste und Umschalter vier Navigationsebenen. Jede Route steht ausgeschrieben
 * da, weil ErreichbareRoutenTest nach `navigate(Screen.X.route)` sucht.
 */
@Composable
fun MehrBildschirm(
    navController: NavController,
    isAdmin: Boolean,
    updateVerfuegbar: Boolean,
    onAbmelden: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).mittigBis(Lesebreite.formular)
        .padding(vertical = Abstaende.klein)) {
        MehrGruppe(R.string.nav_group_prices, trenner = false)
        // Gutscheine zuerst: Die braucht man im Laden.
        MehrEintrag(R.string.vouchers_title, Icons.Default.Redeem) { navController.navigate(Screen.Gutscheine.route) }
        MehrEintrag(R.string.alerts_group, Icons.Default.NotificationsActive) { navController.navigate(Screen.Preisalarme.route) }
        MehrEintrag(R.string.nav_comparison, Icons.AutoMirrored.Filled.CompareArrows) { navController.navigate(Screen.Comparison.route) }
        MehrGruppe(R.string.nav_group_tools)
        MehrEintrag(R.string.nav_partslist, Icons.AutoMirrored.Filled.ListAlt) { navController.navigate(Screen.PartsList.route) }
        MehrEintrag(R.string.csv_upload_title, Icons.Default.UploadFile) { navController.navigate(Screen.CsvImport.route) }
        MehrGruppe(R.string.nav_group_manage)
        MehrEintrag(R.string.storage_manage, Icons.Default.Inventory2) { navController.navigate(Screen.Lagerorte.route) }
        MehrEintrag(R.string.household_title, Icons.Default.Group) { navController.navigate(Screen.Haushalt.route) }
        MehrGruppe(R.string.nav_group_account)
        MehrEintrag(R.string.konto_title, Icons.Default.AccountCircle) { navController.navigate(Screen.Konto.route) }
        // Der Punkt sagt, dass eine neue Version bereitliegt; nachsehen kann man in den Einstellungen.
        MehrEintrag(R.string.nav_settings, Icons.Default.Settings, punkt = updateVerfuegbar) {
            navController.navigate(Screen.Settings.route) { launchSingleTop = true }
        }
        MehrEintrag(R.string.main_menu_logout, Icons.AutoMirrored.Filled.Logout) { onAbmelden() }
        if (isAdmin) {
            MehrGruppe(R.string.nav_group_server)
            MehrEintrag(R.string.main_menu_monitoring, Icons.Default.Assessment) {
                navController.navigate(Screen.Monitoring.route) {
                    popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                    launchSingleTop = true
                    restoreState = false
                }
            }
        }
    }
}

/** Überschrift einer Gruppe — Vorleseprogramme springen von einer zur nächsten. */
@Composable
private fun MehrGruppe(titel: Int, trenner: Boolean = true) {
    if (trenner) HorizontalDivider(Modifier.padding(top = Abstaende.klein))
    Text(stringResource(titel), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = Abstaende.gross, end = Abstaende.gross, top = Abstaende.gross, bottom = Abstaende.winzig)
            .semantics { heading() })
}

/** Ein Eintrag: Symbol, Text, ganze Zeile antippbar (mindestens 56 dp hoch). */
@Composable
private fun MehrEintrag(titel: Int, symbol: ImageVector, punkt: Boolean = false, onKlick: () -> Unit) {
    ListItem(
        headlineContent = { Text(stringResource(titel)) },
        leadingContent = { Icon(symbol, null, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
        trailingContent = if (punkt) ({ Badge() }) else null,
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.clickable(role = Role.Button, onClick = onKlick),
    )
}

