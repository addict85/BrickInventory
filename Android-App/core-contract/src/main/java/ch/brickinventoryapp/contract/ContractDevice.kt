// Generated from Web-App/docs/openapi-v2.json by Web-App/scripts/contract-kotlin-dtos.js.
// Do not edit by hand: npm run contract:kotlin (in the Web-App folder).
@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList")
@file:OptIn(ExperimentalSerializationApi::class)

package ch.brickinventoryapp.contract

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class DeviceKeyRequest(
    @SerialName("public_key") @EncodeDefault(EncodeDefault.Mode.NEVER) val publicKey: String? = null,
    @SerialName("chain") val chain: List<String>,
)

@Serializable
data class KeyNonceResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("nonce") val nonce: String,
)

@Serializable
data class StepApprovalRequest(
    @SerialName("challenge") val challenge: String,
    @SerialName("signature") val signature: String,
)

@Serializable
data class StepApprovalResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("action") val action: String,
    @SerialName("valid_until") val validUntil: String,
)

@Serializable
data class StepChallengeRequest(
    @SerialName("action") val action: String,
)

@Serializable
data class StepChallengeResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("challenge") val challenge: String,
    @SerialName("message") val message: String,
    @SerialName("valid_until") val validUntil: String,
)
