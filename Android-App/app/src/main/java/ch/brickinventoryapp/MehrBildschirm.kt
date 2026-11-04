package ch.brickinventoryapp

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.CompareArrows
import androidx.compose.material.icons.automirrored.outlined.ListAlt
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Assessment
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.Redeem
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.UploadFile
import androidx.compose.material3.Badge
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import ch.brickinventoryapp.ui.components.Rueckfrage
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.navigation.NavGraph.Companion.findStartDestination
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.Screen
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.theme.mittigBis

/**
 * Das Ziel „Mehr“ der unteren Leiste: alle Seiten, die kein Bestandsreiter sind, in
 * Gruppen auf EINER Seite. Alle Symbole umrandet, wie Material es für Listen vorsieht:
 * Gefüllte neben umrandeten lasen sich wie ein Unterschied, den es nicht gibt. Vorher verteilten sie sich auf Schublade und Kontomenü —
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
    // Abmelden beendet die Sitzung auf diesem Gerät; ein Fehltipp im Menü hiesse
    // Passwort und zweiter Faktor von vorn. Darum fragt es nach wie Set löschen.
    var fragtAbmelden by rememberSaveable { mutableStateOf(false) }
    if (fragtAbmelden) Rueckfrage(
        titel = stringResource(R.string.logout_confirm_title),
        text = stringResource(R.string.logout_confirm_text),
        bestaetigen = stringResource(R.string.main_menu_logout),
        onBestaetigen = { fragtAbmelden = false; onAbmelden() },
        onAbbrechen = { fragtAbmelden = false },
        symbol = Icons.AutoMirrored.Outlined.Logout,
    )
    // Je Gruppe ein Block; `trenner` fällt am Kopf einer Spalte weg.
    @Composable
    fun Gruppe(nummer: Int, trenner: Boolean) {
        when (nummer) {
            0 -> {
                MehrGruppe(R.string.nav_group_prices, trenner)
                // Gutscheine zuerst: Die braucht man im Laden.
                MehrEintrag(R.string.vouchers_title, Icons.Outlined.Redeem) { navController.navigate(Screen.Gutscheine.route) }
                MehrEintrag(R.string.alerts_group, Icons.Outlined.NotificationsActive) { navController.navigate(Screen.Preisalarme.route) }
                MehrEintrag(R.string.nav_comparison, Icons.AutoMirrored.Outlined.CompareArrows) { navController.navigate(Screen.Comparison.route) }
            }
            1 -> {
                MehrGruppe(R.string.nav_group_tools, trenner)
                MehrEintrag(R.string.nav_partslist, Icons.AutoMirrored.Outlined.ListAlt) { navController.navigate(Screen.PartsList.route) }
                MehrEintrag(R.string.csv_upload_title, Icons.Outlined.UploadFile) { navController.navigate(Screen.CsvImport.route) }
            }
            2 -> {
                MehrGruppe(R.string.nav_group_manage, trenner)
                MehrEintrag(R.string.storage_manage, Icons.Outlined.Inventory2) { navController.navigate(Screen.Lagerorte.route) }
                MehrEintrag(R.string.household_title, Icons.Outlined.Group) { navController.navigate(Screen.Haushalt.route) }
            }
            3 -> {
                MehrGruppe(R.string.nav_group_account, trenner)
                MehrEintrag(R.string.konto_title, Icons.Outlined.AccountCircle) { navController.navigate(Screen.Konto.route) }
                // Der Punkt allein sagte nicht, wofür er steht: Darunter steht es in Worten.
                MehrEintrag(R.string.nav_settings, Icons.Outlined.Settings, punkt = updateVerfuegbar) {
                    navController.navigate(Screen.Settings.route) { launchSingleTop = true }
                }
            }
            else -> {
                MehrGruppe(R.string.nav_group_server, trenner)
                MehrEintrag(R.string.main_menu_monitoring, Icons.Outlined.Assessment) {
                    navController.navigate(Screen.Monitoring.route) {
                        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = false
                    }
                }
            }
        }
    }
    // Abmelden für sich am Ende, abgesetzt: Zwischen den Einstellungen sah es aus wie
    // eine von ihnen, beendet aber die Sitzung.
    @Composable
    fun Abmelden() {
        HorizontalDivider(Modifier.padding(top = Abstaende.klein, bottom = Abstaende.klein))
        MehrEintrag(R.string.main_menu_logout, Icons.AutoMirrored.Outlined.Logout) { fragtAbmelden = true }
    }
    // Die Servergruppe nur für Verwalter.
    val gruppen = if (isAdmin) 5 else 4
    // Auf dem Tablet zwei Spalten: Einspaltig stand die Liste schmal in der Mitte einer
    // leeren Fläche. Preise und Werkzeuge links, Bestand und Konto rechts.
    BoxWithConstraints(modifier.fillMaxSize()) {
        val zweispaltig = maxWidth >= MEHR_ZWEISPALTIG_AB
        val rahmen = Modifier.fillMaxSize().verticalScroll(rememberScrollState())
            .mittigBis(if (zweispaltig) Lesebreite.liste else Lesebreite.formular).padding(vertical = Abstaende.klein)
        if (zweispaltig) Row(rahmen, horizontalArrangement = Arrangement.spacedBy(Abstaende.sehrGross)) {
            Column(Modifier.weight(1f)) { for (i in 0 until 2) Gruppe(i, trenner = i > 0) }
            Column(Modifier.weight(1f)) { for (i in 2 until gruppen) Gruppe(i, trenner = i > 2); Abmelden() }
        } else Column(rahmen) { for (i in 0 until gruppen) Gruppe(i, trenner = i > 0); Abmelden() }
    }
}

/** Ab dieser Fensterbreite stehen die Gruppen in zwei Spalten. */
private val MEHR_ZWEISPALTIG_AB = 840.dp

/** Überschrift einer Gruppe — Vorleseprogramme springen von einer zur nächsten. */
@Composable
private fun MehrGruppe(titel: Int, trenner: Boolean) =
    ch.brickinventoryapp.ui.components.Gruppentitel(stringResource(titel), trenner = trenner)

/** Ein Eintrag: Symbol, Text, ganze Zeile antippbar (mindestens 56 dp hoch). */
@Composable
private fun MehrEintrag(titel: Int, symbol: ImageVector, punkt: Boolean = false, onKlick: () -> Unit) {
    ListItem(
        headlineContent = { Text(stringResource(titel)) },
        supportingContent = if (punkt) ({ Text(stringResource(R.string.update_badge)) }) else null,
        leadingContent = { Icon(symbol, null, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
        // Der Text darunter sagt es schon; der Punkt bleibt ohne zweite Ansage.
        trailingContent = if (punkt) ({ Badge() }) else null,
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.clickable(role = Role.Button, onClick = onKlick),
    )
}

