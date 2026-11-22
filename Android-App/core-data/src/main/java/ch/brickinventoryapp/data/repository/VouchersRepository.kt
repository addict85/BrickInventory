package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.Confirmation
import ch.brickinventoryapp.model.domain.BalanceInfo
import ch.brickinventoryapp.model.domain.VoucherInfo
import ch.brickinventoryapp.model.domain.VoucherStorage
import ch.brickinventoryapp.model.domain.VoucherView
import ch.brickinventoryapp.model.domain.PlaintextView

/**
 * Vouchers including PDF and balance query.
 * An interface so that ViewModels and tests do not depend on the implementation with
 * Retrofit and store (VouchersRepositoryImpl).
 */
interface VouchersRepository {
    suspend fun list(): Outcome<List<VoucherView>>

    suspend fun create(info: VoucherInfo): Outcome<VoucherStorage>

    suspend fun edit(id: Int, info: VoucherInfo): Outcome<VoucherStorage>

    suspend fun deleteVoucher(id: Int, confirmation: Confirmation): Outcome<Unit>

    suspend fun plaintext(id: Int, confirmation: Confirmation): Outcome<PlaintextView>

    suspend fun pdfRelease(id: Int?, confirmation: Confirmation): Outcome<String>

    suspend fun balance(id: Int): Outcome<BalanceInfo>

    suspend fun fromPdf(
        fileName: String,
        type: String,
        content: ByteArray,
        number: String? = null,
        pin: String? = null,
        amount: String? = null,
        currency: String? = null,
    ): Outcome<VoucherStorage>
}
