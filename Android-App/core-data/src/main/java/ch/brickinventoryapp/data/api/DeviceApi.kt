package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.contract.DeviceKeyRequest
import ch.brickinventoryapp.contract.Done
import ch.brickinventoryapp.contract.KeyNonceResponse
import ch.brickinventoryapp.contract.StepApprovalRequest
import ch.brickinventoryapp.contract.StepApprovalResponse
import ch.brickinventoryapp.contract.StepChallengeRequest
import ch.brickinventoryapp.contract.StepChallengeResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

/** Device key and release of sensitive steps; only StepBindingImpl needs it, hence not in BrickApiService. */
internal interface DeviceApi {

    @POST("api/v2/device/key")
    suspend fun depositChain(@Body request: DeviceKeyRequest): Response<Done>

    @POST("api/v2/device/key/nonce")
    suspend fun keyNonce(): Response<KeyNonceResponse>

    @POST("api/v2/device/step/challenge")
    suspend fun stepChallenge(@Body request: StepChallengeRequest): Response<StepChallengeResponse>

    @POST("api/v2/device/step/approval")
    suspend fun stepRelease(@Body request: StepApprovalRequest): Response<StepApprovalResponse>
}
