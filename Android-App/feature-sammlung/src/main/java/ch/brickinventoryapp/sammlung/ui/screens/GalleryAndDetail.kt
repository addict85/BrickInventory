package ch.brickinventoryapp.sammlung.ui.screens

import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ViewInAr
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.sammlung.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.sammlung.ui.viewmodel.GalleryViewModel
import ch.brickinventoryapp.ui.components.HintText
import ch.brickinventoryapp.ui.components.ListAndDetail
import ch.brickinventoryapp.ui.components.LocalOpenDetail
import ch.brickinventoryapp.ui.components.StateHint
import coil3.ImageLoader

/**
 * Galerie links, Set-Detail rechts — auf breiten Fenstern (ab 840 dp, listAndDetail()),
 * schon bevor ein Set gewählt ist: Sonst füllte die Galerie das Tablet, und erst ein
 * Tipp verriet, dass es dort Liste und Detail nebeneinander gibt.
 */
@Composable
fun GalleryAndDetail(
    galerie: GalleryViewModel,
    erfassung: EntryViewModel,
    imageLoader: ImageLoader,
    /** Das Set, dessen Detail rechts steht; null, solange keines gewählt ist. */
    offen: String?,
    onSetClick: (String) -> Unit,
    onScanBarcode: () -> Unit,
    gridState: LazyGridState = rememberLazyGridState(),
    detail: @Composable () -> Unit,
) {
    ListAndDetail(
        liste = {
            CompositionLocalProvider(LocalOpenDetail provides offen) {
                GalleryRoute(vm = galerie, erfassung = erfassung, imageLoader = imageLoader,
                    onScanBarcode = onScanBarcode, onSetClick = onSetClick, gridState = gridState)
            }
        },
        detail = {
            if (offen != null) detail()
            else StateHint {
                HintText(Icons.Default.ViewInAr, stringResource(R.string.gallery_detail_leer))
            }
        },
    )
}
