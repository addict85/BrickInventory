package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.vertrag.GeraeteSchluesselAnfrage
import ch.brickinventoryapp.vertrag.Erledigt
import ch.brickinventoryapp.vertrag.SchluesselNonce
import ch.brickinventoryapp.vertrag.SchrittChallenge
import ch.brickinventoryapp.vertrag.SchrittChallengeAnfrage
import ch.brickinventoryapp.vertrag.SchrittFreigabe
import ch.brickinventoryapp.vertrag.SchrittFreigabeAnfrage
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

/** Geräteschlüssel und Freigabe heikler Schritte; nur SchrittbindungImpl braucht ihn, darum nicht in BrickApiService. */
internal interface DeviceApi {

    @POST("api/v1/geraet/schluessel")
    suspend fun depositChain(@Body anfrage: GeraeteSchluesselAnfrage): Response<Erledigt>

    @POST("api/v1/geraet/schluessel/nonce")
    suspend fun schluesselNonce(): Response<SchluesselNonce>

    @POST("api/v1/geraet/schritt/challenge")
    suspend fun stepChallenge(@Body anfrage: SchrittChallengeAnfrage): Response<SchrittChallenge>

    @POST("api/v1/geraet/schritt/freigabe")
    suspend fun stepRelease(@Body anfrage: SchrittFreigabeAnfrage): Response<SchrittFreigabe>
}
