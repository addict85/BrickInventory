package ch.brickinventoryapp.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import ch.brickinventoryapp.ui.components.Prompt
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.takeOrElse
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.navigation.NavGraph.Companion.findStartDestination
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.theme.centeredUntil
import ch.brickinventoryapp.ui.components.GroupTitle
import ch.brickinventoryapp.finances.ui.FinanzZiel
import ch.brickinventoryapp.account.ui.KontoZiel
import ch.brickinventoryapp.collection.ui.SammlungZiel
import ch.brickinventoryapp.parts.ui.TeileZiel
import ch.brickinventoryapp.management.ui.ManagementTarget

/**
 * Das Ziel „Mehr“ der unteren Leiste: alle Seiten, die kein Bestandsreiter sind, in
 * Gruppen auf EINER Seite. Alle Symbole umrandet, wie Material es für Listen vorsieht:
 * Gefüllte neben umrandeten lasen sich wie ein Unterschied, den es nicht gibt. Der
 * Bildschirm nennt nur das Ziel; wie dorthin navigiert wird, entscheidet der Graph
 * ([openOfMore]).
 */
@Composable
fun MehrBildschirm(
    onTarget: (Any) -> Unit,
    isAdmin: Boolean,
    updateVerfuegbar: Boolean,
    onAbmelden: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Abmelden beendet die Sitzung auf diesem Gerät; ein Fehltipp im Menü hiesse
    // Passwort und zweiter Faktor von vorn. Darum fragt es nach wie Set löschen.
    var signOutAsks by rememberSaveable { mutableStateOf(false) }
    if (signOutAsks) Prompt(
        titel = stringResource(R.string.logout_confirm_title),
        text = stringResource(R.string.logout_confirm_text),
        bestaetigen = stringResource(R.string.main_menu_logout),
        onBestaetigen = { signOutAsks = false; onAbmelden() },
        onAbbrechen = { signOutAsks = false },
        symbol = Icons.AutoMirrored.Outlined.Logout,
    )
    @Composable
    fun Gruppe(nummer: Int, separator: Boolean) = MehrGruppeInhalt(nummer, separator, updateVerfuegbar, onTarget)
    // Die Servergruppe nur für Verwalter.
    val groups = if (isAdmin) 5 else 4
    // Auf dem Tablet zwei Spalten, etwa gleich hoch: Preise, Werkzeuge und Server links,
    // Bestand und Konto rechts. Einspaltig stand die Liste schmal in einer leeren Fläche.
    BoxWithConstraints(modifier.fillMaxSize()) {
        val twoColumn = maxWidth >= MORE_TWO_COLUMN_AB
        val frame = Modifier.fillMaxSize().verticalScroll(rememberScrollState())
            .centeredUntil(if (twoColumn) Lesebreite.liste else Lesebreite.formular).padding(vertical = Abstaende.klein)
        Column(frame) {
            if (twoColumn) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Abstaende.veryLarge)) {
                Column(Modifier.weight(1f)) { listOf(0, 1, 4).filter { it < groups }.forEachIndexed { i, g -> Gruppe(g, separator = i > 0) } }
                Column(Modifier.weight(1f)) { Gruppe(2, separator = false); Gruppe(3, separator = true) }
            } else for (i in 0 until groups) Gruppe(i, separator = i > 0)
            SignOutEntry { signOutAsks = true }
        }
    }
}

/**
 * Abmelden zuletzt und abgesetzt, in der Fehlerfarbe: Zwischen „Einstellungen“ und den
 * Servergruppen war es ein Eintrag wie jeder andere und lag dort, wo man weitertippt.
 */
@Composable
private fun SignOutEntry(onKlick: () -> Unit) {
    HorizontalDivider(Modifier.padding(vertical = Abstaende.klein))
    MehrEintrag(R.string.main_menu_logout, Icons.AutoMirrored.Outlined.Logout,
        farbe = MaterialTheme.colorScheme.error, onKlick = onKlick)
}

/**
 * Je Gruppe ein Block; `separator` fällt am Kopf einer Spalte weg. Eine Gruppe, eine
 * Art Seite: Werkzeuge behalten die untere Leiste, Preise und Verwalten öffnen
 * Unterseiten. Gemischt sah „Vergleich“ neben „Gutscheine“ anders aus als erwartet.
 */
@Composable
private fun MehrGruppeInhalt(nummer: Int, separator: Boolean, updateVerfuegbar: Boolean, onTarget: (Any) -> Unit) {
    when (nummer) {
        0 -> {
            MoreGroup(R.string.nav_group_prices, separator)
            // Gutscheine zuerst: Die braucht man im Laden.
            MehrEintrag(R.string.vouchers_title, Icons.Outlined.Redeem) { onTarget(FinanzZiel.Gutscheine) }
            MehrEintrag(R.string.alerts_group, Icons.Outlined.NotificationsActive) { onTarget(KontoZiel.Preisalarme) }
        }
        1 -> {
            MoreGroup(R.string.nav_group_tools, separator)
            MehrEintrag(R.string.nav_comparison, Icons.AutoMirrored.Outlined.CompareArrows) { onTarget(SammlungZiel.Comparison) }
            MehrEintrag(R.string.nav_partslist, Icons.AutoMirrored.Outlined.ListAlt) { onTarget(TeileZiel.PartsList) }
        }
        2 -> {
            MoreGroup(R.string.nav_group_manage, separator)
            MehrEintrag(R.string.storage_manage, Icons.Outlined.Inventory2) { onTarget(KontoZiel.Lagerorte) }
            MehrEintrag(R.string.household_title, Icons.Outlined.Group) { onTarget(KontoZiel.Haushalt) }
            MehrEintrag(R.string.csv_upload_title, Icons.Outlined.UploadFile) { onTarget(KontoZiel.CsvImport) }
        }
        3 -> {
            MoreGroup(R.string.nav_group_account, separator)
            MehrEintrag(R.string.konto_title, Icons.Outlined.AccountCircle) { onTarget(KontoZiel.Konto) }
            // Der Punkt allein sagte nicht, wofür er steht: Darunter steht es in Worten.
            MehrEintrag(R.string.nav_settings, Icons.Outlined.Settings, point = updateVerfuegbar) { onTarget(KontoZiel.Settings) }
        }
        else -> {
            MoreGroup(R.string.nav_group_server, separator)
            MehrEintrag(R.string.main_menu_monitoring, Icons.Outlined.Assessment) { onTarget(ManagementTarget.Monitoring) }
        }
    }
}

/**
 * Öffnet ein Ziel der Seite „Mehr“. Die Einstellungen stapeln sich nicht doppelt; das
 * Monitoring steht wie ein Reiter direkt über dem Start, damit „Zurück“ nicht durch
 * die Verwalterseiten führt.
 */
internal fun NavController.openOfMore(ziel: Any) = when (ziel) {
    KontoZiel.Settings -> navigate(ziel) { launchSingleTop = true }
    ManagementTarget.Monitoring -> navigate(ziel) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = false
    }
    else -> navigate(ziel)
}

/** Ab dieser Fensterbreite stehen die Gruppen in zwei Spalten. */
private val MORE_TWO_COLUMN_AB = 840.dp

/** Überschrift einer Gruppe — Vorleseprogramme springen von einer zur nächsten. */
@Composable
private fun MoreGroup(titel: Int, separator: Boolean) =
    GroupTitle(stringResource(titel), separator = separator)

/** Ein Eintrag: Symbol, Text, ganze Zeile antippbar (mindestens 56 dp hoch). */
@Composable
private fun MehrEintrag(
    titel: Int, symbol: ImageVector, point: Boolean = false, farbe: Color = Color.Unspecified, onKlick: () -> Unit,
) {
    ListItem(
        headlineContent = { Text(stringResource(titel), color = farbe) },
        supportingContent = if (point) ({ Text(stringResource(R.string.update_badge)) }) else null,
        leadingContent = { Icon(symbol, null, tint = farbe.takeOrElse { MaterialTheme.colorScheme.onSurfaceVariant }) },
        // Der Text darunter sagt es schon; der Punkt bleibt ohne zweite Ansage.
        trailingContent = if (point) ({ Badge() }) else null,
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.clickable(role = Role.Button, onClick = onKlick),
    )
}
