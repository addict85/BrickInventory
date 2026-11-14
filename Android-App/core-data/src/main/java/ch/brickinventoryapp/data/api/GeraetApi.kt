package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.vertrag.GeraeteKettenAnfrage
import ch.brickinventoryapp.vertrag.GeraeteSchluesselAnfrage
import ch.brickinventoryapp.vertrag.GeraeteSchluesselAntwort
import ch.brickinventoryapp.vertrag.SchluesselNonce
import ch.brickinventoryapp.vertrag.SchrittChallenge
import ch.brickinventoryapp.vertrag.SchrittChallengeAnfrage
import ch.brickinventoryapp.vertrag.SchrittFreigabe
import ch.brickinventoryapp.vertrag.SchrittFreigabeAnfrage
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

/** Geräteschlüssel und Freigabe heikler Schritte; nur SchrittbindungImpl braucht ihn, darum nicht in BrickApiService. */
internal interface GeraetApi {

    @POST("api/v1/geraet/schluessel")
    suspend fun hinterlegeSchluessel(@Body anfrage: GeraeteSchluesselAnfrage): Response<GeraeteSchluesselAntwort>

    @POST("api/v1/geraet/schluessel")
    suspend fun hinterlegeKette(@Body anfrage: GeraeteKettenAnfrage): Response<GeraeteSchluesselAntwort>

    @POST("api/v1/geraet/schluessel/nonce")
    suspend fun schluesselNonce(): Response<SchluesselNonce>

    @POST("api/v1/geraet/schritt/challenge")
    suspend fun schrittChallenge(@Body anfrage: SchrittChallengeAnfrage): Response<SchrittChallenge>

    @POST("api/v1/geraet/schritt/freigabe")
    suspend fun schrittFreigabe(@Body anfrage: SchrittFreigabeAnfrage): Response<SchrittFreigabe>
}
