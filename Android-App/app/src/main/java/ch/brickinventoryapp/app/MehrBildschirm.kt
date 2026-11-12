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
import ch.brickinventoryapp.ui.components.Rueckfrage
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.takeOrElse
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.navigation.NavGraph.Companion.findStartDestination
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.theme.mittigBis
import ch.brickinventoryapp.ui.components.Gruppentitel
import ch.brickinventoryapp.finanzen.ui.FinanzZiel
import ch.brickinventoryapp.konto.ui.KontoZiel
import ch.brickinventoryapp.sammlung.ui.SammlungZiel
import ch.brickinventoryapp.teile.ui.TeileZiel
import ch.brickinventoryapp.verwaltung.ui.VerwaltungZiel

/**
 * Das Ziel „Mehr“ der unteren Leiste: alle Seiten, die kein Bestandsreiter sind, in
 * Gruppen auf EINER Seite. Alle Symbole umrandet, wie Material es für Listen vorsieht:
 * Gefüllte neben umrandeten lasen sich wie ein Unterschied, den es nicht gibt. Der
 * Bildschirm nennt nur das Ziel; wie dorthin navigiert wird, entscheidet der Graph
 * ([oeffneVonMehr]).
 */
@Composable
fun MehrBildschirm(
    onZiel: (Any) -> Unit,
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
    @Composable
    fun Gruppe(nummer: Int, trenner: Boolean) = MehrGruppeInhalt(nummer, trenner, updateVerfuegbar, onZiel)
    // Die Servergruppe nur für Verwalter.
    val gruppen = if (isAdmin) 5 else 4
    // Auf dem Tablet zwei Spalten, etwa gleich hoch: Preise, Werkzeuge und Server links,
    // Bestand und Konto rechts. Einspaltig stand die Liste schmal in einer leeren Fläche.
    BoxWithConstraints(modifier.fillMaxSize()) {
        val zweispaltig = maxWidth >= MEHR_ZWEISPALTIG_AB
        val rahmen = Modifier.fillMaxSize().verticalScroll(rememberScrollState())
            .mittigBis(if (zweispaltig) Lesebreite.liste else Lesebreite.formular).padding(vertical = Abstaende.klein)
        Column(rahmen) {
            if (zweispaltig) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Abstaende.sehrGross)) {
                Column(Modifier.weight(1f)) { listOf(0, 1, 4).filter { it < gruppen }.forEachIndexed { i, g -> Gruppe(g, trenner = i > 0) } }
                Column(Modifier.weight(1f)) { Gruppe(2, trenner = false); Gruppe(3, trenner = true) }
            } else for (i in 0 until gruppen) Gruppe(i, trenner = i > 0)
            AbmeldenEintrag { fragtAbmelden = true }
        }
    }
}

/**
 * Abmelden zuletzt und abgesetzt, in der Fehlerfarbe: Zwischen „Einstellungen“ und den
 * Servergruppen war es ein Eintrag wie jeder andere und lag dort, wo man weitertippt.
 */
@Composable
private fun AbmeldenEintrag(onKlick: () -> Unit) {
    HorizontalDivider(Modifier.padding(vertical = Abstaende.klein))
    MehrEintrag(R.string.main_menu_logout, Icons.AutoMirrored.Outlined.Logout,
        farbe = MaterialTheme.colorScheme.error, onKlick = onKlick)
}

/**
 * Je Gruppe ein Block; `trenner` fällt am Kopf einer Spalte weg. Eine Gruppe, eine
 * Art Seite: Werkzeuge behalten die untere Leiste, Preise und Verwalten öffnen
 * Unterseiten. Gemischt sah „Vergleich“ neben „Gutscheine“ anders aus als erwartet.
 */
@Composable
private fun MehrGruppeInhalt(nummer: Int, trenner: Boolean, updateVerfuegbar: Boolean, onZiel: (Any) -> Unit) {
    when (nummer) {
        0 -> {
            MehrGruppe(R.string.nav_group_prices, trenner)
            // Gutscheine zuerst: Die braucht man im Laden.
            MehrEintrag(R.string.vouchers_title, Icons.Outlined.Redeem) { onZiel(FinanzZiel.Gutscheine) }
            MehrEintrag(R.string.alerts_group, Icons.Outlined.NotificationsActive) { onZiel(KontoZiel.Preisalarme) }
        }
        1 -> {
            MehrGruppe(R.string.nav_group_tools, trenner)
            MehrEintrag(R.string.nav_comparison, Icons.AutoMirrored.Outlined.CompareArrows) { onZiel(SammlungZiel.Comparison) }
            MehrEintrag(R.string.nav_partslist, Icons.AutoMirrored.Outlined.ListAlt) { onZiel(TeileZiel.PartsList) }
        }
        2 -> {
            MehrGruppe(R.string.nav_group_manage, trenner)
            MehrEintrag(R.string.storage_manage, Icons.Outlined.Inventory2) { onZiel(KontoZiel.Lagerorte) }
            MehrEintrag(R.string.household_title, Icons.Outlined.Group) { onZiel(KontoZiel.Haushalt) }
            MehrEintrag(R.string.csv_upload_title, Icons.Outlined.UploadFile) { onZiel(KontoZiel.CsvImport) }
        }
        3 -> {
            MehrGruppe(R.string.nav_group_account, trenner)
            MehrEintrag(R.string.konto_title, Icons.Outlined.AccountCircle) { onZiel(KontoZiel.Konto) }
            // Der Punkt allein sagte nicht, wofür er steht: Darunter steht es in Worten.
            MehrEintrag(R.string.nav_settings, Icons.Outlined.Settings, punkt = updateVerfuegbar) { onZiel(KontoZiel.Settings) }
        }
        else -> {
            MehrGruppe(R.string.nav_group_server, trenner)
            MehrEintrag(R.string.main_menu_monitoring, Icons.Outlined.Assessment) { onZiel(VerwaltungZiel.Monitoring) }
        }
    }
}

/**
 * Öffnet ein Ziel der Seite „Mehr“. Die Einstellungen stapeln sich nicht doppelt; das
 * Monitoring steht wie ein Reiter direkt über dem Start, damit „Zurück“ nicht durch
 * die Verwalterseiten führt.
 */
internal fun NavController.oeffneVonMehr(ziel: Any) = when (ziel) {
    KontoZiel.Settings -> navigate(ziel) { launchSingleTop = true }
    VerwaltungZiel.Monitoring -> navigate(ziel) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = false
    }
    else -> navigate(ziel)
}

/** Ab dieser Fensterbreite stehen die Gruppen in zwei Spalten. */
private val MEHR_ZWEISPALTIG_AB = 840.dp

/** Überschrift einer Gruppe — Vorleseprogramme springen von einer zur nächsten. */
@Composable
private fun MehrGruppe(titel: Int, trenner: Boolean) =
    Gruppentitel(stringResource(titel), trenner = trenner)

/** Ein Eintrag: Symbol, Text, ganze Zeile antippbar (mindestens 56 dp hoch). */
@Composable
private fun MehrEintrag(
    titel: Int, symbol: ImageVector, punkt: Boolean = false, farbe: Color = Color.Unspecified, onKlick: () -> Unit,
) {
    ListItem(
        headlineContent = { Text(stringResource(titel), color = farbe) },
        supportingContent = if (punkt) ({ Text(stringResource(R.string.update_badge)) }) else null,
        leadingContent = { Icon(symbol, null, tint = farbe.takeOrElse { MaterialTheme.colorScheme.onSurfaceVariant }) },
        // Der Text darunter sagt es schon; der Punkt bleibt ohne zweite Ansage.
        trailingContent = if (punkt) ({ Badge() }) else null,
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.clickable(role = Role.Button, onClick = onKlick),
    )
}
