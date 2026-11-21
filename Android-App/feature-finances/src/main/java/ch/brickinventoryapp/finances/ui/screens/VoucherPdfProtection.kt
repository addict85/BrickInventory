package ch.brickinventoryapp.finances.ui.screens

import androidx.compose.runtime.Composable
import ch.brickinventoryapp.ui.components.Sichtschutz
import ch.brickinventoryapp.finances.ui.viewmodel.showsVouchers

/** A voucher PDF carries number and PIN: no screenshot while it is being shown. */
@Composable
internal fun VoucherPdfProtection(pdfUrl: String) {
    if (showsVouchers(pdfUrl)) Sichtschutz()
}
