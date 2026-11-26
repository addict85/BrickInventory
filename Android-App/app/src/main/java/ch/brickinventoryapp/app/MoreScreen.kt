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
import androidx.compose.material.icons.automirrored.outlined.ListAlt
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Assessment
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.Redeem
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.UploadFile
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.takeOrElse
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.navigation.NavGraph.Companion.findStartDestination
import ch.brickinventoryapp.account.ui.AccountTarget
import ch.brickinventoryapp.collection.ui.CollectionTarget
import ch.brickinventoryapp.finances.ui.FinanceTarget
import ch.brickinventoryapp.management.ui.ManagementTarget
import ch.brickinventoryapp.parts.ui.PartsTarget
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.GroupTitle
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.theme.ReadingWidth
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.centeredUntil

/**
 * The destination “More” of the bottom bar: all pages that are not an inventory tab, in
 * groups on ONE page. All icons outlined, as Material intends for lists:
 * filled next to outlined read like a difference that does not exist. The
 * screen only names the destination; how it is navigated to is decided by the graph
 * ([openOfMore]).
 */
@Composable
fun MoreScreen(
    onTarget: (Any) -> Unit,
    isAdmin: Boolean,
    onLogout: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Sign-out ends the session on this device; a mistap in the menu would mean
    // password and second factor from the start. That is why it asks like deleting a set.
    var logoutAsks by rememberSaveable { mutableStateOf(false) }
    if (logoutAsks) Prompt(
        title = stringResource(R.string.logout_confirm_title),
        text = stringResource(R.string.logout_confirm_text),
        confirm = stringResource(R.string.main_menu_logout),
        onConfirm = { logoutAsks = false; onLogout() },
        onCancel = { logoutAsks = false },
        symbol = Icons.AutoMirrored.Outlined.Logout,
    )
    @Composable
    fun Group(number: Int, separator: Boolean) = MoreGroupContent(number, separator, onTarget)
    // The server group only for admins.
    val groups = if (isAdmin) 5 else 4
    // On the tablet two columns of about equal height: prices, tools and server on the left,
    // stock and account on the right. Single-column the list stood narrow in an empty area.
    BoxWithConstraints(modifier.fillMaxSize()) {
        val twoColumn = maxWidth >= MORE_TWO_COLUMN_MIN_WIDTH
        val frame = Modifier.fillMaxSize().verticalScroll(rememberScrollState())
            .centeredUntil(if (twoColumn) ReadingWidth.list else ReadingWidth.form).padding(vertical = Spacing.small)
        Column(frame) {
            if (twoColumn) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.veryLarge)) {
                Column(Modifier.weight(1f)) { listOf(0, 1, 4).filter { it < groups }.forEachIndexed { i, g -> Group(g, separator = i > 0) } }
                Column(Modifier.weight(1f)) { Group(2, separator = false); Group(3, separator = true) }
            } else for (i in 0 until groups) Group(i, separator = i > 0)
            LogoutEntry { logoutAsks = true }
        }
    }
}

/**
 * Sign-out last and set apart, in the error color: between “Settings” and the
 * server groups it was an entry like any other and lay where one keeps tapping.
 */
@Composable
private fun LogoutEntry(onClick: () -> Unit) {
    HorizontalDivider(Modifier.padding(vertical = Spacing.small))
    MoreItem(R.string.main_menu_logout, Icons.AutoMirrored.Outlined.Logout,
        color = MaterialTheme.colorScheme.error, onClick = onClick)
}

/**
 * One block per group; `separator` is dropped at the head of a column. One group, one
 * kind of page: tools keep the bottom bar, prices and management open
 * subpages. Mixed, “Comparison” next to “Vouchers” looked different than expected.
 */
@Composable
private fun MoreGroupContent(number: Int, separator: Boolean, onTarget: (Any) -> Unit) {
    when (number) {
        0 -> {
            MoreGroup(R.string.nav_group_prices, separator)
            // Vouchers first: they are needed in the shop.
            MoreItem(R.string.vouchers_title, Icons.Outlined.Redeem) { onTarget(FinanceTarget.Vouchers) }
            MoreItem(R.string.alerts_group, Icons.Outlined.NotificationsActive) { onTarget(AccountTarget.PriceAlarms) }
        }
        1 -> {
            MoreGroup(R.string.nav_group_tools, separator)
            MoreItem(R.string.nav_wanted, Icons.Outlined.BookmarkBorder) { onTarget(CollectionTarget.Wanted) }
            MoreItem(R.string.nav_partslist, Icons.AutoMirrored.Outlined.ListAlt) { onTarget(PartsTarget.PartsList) }
        }
        2 -> {
            MoreGroup(R.string.nav_group_manage, separator)
            MoreItem(R.string.storage_manage, Icons.Outlined.Inventory2) { onTarget(AccountTarget.StorageLocations) }
            MoreItem(R.string.household_title, Icons.Outlined.Group) { onTarget(AccountTarget.Household) }
            MoreItem(R.string.csv_upload_title, Icons.Outlined.UploadFile) { onTarget(AccountTarget.CsvImport) }
        }
        3 -> {
            MoreGroup(R.string.nav_group_account, separator)
            MoreItem(R.string.account_title, Icons.Outlined.AccountCircle) { onTarget(AccountTarget.Account) }
            // The dot alone did not say what it stands for: below it says so in words.
            MoreItem(R.string.nav_settings, Icons.Outlined.Settings) { onTarget(AccountTarget.Settings) }
        }
        else -> {
            MoreGroup(R.string.nav_group_server, separator)
            MoreItem(R.string.main_menu_monitoring, Icons.Outlined.Assessment) { onTarget(ManagementTarget.Monitoring) }
        }
    }
}

/**
 * Opens a destination of the page “More”. The settings do not stack twice; the
 * monitoring stands like a tab directly above the start so that “Back” does not lead through
 * the admin pages.
 */
internal fun NavController.openOfMore(target: Any) = when (target) {
    AccountTarget.Settings -> navigate(target) { launchSingleTop = true }
    ManagementTarget.Monitoring -> navigate(target) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = false
    }
    else -> navigate(target)
}

/** From this window width on the groups stand in two columns. */
private val MORE_TWO_COLUMN_MIN_WIDTH = 840.dp

/** Heading of a group — screen readers jump from one to the next. */
@Composable
private fun MoreGroup(title: Int, separator: Boolean) =
    GroupTitle(stringResource(title), separator = separator)

/** One entry: icon, text, the whole row tappable (at least 56 dp high). */
// The headline-first ListItem is deprecated since Material3 1.5; its successor lays rows out
// with other paddings and alignment (photos differ). Moving is a design step of its own.
@Suppress("DEPRECATION")
@Composable
private fun MoreItem(
    title: Int, symbol: ImageVector, color: Color = Color.Unspecified, onClick: () -> Unit,
) {
    ListItem(
        headlineContent = { Text(stringResource(title), color = color) },
        leadingContent = { Icon(symbol, null, tint = color.takeOrElse { MaterialTheme.colorScheme.onSurfaceVariant }) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.clickable(role = Role.Button, onClick = onClick),
    )
}
