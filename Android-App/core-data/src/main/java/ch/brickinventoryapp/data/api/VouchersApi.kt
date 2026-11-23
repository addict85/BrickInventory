package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.contract.BalanceReply
import ch.brickinventoryapp.contract.GenericResponse
import ch.brickinventoryapp.contract.SecondFactorRequest
import ch.brickinventoryapp.contract.VoucherList
import ch.brickinventoryapp.contract.VoucherPdfGrant
import ch.brickinventoryapp.contract.VoucherPlaintext
import ch.brickinventoryapp.contract.VoucherReply
import ch.brickinventoryapp.contract.VoucherRequest
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path

/**
 * Vouchers in the own profile (VouchersRepository).
 */
interface VouchersApi {

    // ── Vouchers (LEGO gift cards in the own profile) ──
    //
    // The same addresses as the web app; requireToken accepts session and bearer.
    // Vouchers strictly belong to their owner, hence no `accounts` parameter.
    @GET("api/v2/vouchers")
    suspend fun getVouchers(): Response<VoucherList>

    @POST("api/v2/vouchers")
    suspend fun createVoucher(@Body request: VoucherRequest): Response<VoucherReply>

    @PUT("api/v2/vouchers/{id}")
    suspend fun changeVoucher(
        @Path("id") id: Int,
        @Body request: VoucherRequest,
    ): Response<VoucherReply>

    // @HTTP instead of @DELETE: Retrofit allows no body for @DELETE, the server
    // requires password and code in it.
    @HTTP(method = "DELETE", path = "api/v2/vouchers/{id}", hasBody = true)
    suspend fun deleteVoucher(
        @Path("id") id: Int,
        @Body confirmation: SecondFactorRequest,
    ): Response<GenericResponse>

    /** Undo of [deleteVoucher]: the server keeps a deleted card for a few days. */
    @POST("api/v2/vouchers/{id}/restore")
    suspend fun restoreVoucher(@Path("id") id: Int): Response<VoucherReply>

    /** Number and PIN in plaintext; the list carries only the mask. */
    @POST("api/v2/vouchers/{id}/plaintext")
    suspend fun voucherPlaintext(
        @Path("id") id: Int,
        @Body confirmation: SecondFactorRequest,
    ): Response<VoucherPlaintext>

    /** A ticket for GET /vouchers/{id}/pdf?ticket=…; see VouchersRepository.pdfRelease(). */
    @POST("api/v2/vouchers/{id}/pdf-grant")
    suspend fun voucherPdfRelease(
        @Path("id") id: Int,
        @Body confirmation: SecondFactorRequest,
    ): Response<VoucherPdfGrant>

    /** The same for the PDF of all vouchers (GET /vouchers/export/pdf?ticket=…). */
    @POST("api/v2/vouchers/export/pdf-grant")
    suspend fun voucherExportRelease(@Body confirmation: SecondFactorRequest): Response<VoucherPdfGrant>

    /**
     * Create a voucher from its PDF. Values sent along win over what was
     * read; if the PDF is not enough, the server answers with 422 and what it
     * could read. The parts are optional because an empty field would overwrite
     * what was read. If the file contains several vouchers, the same route answers with
     * `several`.
     */
    @Multipart
    @POST("api/v2/vouchers/pdf")
    suspend fun loadVoucherPdfHigh(
        @Part file: okhttp3.MultipartBody.Part,
        @Part("number") number: okhttp3.RequestBody? = null,
        @Part("pin") pin: okhttp3.RequestBody? = null,
        @Part("amount") amount: okhttp3.RequestBody? = null,
        @Part("currency") currency: okhttp3.RequestBody? = null,
    ): Response<VoucherReply>

    /**
     * Query and save the balance of a card at LEGO. No body: number and
     * PIN already lie on the server. No method for all cards — the server
     * allows one query per 30 seconds, the UI paces itself through
     * this route.
     */
    @POST("api/v2/vouchers/{id}/balance")
    suspend fun queryBalance(@Path("id") id: Int): Response<BalanceReply>

    // No method for `GET /vouchers/{id}/pdf` and `GET /vouchers/export/pdf`:
    // the PdfViewerScreen fetches the PDF itself via its address (with ticket),
    // with the app's signed-in client. See ui/viewmodel/VoucherAddresses.kt.
}
