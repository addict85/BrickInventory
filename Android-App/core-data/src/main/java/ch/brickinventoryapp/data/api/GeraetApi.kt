package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.model.data.model.GeraeteSchluesselAnfrage
import ch.brickinventoryapp.model.data.model.GeraeteSchluesselAntwort
import ch.brickinventoryapp.model.data.model.SchrittChallenge
import ch.brickinventoryapp.model.data.model.SchrittChallengeAnfrage
import ch.brickinventoryapp.model.data.model.SchrittFreigabe
import ch.brickinventoryapp.model.data.model.SchrittFreigabeAnfrage
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

/** Geräteschlüssel und Freigabe heikler Schritte; nur SchrittbindungImpl braucht ihn, darum nicht in BrickApiService. */
internal interface GeraetApi {

    @POST("api/v1/geraet/schluessel")
    suspend fun hinterlegeSchluessel(@Body anfrage: GeraeteSchluesselAnfrage): Response<GeraeteSchluesselAntwort>

    @POST("api/v1/geraet/schritt/challenge")
    suspend fun schrittChallenge(@Body anfrage: SchrittChallengeAnfrage): Response<SchrittChallenge>

    @POST("api/v1/geraet/schritt/freigabe")
    suspend fun schrittFreigabe(@Body anfrage: SchrittFreigabeAnfrage): Response<SchrittFreigabe>
}
