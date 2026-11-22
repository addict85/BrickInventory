package ch.brickinventoryapp.collection

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.collection.ui.viewmodel.ComparisonViewModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The comparison page decides in its ViewModel what to search: the typed text wins over
 * a scan, a scan opens at once, and the query is opened once only.
 *
 * Counter-checks: in ComparisonViewModel.scanned `pendingQuery = barcode` removed → red "a scan closes the scanner and opens its code at once" (null); in setSearch the scanned code kept
 * → red "typing replaces the scanned code".
 */
class ComparisonViewModelTest {

    private val saved = SavedStateHandle()
    private val vm = ComparisonViewModel(saved)

    @Test
    fun `typed text wins over the scan and is trimmed`() {
        vm.scanned("4006381333931")
        vm.queryOpened()
        vm.setSearch(" 10294 ")
        vm.search()
        assertEquals("10294", vm.state.value.pendingQuery)
        vm.queryOpened()
        assertNull("opened once only", vm.state.value.pendingQuery)
    }

    @Test
    fun `a scan closes the scanner and opens its code at once`() {
        vm.openScanner()
        vm.scanned("4006381333931")
        val s = vm.state.value
        assertFalse(s.showScanner)
        assertEquals("4006381333931", s.pendingQuery)
        assertTrue(s.showsBarcode)
    }

    @Test
    fun `typing replaces the scanned code`() {
        vm.scanned("4006381333931")
        vm.setSearch("75")
        assertNull(vm.state.value.scannedBarcode)
        vm.clearSearch()
        assertFalse("nothing left to search", vm.state.value.canSearch)
    }

    @Test
    fun `the typed text survives a process death`() {
        vm.setSearch("10294")
        assertEquals("10294", ComparisonViewModel(saved).state.value.searchText)
    }
}
