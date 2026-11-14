package ch.brickinventoryapp.sammlung.ui.screens

import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ViewInAr
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.sammlung.ui.viewmodel.ErfassungViewModel
import ch.brickinventoryapp.sammlung.ui.viewmodel.GalerieViewModel
import ch.brickinventoryapp.ui.components.HinweisText
import ch.brickinventoryapp.ui.components.ListeUndDetail
import ch.brickinventoryapp.ui.components.LocalOffenesDetail
import ch.brickinventoryapp.ui.components.ZustandsHinweis
import coil3.ImageLoader

/**
 * Galerie links, Set-Detail rechts — auf breiten Fenstern (ab 840 dp, listeUndDetail()),
 * schon bevor ein Set gewählt ist: Sonst füllte die Galerie das Tablet, und erst ein
 * Tipp verriet, dass es dort Liste und Detail nebeneinander gibt.
 */
@Composable
fun GalerieUndDetail(
    galerie: GalerieViewModel,
    erfassung: ErfassungViewModel,
    imageLoader: ImageLoader,
    /** Das Set, dessen Detail rechts steht; null, solange keines gewählt ist. */
    offen: String?,
    onSetClick: (String) -> Unit,
    onScanBarcode: () -> Unit,
    gridState: LazyGridState = rememberLazyGridState(),
    detail: @Composable () -> Unit,
) {
    ListeUndDetail(
        liste = {
            CompositionLocalProvider(LocalOffenesDetail provides offen) {
                GalleryRoute(vm = galerie, erfassung = erfassung, imageLoader = imageLoader,
                    onScanBarcode = onScanBarcode, onSetClick = onSetClick, gridState = gridState)
            }
        },
        detail = {
            if (offen != null) detail()
            else ZustandsHinweis {
                HinweisText(Icons.Default.ViewInAr, stringResource(R.string.gallery_detail_leer))
            }
        },
    )
}
