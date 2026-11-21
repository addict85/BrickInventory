package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.contract.GeraeteSchluesselAnfrage
import ch.brickinventoryapp.contract.Erledigt
import ch.brickinventoryapp.contract.SchluesselNonce
import ch.brickinventoryapp.contract.SchrittChallenge
import ch.brickinventoryapp.contract.SchrittChallengeAnfrage
import ch.brickinventoryapp.contract.SchrittFreigabe
import ch.brickinventoryapp.contract.SchrittFreigabeAnfrage
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

/** Device key and release of sensitive steps; only SchrittbindungImpl needs it, hence not in BrickApiService. */
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
