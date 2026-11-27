package ch.brickinventoryapp.collection.ui.screens

import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ViewInAr
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.GalleryViewModel
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.HintText
import ch.brickinventoryapp.ui.components.ListAndDetail
import ch.brickinventoryapp.ui.components.LocalOpenDetail
import ch.brickinventoryapp.ui.components.StateHint
import coil3.ImageLoader

/**
 * Gallery on the left, set detail on the right — on wide windows (from 840 dp, listAndDetail()),
 * even before a set is chosen: otherwise the gallery filled the tablet, and only a
 * tap revealed that list and detail sit side by side there.
 */
@Composable
fun GalleryAndDetail(
    gallery: GalleryViewModel,
    entryVm: EntryViewModel,
    imageLoader: ImageLoader,
    /** The set whose detail sits on the right; null as long as none is chosen. */
    open: String?,
    onSetClick: (String) -> Unit,
    onScanBarcode: () -> Unit,
    gridState: LazyGridState = rememberLazyGridState(),
    onSearchBarcode: () -> Unit = {},
    detail: @Composable () -> Unit,
) {
    ListAndDetail(
        list = {
            CompositionLocalProvider(LocalOpenDetail provides open) {
                GalleryRoute(vm = gallery, entryVm = entryVm, imageLoader = imageLoader,
                    onScanBarcode = onScanBarcode, onSetClick = onSetClick, gridState = gridState,
                    onSearchBarcode = onSearchBarcode)
            }
        },
        detail = {
            if (open != null) detail()
            else StateHint {
                HintText(Icons.Default.ViewInAr, stringResource(R.string.gallery_detail_empty))
            }
        },
    )
}
