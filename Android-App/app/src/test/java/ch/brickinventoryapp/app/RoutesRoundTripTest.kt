package ch.brickinventoryapp.app

import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import ch.brickinventoryapp.catalog.ui.CatalogTarget
import ch.brickinventoryapp.collection.ui.CollectionTarget
import ch.brickinventoryapp.finances.ui.FinanceTarget
import ch.brickinventoryapp.login.ui.LoginTarget
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.domain.NO_COLOR
import ch.brickinventoryapp.model.ui.ScannerOrigin
import ch.brickinventoryapp.parts.ui.PartsTarget
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Round trip of every route with values through a real NavHost: what a destination
 * brings along, `toRoute()` reads back exactly so in the destination — also special characters
 * and the default “no color”. PDF addresses do not travel in the route (PdfSelection).
 *
 * Counter-check (counter-checks/route-field-transient.patch, measurable only in CI):
 *   ManualItemDetail.title as @Transient → red “titles with special characters arrive unchanged“
 * Counter-check (counter-checks/item-kind-fixed-off.patch, measurable only in CI):
 *   Postenart.from() always returns SET → red “every item kind arrives as the same one“
 * Counter-check (measurable only in CI, not performed): StateSerializer with
 *   PrimitiveKind.STRING instead of SerialKind.ENUM → red “set numbers and wishlist items
 *   arrive unchanged” (navigation finds no NavType for the field)
 */
@RunWith(RobolectricTestRunner::class)
class RoutesRoundTripTest {

    @get:Rule
    val compose = createComposeRule()

    /** What the destination read on construction, per entry in the back stack. */
    private val read = mutableMapOf<String, Any>()

    private lateinit var nav: NavHostController

    private fun build() {
        compose.setContent {
            nav = rememberNavController()
            NavHost(nav, startDestination = LoginTarget.Setup) {
                composable<LoginTarget.Setup> {}
                composable<CollectionTarget.SetDetail> { read[it.id] = it.toRoute<CollectionTarget.SetDetail>() }
                composable<CatalogTarget.CatalogDetail> { read[it.id] = it.toRoute<CatalogTarget.CatalogDetail>() }
                composable<CollectionTarget.WantedItemDetail> { read[it.id] = it.toRoute<CollectionTarget.WantedItemDetail>() }
                composable<PartsTarget.ManualItemDetail> { read[it.id] = it.toRoute<PartsTarget.ManualItemDetail>() }
                composable<CollectionTarget.AcquisitionManagement> { read[it.id] = it.toRoute<CollectionTarget.AcquisitionManagement>() }
                composable<FinanceTarget.PdfViewer> { read[it.id] = it.toRoute<FinanceTarget.PdfViewer>() }
                composable<CollectionTarget.BarcodeScanner> { read[it.id] = it.toRoute<CollectionTarget.BarcodeScanner>() }
            }
        }
        compose.waitForIdle()
    }

    /** Navigates to the destination and returns what the destination read. */
    private fun there(target: Any): Any {
        compose.runOnIdle { nav.navigate(target) }
        compose.waitForIdle()
        return compose.runOnIdle {
            val top = nav.currentBackStackEntry!!
            checkNotNull(read[top.id]) { "destination for $target not built (${top.destination.route})" }
        }
    }

    private val title = listOf(
        "100 % C++",
        "Anthony / Skater",
        "Grüße aus Zürich: Öl, Ähre, ß",
        "a+b c",
        "Frage? #1 & mehr",
        "%20 steht hier wörtlich",
        "  Rand  ",
    )

    @Test
    fun `titles with special characters arrive unchanged`() {
        build()
        for (t in title) {
            val part = PartsTarget.ManualItemDetail(ItemKind.PART, "3001 b", 4, t)
            assertEquals("part “$t”", part, there(part))
            val purchase = CollectionTarget.AcquisitionManagement(ItemKind.FIG, "sw0001+", 0, t)
            assertEquals("purchase “$t”", purchase, there(purchase))
        }
    }

    @Test
    fun `every item kind arrives as the same one`() {
        build()
        for (kind in ItemKind.entries) {
            val purchase = CollectionTarget.AcquisitionManagement(kind, "3001", 4, "Stein")
            assertEquals(purchase, there(purchase))
            assertEquals(kind, ItemKind.from(kind.identifier))
        }
    }

    @Test
    fun `the scanner knows where it was opened from`() {
        build()
        for (origin in ScannerOrigin.entries) {
            assertEquals(CollectionTarget.BarcodeScanner(origin), there(CollectionTarget.BarcodeScanner(origin)))
        }
    }

    @Test
    fun `without a color no color arrives, not black`() {
        build()
        assertEquals(NO_COLOR, (there(PartsTarget.ManualItemDetail(ItemKind.FIG, "sw0001", title = "Luke")) as PartsTarget.ManualItemDetail).colorId)
    }

    @Test
    fun `the PDF viewer gets only its key`() {
        // Address (including ticket) and title stay in the PdfSelection (PdfSelectionTest).
        build()
        val pdf = FinanceTarget.PdfViewer("0f8e2c1a-7d3b-4c55-9a0e-1b2c3d4e5f60")
        assertEquals(pdf, there(pdf))
    }

    @Test
    fun `set numbers and wishlist items arrive unchanged`() {
        build()
        for (sn in listOf("75192-1", "col23-1", "a b/c%", "10 % +1")) {
            assertEquals(CollectionTarget.SetDetail(sn), there(CollectionTarget.SetDetail(sn)))
            assertEquals(CatalogTarget.CatalogDetail(sn), there(CatalogTarget.CatalogDetail(sn)))
            assertEquals(CollectionTarget.WantedItemDetail(sn, Condition.USED), there(CollectionTarget.WantedItemDetail(sn, Condition.USED)))
        }
    }
}
