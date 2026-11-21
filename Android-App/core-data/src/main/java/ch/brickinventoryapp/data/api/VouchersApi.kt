package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.contract.GenericResponse
import ch.brickinventoryapp.contract.GuthabenAntwort
import ch.brickinventoryapp.contract.GutscheinAntwort
import ch.brickinventoryapp.contract.GutscheinKlartext
import ch.brickinventoryapp.contract.GutscheinListe
import ch.brickinventoryapp.contract.GutscheinPdfFreigabe
import ch.brickinventoryapp.contract.GutscheinRequest
import ch.brickinventoryapp.contract.ZweiterFaktorAnfrage
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Part

/**
 * Vouchers in the own profile (VouchersRepository).
 */
interface VouchersApi {

    // ── Vouchers (LEGO gift cards in the own profile) ──
    //
    // The same addresses as the web app; requireToken accepts session and bearer.
    // Vouchers strictly belong to their owner, hence no `accounts` parameter.
    @GET("api/v1/vouchers")
    suspend fun getVouchers(): Response<GutscheinListe>

    @POST("api/v1/vouchers")
    suspend fun putVoucherAn(@Body request: GutscheinRequest): Response<GutscheinAntwort>

    @PUT("api/v1/vouchers/{id}")
    suspend fun changeVoucher(
        @Path("id") id: Int,
        @Body request: GutscheinRequest,
    ): Response<GutscheinAntwort>

    // @HTTP instead of @DELETE: Retrofit allows no body for @DELETE, the server
    // requires password and code in it.
    @HTTP(method = "DELETE", path = "api/v1/vouchers/{id}", hasBody = true)
    suspend fun deleteVoucher(
        @Path("id") id: Int,
        @Body confirmation: ZweiterFaktorAnfrage,
    ): Response<GenericResponse>

    /** Number and PIN in plaintext; the list carries only the mask. */
    @POST("api/v1/vouchers/{id}/klartext")
    suspend fun voucherPlaintext(
        @Path("id") id: Int,
        @Body confirmation: ZweiterFaktorAnfrage,
    ): Response<GutscheinKlartext>

    /** A ticket for GET /vouchers/{id}/pdf?ticket=…; see VouchersRepository.pdfRelease(). */
    @POST("api/v1/vouchers/{id}/pdf-freigabe")
    suspend fun voucherPdfRelease(
        @Path("id") id: Int,
        @Body confirmation: ZweiterFaktorAnfrage,
    ): Response<GutscheinPdfFreigabe>

    /** The same for the PDF of all vouchers (GET /vouchers/export/pdf?ticket=…). */
    @POST("api/v1/vouchers/export/pdf-freigabe")
    suspend fun voucherExportRelease(@Body confirmation: ZweiterFaktorAnfrage): Response<GutscheinPdfFreigabe>

    /**
     * Create a voucher from its PDF. Values sent along win over what was
     * read; if the PDF is not enough, the server answers with 422 and what it
     * could read. The parts are optional because an empty field would overwrite
     * what was read. If the file contains several vouchers, the same route answers with
     * `mehrere`.
     */
    @Multipart
    @POST("api/v1/vouchers/pdf")
    suspend fun loadVoucherPdfHigh(
        @Part datei: okhttp3.MultipartBody.Part,
        @Part("number") nummer: okhttp3.RequestBody? = null,
        @Part("pin") pin: okhttp3.RequestBody? = null,
        @Part("amount") betrag: okhttp3.RequestBody? = null,
        @Part("currency") waehrung: okhttp3.RequestBody? = null,
    ): Response<GutscheinAntwort>

    /**
     * Query and save the balance of a card at LEGO. No body: number and
     * PIN already lie on the server. No method for all cards — the server
     * allows one query per 30 seconds, the UI paces itself through
     * this route.
     */
    @POST("api/v1/vouchers/{id}/guthaben")
    suspend fun questionBalanceAb(@Path("id") id: Int): Response<GuthabenAntwort>

    // No method for `GET /vouchers/{id}/pdf` and `GET /vouchers/export/pdf`:
    // the PdfViewerScreen fetches the PDF itself via its address (with ticket),
    // with the app's signed-in client. See ui/viewmodel/GutscheinAdressen.kt.
}
