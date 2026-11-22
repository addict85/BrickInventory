package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.contract.Erledigt
import ch.brickinventoryapp.contract.GeraeteSchluesselAnfrage
import ch.brickinventoryapp.contract.SchluesselNonce
import ch.brickinventoryapp.contract.SchrittChallenge
import ch.brickinventoryapp.contract.SchrittChallengeAnfrage
import ch.brickinventoryapp.contract.SchrittFreigabe
import ch.brickinventoryapp.contract.SchrittFreigabeAnfrage
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

/** Device key and release of sensitive steps; only StepBindingImpl needs it, hence not in BrickApiService. */
internal interface DeviceApi {

    @POST("api/v1/geraet/schluessel")
    suspend fun depositChain(@Body request: GeraeteSchluesselAnfrage): Response<Erledigt>

    @POST("api/v1/geraet/schluessel/nonce")
    suspend fun keyNonce(): Response<SchluesselNonce>

    @POST("api/v1/geraet/schritt/challenge")
    suspend fun stepChallenge(@Body request: SchrittChallengeAnfrage): Response<SchrittChallenge>

    @POST("api/v1/geraet/schritt/freigabe")
    suspend fun stepRelease(@Body request: SchrittFreigabeAnfrage): Response<SchrittFreigabe>
}
